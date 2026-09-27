/**
 * 统计聚合层：合并 ZCode + Claude Code + 上报 等数据源，
 * 统一行结构：
 *   { requestId, channel, channelKind, model, source,
 *     promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens,
 *     totalTokens, cost, project, latencyMs, status, remark, createdAt(epoch ms) }
 * 口径：promptTokens 为纯输入（不含缓存），缓存读写单独成列；
 *       totalTokens = 输入 + 输出 + 缓存读 + 缓存写。
 *
 * 费用：官方市场价 + 缓存价率（缓存读默认按输入价 10%，缓存写默认 125%，
 *       可用环境变量 TOKENVIEW_CACHE_READ_RATE / TOKENVIEW_CACHE_WRITE_RATE 覆盖）。
 *
 * 性能：全部接口共享一份合并行缓存；TTL 过期后单飞（single-flight）重建，
 * 并发请求只触发一次构建；构建期间旧数据照常服务。
 */
const zcode = require('./zcode');
const claudeCode = require('./claude-code');
const codex = require('./codex');
const workbuddy = require('./workbuddy');
const lobsterai = require('./lobsterai');
const joyclaw = require('./joyclaw');
const codebuddyCn = require('./codebuddy-cn');
const qoder = require('./qoder');
const opencode = require('./opencode');
const ccSwitch = require('./cc-switch');
const reports = require('./reports');
const priceTable = require('./custom-prices');
const budget = require('./budget');
const path = require('path');

/** 固定工具清单（展示顺序与用户定义一致） */
const TOOL_LIST = [
  { id: 'zcode', name: 'ZCode' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'cc-switch', name: 'CC Switch' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN' },
  { id: 'joyclaw', name: 'JoyClaw' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'lobsterai', name: 'LobsterAI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'opensquilla', name: 'OpenSquilla' },
  { id: 'qoder', name: 'Qoder' },
  { id: 'trae', name: 'Trae' },
  { id: 'trae-cn', name: 'Trae CN' },
  { id: 'trae-solo-cn', name: 'TRAE SOLO CN' },
  { id: 'workbuddy', name: 'WorkBuddy' },
  { id: 'coze', name: '扣子' }
];

/** 全部数据源适配器（source 即工具标识） */
const SOURCES = { zcode, claudeCode, codex, workbuddy, lobsterai, joyclaw, codebuddyCn, qoder, opencode, 'cc-switch': ccSwitch };

/** 合并行缓存 TTL：过期后下一次请求触发一次重建 */
const CACHE_TTL_MS = 5000;

/* ---------- 工具 ---------- */

/** 模型单价（元 / 1K tokens）：生效价表（含 cc-switch 兜底与大小写不敏感匹配） */
function priceOf(modelName, pricesOverride) {
  const p = lookupPrice(pricesOverride || effectivePriceTable().prices, modelName) || {};
  return { input: Number(p.input) || 0, output: Number(p.output) || 0 };
}

/** 工具别名：上报 tool 值 → 工具清单 id（中文名等非 slug 形式） */
const TOOL_ALIASES = {
  '扣子': 'coze'
};

/** 上报 tool 值归一化为工具 id */
function normalizeTool(raw) {
  const t = String(raw || '').trim();
  if (!t) return 'api';
  return TOOL_ALIASES[t] || t.toLowerCase().replace(/\s+/g, '-');
}

/* ---------- 合并行缓存（单飞重建） ---------- */

const SOURCE_LIST = [zcode, claudeCode, codex, workbuddy, lobsterai, joyclaw, codebuddyCn, qoder, opencode, ccSwitch, reports];

const cacheState = { rows: null, builtAt: 0 };
let building = null;

const yieldTick = () => new Promise((resolve) => setImmediate(resolve));

/** 全量构建一次合并行（各源自身有增量缓存，重复构建开销很小） */
async function rebuild() {
  const parts = [];
  for (const src of SOURCE_LIST) {
    parts.push(src.getRows(0, Number.MAX_SAFE_INTEGER));
    await yieldTick(); // 源之间让出事件循环，避免长构建阻塞并发请求
  }
  const prices = effectivePriceTable().prices; // 整轮构建只取一次价表（含 cc-switch 兜底）
  const realPrices = ccSwitch.getCachePrices(); // cc-switch 真实价目（含缓存读写单价）
  const rows = [];
  for (const part of parts) {
    for (const r of part) {
      const p = lookupPrice(prices, r.model) || {};
      const input = Number(p.input) || 0;
      const output = Number(p.output) || 0;
      let source = r.source;
      // 上报数据按 tool 字段归属工具（未填 tool 归入 api）
      if (source === 'api' && r.tool) source = normalizeTool(r.tool);
      const cacheRead = Number(r.cacheReadTokens) || 0;
      const cacheWrite = Number(r.cacheWriteTokens) || 0;
      const cost = computeRowCost(r, input, output, realPriceFor(r.model));
      rows.push({
        ...r,
        source,
        promptTokens: Number(r.promptTokens) || 0,
        completionTokens: Number(r.completionTokens) || 0,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        project: String(r.project || '').slice(0, 128),
        sessionId: String(r.sessionId || '').slice(0, 64),
        sessionTitle: String(r.sessionTitle || '').slice(0, 128),
        isSubagent: Number(r.isSubagent) ? 1 : 0,
        ttftMs: Math.max(0, Number(r.ttftMs) || 0),
        errorType: String(r.errorType || '').slice(0, 64),
        cancelled: Number(r.cancelled) ? 1 : 0,
        retryCount: Math.max(0, Number(r.retryCount) || 0),
        contextExceeded: Number(r.contextExceeded) ? 1 : 0,
        ctxWindow: Math.max(0, Number(r.ctxWindow) || 0),
        ctxUsed: Math.max(0, Number(r.ctxUsed) || 0),
        cost: Number(cost.toFixed(4))
      });
    }
    await yieldTick();
  }
  cacheState.rows = rows;
  cacheState.builtAt = Date.now();
}

/**
 * 取合并行缓存；TTL 内直接复用，过期则等待一次单飞重建。
 * 构建失败时若有旧数据则继续兜底返回，无旧数据才向上抛错。
 */
function ensureRows() {
  if (cacheState.rows && Date.now() - cacheState.builtAt < CACHE_TTL_MS) {
    return Promise.resolve(cacheState.rows);
  }
  if (!building) {
    building = rebuild()
      .catch((e) => {
        console.error('[stats] 数据构建失败:', e.message);
        if (!cacheState.rows) throw e; // 无旧数据可兜底时向上抛
      })
      .finally(() => { building = null; });
  }
  return building.then(() => cacheState.rows || []);
}

/** 价格等外部因素变化后调用：下一请求触发重建，期间旧数据兜底 */
function invalidate() {
  cacheState.builtAt = 0;
}

/** 应用启动时预热缓存（异步，不阻塞监听） */
function warmup() {
  ensureRows().catch(() => { /* 预热失败由首次请求再试 */ });
}

/** 合并全部数据源（带费用计算），按时间范围过滤 */
async function getAllRows(startMs = 0, endMs = Infinity) {
  const all = await ensureRows();
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return all.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

/* ---------- 缓存价率与单源费用计算 ---------- */

/** 从环境变量读价率（非负数字），非法回退默认 */
function envRate(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const CACHE_READ_RATE = envRate('TOKENVIEW_CACHE_READ_RATE', 0.1);    // 缓存读：输入价 × 10%
const CACHE_WRITE_RATE = envRate('TOKENVIEW_CACHE_WRITE_RATE', 1.25); // 缓存写：输入价 × 125%

/**
 * 单一费用计算口径（stats 聚合与 /api/usage/report 上报响应共用，杜绝双口径）。
 * perModelCache 为 cc-switch model_pricing 的真实价（元/1K，含缓存读写），无则按价率估算。
 */
function computeRowCost({ promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens }, inputPrice, outputPrice, perModelCache) {
  const inP = Number(inputPrice) || 0;
  const outP = Number(outputPrice) || 0;
  const cacheReadPrice = perModelCache && Number.isFinite(perModelCache.cacheRead) && perModelCache.cacheRead != null
    ? perModelCache.cacheRead : inP * CACHE_READ_RATE;
  const cacheWritePrice = perModelCache && perModelCache.cacheWrite != null
    ? perModelCache.cacheWrite : inP * CACHE_WRITE_RATE;
  return (
    (Number(promptTokens) || 0) * inP
    + (Number(completionTokens) || 0) * outP
    + (Number(cacheReadTokens) || 0) * cacheReadPrice
    + (Number(cacheWriteTokens) || 0) * cacheWritePrice
  ) / 1000;
}

/** 模型的真实价目（cc-switch model_pricing，元/1K）；未收录返回 null（走估算价率） */
function cachePricesFor(modelName) {
  return realPriceFor(modelName);
}

let lowerIndexCache = null;

/** 全量价目的小写索引（大小写不敏感兜底：ZCode 等工具上报的模型名大小写不固定） */
function lowerIndexOf(prices) {
  if (lowerIndexCache && lowerIndexCache.for === prices) return lowerIndexCache;
  const map = new Map();
  for (const key of Object.keys(prices)) {
    const lower = key.toLowerCase();
    if (!map.has(lower)) map.set(lower, key); // 首个（价表覆盖序更优先的）胜出
  }
  lowerIndexCache = { for: prices, map };
  return lowerIndexCache;
}

/** 按名称取价，未命中时按小写再匹配一次 */
function lookupPrice(prices, modelName) {
  if (modelName in prices) return prices[modelName];
  const canonical = lowerIndexOf(prices).map.get(String(modelName).toLowerCase());
  return canonical ? prices[canonical] : undefined;
}

/** cc-switch 真实价目取值（同样带大小写兜底） */
function realPriceFor(modelName) {
  const real = ccSwitch.getCachePrices();
  return lookupPrice(real, modelName) || null;
}

/**
 * 生效价目 = 价表三层（默认/在线/自定义）+ cc-switch 真实价兜底。
 * 价表未收录的模型若在 cc-switch model_pricing 中有价，按真实 USD 价 × 汇率换算，
 * 避免新模型在价表更新前费用恒为 0；已在价表中的模型不受影响。
 */
function effectivePriceTable() {
  const base = priceTable.getPrices();
  const real = ccSwitch.getCachePrices();
  const merged = { ...base };
  const viaReal = new Set();
  for (const [m, p] of Object.entries(real)) {
    if (lookupPrice(merged, m) === undefined && p.input != null && p.output != null) {
      merged[m] = { input: p.input, output: p.output };
      viaReal.add(m);
    }
  }
  return { prices: merged, base, viaReal, real };
}

/* ---------- 时间工具 ---------- */

/** 解析时间范围：最近 N 天（含今天），返回 [startMs, endMs]；'all' 表示全部数据 */
function parseRange(days = 7) {
  const end = Date.now();
  if (days === 'all') return [0, end];
  const start = new Date();
  start.setDate(start.getDate() - (Number(days) - 1));
  start.setHours(0, 0, 0, 0);
  return [start.getTime(), end];
}

const pad = (n) => String(n).padStart(2, '0');
const fmtDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtMonth = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${fmtDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 时间桶标签：day / week（周一）/ month */
function bucketLabel(ms, granularity) {
  if (granularity === 'month') return fmtMonth(ms);
  if (granularity === 'week') {
    const d = new Date(ms);
    const dow = (d.getDay() + 6) % 7; // 周一=0
    d.setDate(d.getDate() - dow);
    return fmtDay(d.getTime());
  }
  return fmtDay(ms);
}

/* ---------- 统计函数 ---------- */

/** 核心 KPI 汇总 */
async function getOverview(days = 30) {
  const [start, end] = parseRange(days);
  const allRows = await getAllRows(); // 全量

  let totalTokens = 0;
  let totalCost = 0;
  let successCalls = 0;
  let periodTokens = 0;
  let periodCost = 0;
  let periodPrompt = 0;
  let periodCompletion = 0;
  let periodCache = 0;
  let todayTokens = 0;
  let todayCost = 0;
  let yesterdayTokens = 0;
  let monthCost = 0;
  const channels = new Set();
  const dayKeys = new Set();

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const y0 = new Date(today0); y0.setDate(y0.getDate() - 1);
  const month0 = new Date(); month0.setDate(1); month0.setHours(0, 0, 0, 0);
  const todayMs = today0.getTime();
  const yMs = y0.getTime();
  const monthMs = month0.getTime();

  for (const r of allRows) {
    totalTokens += r.totalTokens;
    totalCost += r.cost;
    if (r.status === 1) successCalls++;
    channels.add(r.channel);
    if (r.createdAt >= start && r.createdAt <= end) {
      periodTokens += r.totalTokens;
      periodCost += r.cost;
      periodPrompt += r.promptTokens;
      periodCompletion += r.completionTokens;
      periodCache += r.cacheReadTokens + r.cacheWriteTokens;
      dayKeys.add(fmtDay(r.createdAt));
    }
    if (r.createdAt >= todayMs) {
      todayTokens += r.totalTokens;
      todayCost += r.cost;
    } else if (r.createdAt >= yMs && r.createdAt < todayMs) {
      yesterdayTokens += r.totalTokens;
    }
    if (r.createdAt >= monthMs) monthCost += r.cost;
  }

  const totalCalls = allRows.length;
  const avgDailyTokens = dayKeys.size ? periodTokens / dayKeys.size : 0;
  const todayDelta = yesterdayTokens > 0 ? ((todayTokens - yesterdayTokens) / yesterdayTokens) * 100 : null;

  return {
    total_tokens: totalTokens,
    total_cost: Number(totalCost.toFixed(2)),
    total_calls: totalCalls,
    active_channels: channels.size,
    success_rate: totalCalls ? Number((successCalls / totalCalls * 100).toFixed(2)) : 100,
    period_tokens: periodTokens,
    period_cost: Number(periodCost.toFixed(2)),
    period_prompt_tokens: periodPrompt,
    period_completion_tokens: periodCompletion,
    period_cache_tokens: periodCache,
    month_cost: Number(monthCost.toFixed(2)),
    today_tokens: todayTokens,
    today_cost: Number(todayCost.toFixed(2)),
    today_calls: allRows.filter((r) => r.createdAt >= todayMs).length,
    today_delta: todayDelta === null ? null : Number(todayDelta.toFixed(2)),
    avg_daily_tokens: Math.round(avgDailyTokens),
    range_days: days === 'all' ? null : Number(days)
  };
}

/** 时间桶聚合（含输入/输出/缓存拆分） */
function bucketize(rows, granularity) {
  const buckets = new Map();
  for (const r of rows) {
    const label = bucketLabel(r.createdAt, granularity);
    const b = buckets.get(label) || { label, tokens: 0, cost: 0, calls: 0, prompt_tokens: 0, completion_tokens: 0, cache_tokens: 0 };
    b.tokens += r.totalTokens;
    b.cost += r.cost;
    b.calls += 1;
    b.prompt_tokens += r.promptTokens;
    b.completion_tokens += r.completionTokens;
    b.cache_tokens += r.cacheReadTokens + r.cacheWriteTokens;
    buckets.set(label, b);
  }
  return [...buckets.values()].sort((a, b) => a.label < b.label ? -1 : 1);
}

const emptyBucket = (label) => ({ label, tokens: 0, cost: 0, calls: 0, prompt_tokens: 0, completion_tokens: 0, cache_tokens: 0 });

/** 时间趋势；固定天数窗口额外返回上期对比序列 prev_list（与 list 按下标对齐） */
async function getTrend(days = 30, granularity = 'day', channel = '') {
  const [start, end] = parseRange(days);
  const rows = (await getAllRows(start, end)).filter((r) => !channel || r.channel === channel);

  let list = bucketize(rows, granularity);
  // 补齐缺失日期（按天粒度），保证曲线连续
  if (granularity === 'day') {
    // 'all' 范围 start 为 0（1970 年），只能从最早有数据的一天开始补齐，否则会生成几万个空桶
    let fillStart = start;
    if (days === 'all') {
      if (!rows.length) return { granularity, days: null, channel: channel || '', list: [], prev_list: null };
      let earliestMs = Infinity;
      for (const r of rows) if (r.createdAt < earliestMs) earliestMs = r.createdAt;
      const earliest = new Date(earliestMs);
      earliest.setHours(0, 0, 0, 0);
      fillStart = earliest.getTime();
    }
    const map = new Map(list.map((b) => [b.label, b]));
    list = [];
    for (let t = fillStart; t <= end; t += 86400000) {
      list.push(map.get(fmtDay(t)) || emptyBucket(fmtDay(t)));
    }
  }

  // 上期对比（本周 vs 上周等）：'all' 无上期；按天粒度同样补齐空桶保证等长
  let prevList = null;
  if (days !== 'all') {
    const span = end - start;
    const prevRows = (await getAllRows(start - span, start - 1)).filter((r) => !channel || r.channel === channel);
    let prev = bucketize(prevRows, granularity);
    if (granularity === 'day') {
      const map = new Map(prev.map((b) => [b.label, b]));
      prev = [];
      for (let t = start - span; t < start; t += 86400000) {
        prev.push(map.get(fmtDay(t)) || emptyBucket(fmtDay(t)));
      }
    }
    prevList = prev;
  }

  return { granularity, days: days === 'all' ? null : Number(days), channel: channel || '', list, prev_list: prevList };
}

/** 渠道维度统计 */
async function getChannels(days = 7) {
  const [start, end] = parseRange(days);
  const rows = await getAllRows(start, end);
  const map = new Map();
  for (const r of rows) {
    const c = map.get(r.channel) || {
      name: r.channel, provider: r.channelKind || r.channel,
      tokens: 0, cost: 0, calls: 0, models: new Set()
    };
    c.tokens += r.totalTokens;
    c.cost += r.cost;
    c.calls += 1;
    c.models.add(r.model);
    map.set(r.channel, c);
  }
  const total = [...map.values()].reduce((s, c) => s + c.tokens, 0) || 1;
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((c, i) => ({
      id: i + 1,
      name: c.name,
      provider: c.provider,
      tokens: c.tokens,
      cost: Number(c.cost.toFixed(4)),
      calls: c.calls,
      model_count: c.models.size,
      ratio: Number((c.tokens / total * 100).toFixed(2))
    }));
}

/** 模型 Top 排行 */
async function getModels(days = 7, limit = 10) {
  const [start, end] = parseRange(days);
  const rows = await getAllRows(start, end);
  const map = new Map();
  for (const r of rows) {
    const key = `${r.channel}::${r.model}`;
    const m = map.get(key) || { channel: r.channel, model: r.model, tokens: 0, cost: 0, calls: 0 };
    m.tokens += r.totalTokens;
    m.cost += r.cost;
    m.calls += 1;
    map.set(key, m);
  }
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit)
    .map((m, i) => {
      const p = priceOf(m.model);
      return {
        id: i + 1,
        model: m.model,
        type: 'chat',
        channel_id: i + 1,
        channel: m.channel,
        tokens: m.tokens,
        cost: Number(m.cost.toFixed(4)),
        calls: m.calls,
        input_price: p.input,       // 元 / 1K
        output_price: p.output,     // 元 / 1K
        input_per_million: Number((p.input * 1000).toFixed(2)),  // 元 / 百万
        output_per_million: Number((p.output * 1000).toFixed(2))
      };
    });
}

/** 模型市场价参考列表（含累计消耗，便于核对；零用量的价表模型也列出，便于自定义管理） */
async function getPrices() {
  const rows = await getAllRows();
  const eff = effectivePriceTable();
  const effective = eff.prices;
  const customMap = priceTable.getCustomMap();
  const defaultsMap = priceTable.getDefaults();
  const onlineMap = priceTable.getOnlinePrices();
  const map = new Map();
  for (const r of rows) {
    const key = `${r.channel}::${r.model}`;
    const m = map.get(key) || { channel: r.channel, model: r.model, tokens: 0, cost: 0, calls: 0 };
    m.tokens += r.totalTokens;
    m.cost += r.cost;
    m.calls += 1;
    map.set(key, m);
  }
  // 价表中存在但尚无用量的模型（如在线同步/新增自定义价/cc-switch 兜底价），追加在列表末尾（按模型名排序）
  const seen = new Set([...map.values()].map((m) => m.model));
  const priceOnly = Object.keys(effective)
    .filter((model) => !seen.has(model))
    .sort((a, b) => a.localeCompare(b))
    .map((model) => [`__price_only__::${model}`, { channel: '', model, tokens: 0, cost: 0, calls: 0 }]);
  for (const [k, v] of priceOnly) map.set(k, v);
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((m, i) => {
      const p = priceOf(m.model, effective);
      const realCache = realPriceFor(m.model);
      return {
        id: i + 1,
        model: m.model,
        channel: m.channel,
        input_per_million: Number((p.input * 1000).toFixed(2)),
        output_per_million: Number((p.output * 1000).toFixed(2)),
        // 缓存价（元 / 百万）：cc-switch 真实价优先，未收录按价率估算
        cache_read_per_million: realCache && realCache.cacheRead != null
          ? Number((realCache.cacheRead * 1000).toFixed(2)) : null,
        cache_write_per_million: realCache && realCache.cacheWrite != null
          ? Number((realCache.cacheWrite * 1000).toFixed(2)) : null,
        cost: Number(m.cost.toFixed(2)),
        calls: m.calls,
        tokens: m.tokens,
        custom: !!customMap[m.model],
        has_default: m.model in defaultsMap,
        source: eff.viaReal.has(m.model) ? 'cc-switch' : priceTable.getLayer(m.model)
      };
    });
}

/** 明细筛选（分页与导出共用）；时间参数为 'YYYY-MM-DD' 日期字符串 */
async function filterUsageRows({ channel = '', status = '', start = '', end = '', source = '' } = {}) {
  let rows = await getAllRows();
  if (channel) rows = rows.filter((r) => r.channel === channel);
  if (source) rows = rows.filter((r) => r.source === source);
  if (status !== '' && status !== undefined && status !== null) {
    const s = Number(status);
    rows = rows.filter((r) => r.status === s);
  }
  if (start) rows = rows.filter((r) => r.createdAt >= new Date(start).getTime());
  if (end) {
    const endMs = new Date(end);
    endMs.setHours(23, 59, 59, 999);
    rows = rows.filter((r) => r.createdAt <= endMs.getTime());
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** 明细行 -> 展示结构 */
function toUsageView(r, id) {
  return {
    id,
    request_id: r.requestId,
    channel: r.channel,
    model: r.model,
    source: r.source,
    project: r.project || '',
    prompt_tokens: r.promptTokens,
    completion_tokens: r.completionTokens,
    cache_tokens: r.cacheReadTokens + r.cacheWriteTokens,
    total_tokens: r.totalTokens,
    cost: r.cost.toFixed(4),
    latency_ms: r.latencyMs,
    ttft_ms: r.ttftMs || 0,
    error_type: r.errorType || '',
    status: r.status,
    created_at: fmtTime(r.createdAt)
  };
}

/** 导出上限：防止异常大导出拖垮内存 */
const EXPORT_LIMIT = 100000;

/** 调用明细分页 */
async function getUsage({ page = 1, pageSize = 20, channel = '', status = '', start = '', end = '', source = '' } = {}) {
  const rows = await filterUsageRows({ channel, status, start, end, source });
  const total = rows.length;
  const offset = (Number(page) - 1) * Number(pageSize);
  const list = rows.slice(offset, offset + Number(pageSize))
    .map((r, i) => toUsageView(r, total - offset - i));
  return { page: Number(page), pageSize: Number(pageSize), total, list };
}

/** 明细全量导出（按当前筛选，倒序，封顶 10 万行） */
async function getUsageExport(filters = {}) {
  const rows = await filterUsageRows(filters);
  return rows.slice(0, EXPORT_LIMIT).map((r, i) => toUsageView(r, rows.length - i));
}

/** 渠道列表（筛选用） */
async function getChannelList() {
  const names = new Map();
  for (const r of await getAllRows()) {
    if (!names.has(r.channel)) names.set(r.channel, r.channelKind || r.channel);
  }
  return [...names.entries()].map(([name, provider], i) => ({
    id: i + 1, name, provider, enabled: 1, remark: ''
  }));
}

/** 工具统计：固定工具清单 + 聚合数据 + 状态 */
async function getTools() {
  const rows = await getAllRows();
  const agg = new Map(); // toolId -> { calls, tokens, cost, lastUsed }
  for (const r of rows) {
    const key = r.source;
    const a = agg.get(key) || { calls: 0, tokens: 0, cost: 0, lastUsed: 0 };
    a.calls += 1;
    a.tokens += r.totalTokens;
    a.cost += r.cost;
    if (r.createdAt > a.lastUsed) a.lastUsed = r.createdAt;
    agg.set(key, a);
  }
  return TOOL_LIST.map((t) => {
    const a = agg.get(t.id) || { calls: 0, tokens: 0, cost: 0, lastUsed: 0 };
    let status = '待上报';
    if (a.calls > 0) status = '有数据';
    // 数据源不可用（库缺失/解密失败等）标记异常，原因见数据源健康面板
    const src = SOURCES[t.id];
    if (src && src.status && src.status().healthy === false) status = '异常';
    return {
      id: t.id,
      name: t.name,
      calls: a.calls,
      tokens: a.tokens,
      cost: Number(a.cost.toFixed(2)),
      last_used: a.lastUsed ? fmtTime(a.lastUsed) : '',
      status
    };
  });
}

/* ---------- 拓展统计：热力图 / 延迟 / 项目 / 月度账单 / 预算 / 数据源健康 ---------- */

/** 时段热力图：星期 × 小时的 tokens/calls 聚合（星期一为第 0 行） */
async function getHeatmap(days = 30) {
  const [start, end] = parseRange(days);
  const rows = await getAllRows(start, end);
  const cells = Array.from({ length: 7 * 24 }, (_, i) => ({
    dow: Math.floor(i / 24),
    hour: i % 24,
    tokens: 0,
    calls: 0
  }));
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const idx = ((d.getDay() + 6) % 7) * 24 + d.getHours();
    cells[idx].tokens += r.totalTokens;
    cells[idx].calls += 1;
  }
  return {
    list: cells,
    max_tokens: Math.max(...cells.map((c) => c.tokens), 0),
    max_calls: Math.max(...cells.map((c) => c.calls), 0)
  };
}

/** 百分位数：已升序数组；空数组返回 0 */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** 延迟分析：整体与分渠道的 P50 / P95 / 均值（仅统计 latencyMs > 0 的调用）；附带首字延迟（TTFT） */
async function getLatency(days = 30) {
  const [start, end] = parseRange(days);
  const allRows = await getAllRows(start, end);
  const rows = allRows.filter((r) => r.latencyMs > 0);
  const byChannel = new Map();
  for (const r of rows) {
    const c = byChannel.get(r.channel) || { channel: r.channel, values: [], calls: 0 };
    c.values.push(r.latencyMs);
    c.calls += 1;
    byChannel.set(r.channel, c);
  }
  const summarize = (values, calls) => {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    return {
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      avg: sorted.length ? Math.round(sum / sorted.length) : 0,
      calls
    };
  };
  const allValues = rows.map((r) => r.latencyMs);

  // 首字延迟（TTFT）：ZCode 的 time_to_first_token_ms，衡量"排队/首包"与"生成"的差异
  const ttftRows = allRows.filter((r) => r.ttftMs > 0);
  const ttftByChannel = new Map();
  for (const r of ttftRows) {
    const c = ttftByChannel.get(r.channel) || { channel: r.channel, values: [], calls: 0 };
    c.values.push(r.ttftMs);
    c.calls += 1;
    ttftByChannel.set(r.channel, c);
  }
  return {
    overall: summarize(allValues, rows.length),
    channels: [...byChannel.values()]
      .map((c) => ({ channel: c.channel, ...summarize(c.values, c.calls) }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 12),
    ttft: {
      overall: summarize(ttftRows.map((r) => r.ttftMs), ttftRows.length),
      channels: [...ttftByChannel.values()]
        .map((c) => ({ channel: c.channel, ...summarize(c.values, c.calls) }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 8)
    }
  };
}

/** 项目维度统计（ZCode 会话目录 / Claude Code cwd / Codex cwd）；ZCode 项目附带代码增删行数 */
async function getProjects(days = 30, limit = 15) {
  const [start, end] = parseRange(days);
  const rows = (await getAllRows(start, end)).filter((r) => r.project);
  // ZCode session 表的 summary_additions/deletions 按项目目录聚合（部分会话未落值则不计）
  const diffByProject = new Map();
  for (const ex of zcode.getSessionExtras().values()) {
    if (!ex.directory) continue;
    const name = path.basename(ex.directory).slice(0, 128);
    if (!name) continue;
    const d = diffByProject.get(name) || { additions: 0, deletions: 0, has: false };
    if (ex.additions != null) { d.additions += ex.additions; d.has = true; }
    if (ex.deletions != null) { d.deletions += ex.deletions; d.has = true; }
    diffByProject.set(name, d);
  }
  const map = new Map();
  for (const r of rows) {
    const p = map.get(r.project) || { project: r.project, tokens: 0, cost: 0, calls: 0 };
    p.tokens += r.totalTokens;
    p.cost += r.cost;
    p.calls += 1;
    map.set(r.project, p);
  }
  const total = [...map.values()].reduce((s, p) => s + p.tokens, 0) || 1;
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, Math.min(Math.max(Number(limit) || 15, 1), 50))
    .map((p, i) => {
      const diff = diffByProject.get(p.project);
      return {
        id: i + 1,
        project: p.project,
        tokens: p.tokens,
        cost: Number(p.cost.toFixed(4)),
        calls: p.calls,
        ratio: Number((p.tokens / total * 100).toFixed(2)),
        additions: diff && diff.has ? diff.additions : null,
        deletions: diff && diff.has ? diff.deletions : null
      };
    });
}

/** 有数据的月份列表（倒序），供月度账单选择 */
async function getBillMonths() {
  const months = new Set();
  for (const r of await getAllRows()) months.add(fmtMonth(r.createdAt));
  return [...months].sort().reverse();
}

/** 单维度聚合小工具 */
function groupBy(rows, keyOf) {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r) || '未知';
    const g = map.get(key) || { name: key, tokens: 0, cost: 0, calls: 0 };
    g.tokens += r.totalTokens;
    g.cost += r.cost;
    g.calls += 1;
    map.set(key, g);
  }
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((g) => ({ name: g.name, tokens: g.tokens, cost: Number(g.cost.toFixed(2)), calls: g.calls }));
}

/** 月度账单：指定月份的渠道 / 模型 / 工具分列汇总 */
async function getBill(month) {
  const m = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return { error: 'month 格式应为 YYYY-MM' };
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(y, mo - 1, 1).getTime();
  const end = new Date(y, mo, 1).getTime();
  const rows = await getAllRows(start, end - 1);
  const dayKeys = new Set(rows.map((r) => fmtDay(r.createdAt)));
  return {
    month: m,
    summary: {
      tokens: rows.reduce((s, r) => s + r.totalTokens, 0),
      cost: Number(rows.reduce((s, r) => s + r.cost, 0).toFixed(2)),
      calls: rows.length,
      active_days: dayKeys.size
    },
    by_channel: groupBy(rows, (r) => r.channel),
    by_model: groupBy(rows, (r) => r.model).slice(0, 20),
    by_tool: groupBy(rows, (r) => r.source)
  };
}

/** 预算状态：今日 / 本月费用对照预算，level = none | warn(≥80%) | danger(≥100%) */
async function getBudgetStatus() {
  const cfg = budget.get();
  const allRows = await getAllRows();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const month0 = new Date(); month0.setDate(1); month0.setHours(0, 0, 0, 0);
  let todayCost = 0;
  let monthCost = 0;
  for (const r of allRows) {
    if (r.createdAt >= today0.getTime()) todayCost += r.cost;
    if (r.createdAt >= month0.getTime()) monthCost += r.cost;
  }
  const todayCostR = Number(todayCost.toFixed(2));
  const monthCostR = Number(monthCost.toFixed(2));
  const dailyRatio = cfg.daily > 0 ? Number((todayCostR / cfg.daily * 100).toFixed(2)) : 0;
  const monthlyRatio = cfg.monthly > 0 ? Number((monthCostR / cfg.monthly * 100).toFixed(2)) : 0;
  let level = 'none';
  if (cfg.enabled) {
    const danger = (cfg.daily > 0 && dailyRatio >= 100) || (cfg.monthly > 0 && monthlyRatio >= 100);
    const warn = (cfg.daily > 0 && dailyRatio >= 80) || (cfg.monthly > 0 && monthlyRatio >= 80);
    if (danger) level = 'danger';
    else if (warn) level = 'warn';
  }
  return {
    enabled: cfg.enabled,
    daily: cfg.daily,
    monthly: cfg.monthly,
    today_cost: todayCostR,
    month_cost: monthCostR,
    daily_ratio: dailyRatio,
    monthly_ratio: monthlyRatio,
    level
  };
}

/** 数据源健康：各来源行数 / 最近使用 / 解密健康状态 */
async function getHealth() {
  const nameOf = new Map(TOOL_LIST.map((t) => [t.id, t.name]));
  nameOf.set('api', '上报接口');
  const rows = await getAllRows();
  const agg = new Map(); // source -> { calls, tokens, lastUsed }
  for (const r of rows) {
    const a = agg.get(r.source) || { calls: 0, tokens: 0, lastUsed: 0 };
    a.calls += 1;
    a.tokens += r.totalTokens;
    if (r.createdAt > a.lastUsed) a.lastUsed = r.createdAt;
    agg.set(r.source, a);
  }
  const sources = SOURCE_LIST.map((src) => {
    const id = src.source;
    const a = agg.get(id) || { calls: 0, tokens: 0, lastUsed: 0 };
    let healthy = true;
    let reason = '';
    if (typeof src.status === 'function') {
      try {
        const s = src.status();
        if (s && typeof s.healthy === 'boolean') {
          healthy = s.healthy;
          reason = String(s.reason || '');
        }
      } catch (e) {
        healthy = false;
        reason = e.message;
      }
    }
    return {
      id,
      name: nameOf.get(id) || id,
      healthy,
      reason,
      calls: a.calls,
      tokens: a.tokens,
      last_used: a.lastUsed ? fmtTime(a.lastUsed) : ''
    };
  });
  return {
    built_at: cacheState.builtAt ? fmtTime(cacheState.builtAt) : '',
    sources,
    // Codex 订阅限额（部分版本在 token_count 中携带；无数据为 null）
    codex_plan: codex.getPlanInfo()
  };
}

/* ---------- 拓展统计：会话 / 错误 / 真实工具调用 ---------- */

/** 来源中文名（会话面板展示用） */
const SOURCE_NAMES = {
  zcode: 'ZCode', 'claude-code': 'Claude Code', codex: 'Codex'
};

/**
 * 会话维度统计：按 source + sessionId 聚合（ZCode / Claude Code / Codex 携带会话标识）。
 * 附带：子代理调用量、失败次数、上下文水位（Codex）、代码增删行数（ZCode）。
 */
async function getSessions(days = 30, limit = 20) {
  const [start, end] = parseRange(days);
  const rows = await getAllRows(start, end);
  const extras = zcode.getSessionExtras();
  const map = new Map(); // key: `${source}::${sessionId}`
  for (const r of rows) {
    if (!r.sessionId) continue;
    const key = `${r.source}::${r.sessionId}`;
    const s = map.get(key) || {
      source: r.source, sessionId: r.sessionId, title: '', project: '',
      tokens: 0, cost: 0, calls: 0, failed: 0, firstAt: Infinity, lastAt: 0,
      models: new Set(), subagentCalls: 0, ctxWindow: 0, ctxUsed: 0
    };
    s.tokens += r.totalTokens;
    s.cost += r.cost;
    s.calls += 1;
    if (r.status !== 1) s.failed += 1;
    if (!s.title && r.sessionTitle) s.title = r.sessionTitle;
    if (!s.project && r.project) s.project = r.project;
    if (r.isSubagent) s.subagentCalls += 1;
    if (r.ctxWindow > s.ctxWindow) s.ctxWindow = r.ctxWindow;
    if (r.ctxUsed > s.ctxUsed) s.ctxUsed = r.ctxUsed;
    s.models.add(r.model);
    if (r.createdAt < s.firstAt) s.firstAt = r.createdAt;
    if (r.createdAt > s.lastAt) s.lastAt = r.createdAt;
    map.set(key, s);
  }
  const list = [...map.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 100))
    .map((s, i) => {
      let additions = null;
      let deletions = null;
      if (s.source === 'zcode') {
        const ex = extras.get(s.sessionId);
        if (ex) {
          if (!s.title && ex.title) s.title = ex.title;
          if (!s.project && ex.directory) s.project = path.basename(ex.directory).slice(0, 128);
          if (ex.additions != null) additions = ex.additions;
          if (ex.deletions != null) deletions = ex.deletions;
        }
      }
      return {
        id: i + 1,
        source: s.source,
        source_name: SOURCE_NAMES[s.source] || s.source,
        session_id: s.sessionId,
        // 无标题的会话用项目名 + 短 ID 兜底展示
        title: s.title || (s.project ? `${s.project} · ${s.sessionId.slice(-6)}` : s.sessionId.slice(-12)),
        project: s.project,
        tokens: s.tokens,
        cost: Number(s.cost.toFixed(4)),
        calls: s.calls,
        failed: s.failed,
        subagent_calls: s.subagentCalls,
        is_subagent_session: s.subagentCalls >= Math.ceil(s.calls / 2),
        model_count: s.models.size,
        ctx_window: s.ctxWindow,
        ctx_used: s.ctxUsed,
        ctx_ratio: s.ctxWindow ? Number(Math.min(100, (s.ctxUsed / s.ctxWindow) * 100).toFixed(1)) : null,
        additions,
        deletions,
        first_at: fmtTime(s.firstAt),
        last_at: fmtTime(s.lastAt)
      };
    });
  return { list, total_sessions: map.size, sources_note: '仅 ZCode / Claude Code / Codex 会话携带会话标识' };
}

/**
 * 会话详情：用量汇总 + 消息预览（消息正文仅 ZCode 提供，文本截断防大响应）。
 */
async function getSessionDetail(sessionId, source = 'zcode') {
  const sid = String(sessionId || '').trim().slice(0, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid)) return { error: 'session_id 格式非法' };
  const src = String(source || '').trim();
  const all = (await getAllRows()).filter((r) => r.sessionId === sid && (!src || r.source === src));
  if (!all.length) return { error: '未找到该会话的用量记录' };
  let tokens = 0;
  let cost = 0;
  let failed = 0;
  const models = new Set();
  let firstAt = Infinity;
  let lastAt = 0;
  let title = '';
  let project = '';
  for (const r of all) {
    tokens += r.totalTokens;
    cost += r.cost;
    if (r.status !== 1) failed += 1;
    models.add(r.model);
    if (!title && r.sessionTitle) title = r.sessionTitle;
    if (!project && r.project) project = r.project;
    if (r.createdAt < firstAt) firstAt = r.createdAt;
    if (r.createdAt > lastAt) lastAt = r.createdAt;
  }
  const detail = {
    session_id: sid,
    source: all[0].source,
    source_name: SOURCE_NAMES[all[0].source] || all[0].source,
    title,
    project,
    summary: {
      tokens, cost: Number(cost.toFixed(4)), calls: all.length, failed,
      model_count: models.size,
      models: [...models].slice(0, 8),
      first_at: fmtTime(firstAt),
      last_at: fmtTime(lastAt)
    },
    messages: []
  };
  if (all[0].source === 'zcode') {
    const m = zcode.getSessionMessages(sid, 60);
    detail.messages = m.messages || [];
    detail.message_total = m.total || 0;
  }
  return detail;
}

/**
 * 错误与中断分析：失败调用 / 错误类型分布 / 用户中断 / 重试 / 上下文超限。
 * 说明：ZCode 的 error_type 在"重试后成功"的行上也会保留（代表过程中真实发生过的错误），
 * 因此"错误事件"独立于"失败调用"统计。
 */
async function getErrors(days = 30) {
  const [start, end] = parseRange(days);
  const rows = await getAllRows(start, end);
  let calls = 0;
  let failed = 0;
  let cancelled = 0;
  let retryCalls = 0;
  let retryTotal = 0;
  let ctxExceeded = 0;
  let errorEvents = 0;
  const byType = new Map();
  const byChannel = new Map();
  for (const r of rows) {
    calls += 1;
    const ch = byChannel.get(r.channel) || { name: r.channel, calls: 0, failed: 0 };
    ch.calls += 1;
    if (r.status !== 1) {
      failed += 1;
      ch.failed += 1;
    }
    if (r.cancelled) cancelled += 1;
    if (r.retryCount > 0) {
      retryCalls += 1;
      retryTotal += r.retryCount;
    }
    if (r.contextExceeded) ctxExceeded += 1;
    const et = r.errorType || (r.status !== 1 ? '未标注' : '');
    if (et) {
      errorEvents += 1;
      const t = byType.get(et) || { name: et, count: 0, lastAt: 0 };
      t.count += 1;
      if (r.createdAt > t.lastAt) t.lastAt = r.createdAt;
      byType.set(et, t);
    }
    byChannel.set(r.channel, ch);
  }
  return {
    calls,
    failed,
    failure_rate: calls ? Number((failed / calls * 100).toFixed(2)) : 0,
    error_events: errorEvents,
    cancelled,
    retry_calls: retryCalls,
    retry_total: retryTotal,
    context_exceeded: ctxExceeded,
    by_type: [...byType.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((t) => ({ name: t.name, count: t.count, last_at: fmtTime(t.lastAt) })),
    by_channel: [...byChannel.values()]
      .filter((c) => c.failed > 0 || c.calls > 0)
      .sort((a, b) => b.failed - a.failed || b.calls - a.calls)
      .slice(0, 8)
      .map((c) => ({
        name: c.name,
        calls: c.calls,
        failed: c.failed,
        failure_rate: c.calls ? Number((c.failed / c.calls * 100).toFixed(2)) : 0
      }))
  };
}

/** 真实工具调用统计（ZCode tool_usage 表聚合；其余工具未暴露该层数据） */
async function getToolUsage(days = 30, limit = 30) {
  const [start, end] = parseRange(days);
  const endMs = end === Infinity ? Number.MAX_SAFE_INTEGER : end;
  return {
    note: '数据来自 ZCode tool_usage 表（其余工具未暴露工具调用层）',
    list: zcode.getToolUsage(start, endMs, limit)
  };
}

module.exports = {
  getOverview, getTrend, getChannels, getModels, getPrices,
  getUsage, getUsageExport, getChannelList, getTools,
  getHeatmap, getLatency, getProjects, getBillMonths, getBill,
  getBudgetStatus, getHealth,
  getSessions, getSessionDetail, getErrors, getToolUsage,
  computeRowCost, cachePricesFor,
  invalidate, warmup
};
