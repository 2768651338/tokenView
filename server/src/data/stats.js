/**
 * 统计聚合层：合并 ZCode + Claude Code + 上报 等数据源，
 * 统一行结构：
 *   { requestId, channel, channelKind, model, source,
 *     promptTokens, completionTokens, totalTokens, cost,
 *     latencyMs, status, remark, createdAt(epoch ms) }
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

/** 模型单价（元 / 1K tokens）：默认表 + 自定义覆盖 */
function priceOf(modelName) {
  const p = priceTable.getPrices()[modelName] || {};
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
  const prices = priceTable.getPrices(); // 整轮构建只取一次价表
  const rows = [];
  for (const part of parts) {
    for (const r of part) {
      const p = prices[r.model] || {};
      const input = Number(p.input) || 0;
      const output = Number(p.output) || 0;
      let source = r.source;
      // 上报数据按 tool 字段归属工具（未填 tool 归入 api）
      if (source === 'api' && r.tool) source = normalizeTool(r.tool);
      rows.push({
        ...r,
        source,
        cost: Number(((r.promptTokens * input + r.completionTokens * output) / 1000).toFixed(4))
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

/* ---------- 时间工具 ---------- */

/** 解析时间范围：最近 N 天（含今天），返回 [startMs, endMs] */
function parseRange(days = 7) {
  const end = Date.now();
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
  let todayTokens = 0;
  let todayCost = 0;
  let yesterdayTokens = 0;
  const channels = new Set();
  const dayKeys = new Set();

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const y0 = new Date(today0); y0.setDate(y0.getDate() - 1);
  const todayMs = today0.getTime();
  const yMs = y0.getTime();

  for (const r of allRows) {
    totalTokens += r.totalTokens;
    totalCost += r.cost;
    if (r.status === 1) successCalls++;
    channels.add(r.channel);
    if (r.createdAt >= start && r.createdAt <= end) {
      periodTokens += r.totalTokens;
      periodCost += r.cost;
      dayKeys.add(fmtDay(r.createdAt));
    }
    if (r.createdAt >= todayMs) {
      todayTokens += r.totalTokens;
      todayCost += r.cost;
    } else if (r.createdAt >= yMs && r.createdAt < todayMs) {
      yesterdayTokens += r.totalTokens;
    }
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
    today_tokens: todayTokens,
    today_cost: Number(todayCost.toFixed(2)),
    today_calls: allRows.filter((r) => r.createdAt >= todayMs).length,
    today_delta: todayDelta === null ? null : Number(todayDelta.toFixed(2)),
    avg_daily_tokens: Math.round(avgDailyTokens),
    range_days: Number(days)
  };
}

/** 时间趋势 */
async function getTrend(days = 30, granularity = 'day', channel = '') {
  const [start, end] = parseRange(days);
  const rows = (await getAllRows(start, end)).filter((r) => !channel || r.channel === channel);

  const buckets = new Map();
  for (const r of rows) {
    const label = bucketLabel(r.createdAt, granularity);
    const b = buckets.get(label) || { label, tokens: 0, cost: 0, calls: 0 };
    b.tokens += r.totalTokens;
    b.cost += r.cost;
    b.calls += 1;
    buckets.set(label, b);
  }

  let list = [...buckets.values()].sort((a, b) => a.label < b.label ? -1 : 1);
  // 补齐缺失日期（按天粒度），保证曲线连续
  if (granularity === 'day') {
    const map = new Map(list.map((b) => [b.label, b]));
    list = [];
    for (let t = start; t <= end; t += 86400000) {
      const label = fmtDay(t);
      list.push(map.get(label) || { label, tokens: 0, cost: 0, calls: 0 });
    }
  }
  return { granularity, days: Number(days), list };
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
  const effective = priceTable.getPrices();
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
  // 价表中存在但尚无用量的模型（如在线同步/新增自定义价），追加在列表末尾（按模型名排序）
  const seen = new Set([...map.values()].map((m) => m.model));
  const priceOnly = Object.keys(effective)
    .filter((model) => !seen.has(model))
    .sort((a, b) => a.localeCompare(b))
    .map((model) => [`__price_only__::${model}`, { channel: '', model, tokens: 0, cost: 0, calls: 0 }]);
  for (const [k, v] of priceOnly) map.set(k, v);
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens)
    .map((m, i) => {
      const p = priceOf(m.model);
      return {
        id: i + 1,
        model: m.model,
        channel: m.channel,
        input_per_million: Number((p.input * 1000).toFixed(2)),
        output_per_million: Number((p.output * 1000).toFixed(2)),
        cost: Number(m.cost.toFixed(2)),
        calls: m.calls,
        tokens: m.tokens,
        custom: !!customMap[m.model],
        has_default: m.model in defaultsMap,
        source: priceTable.getLayer(m.model)
      };
    });
}

/** 调用明细分页 */
async function getUsage({ page = 1, pageSize = 20, channel = '', status = '', start = '', end = '', source = '' } = {}) {
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
  rows.sort((a, b) => b.createdAt - a.createdAt);

  const total = rows.length;
  const offset = (Number(page) - 1) * Number(pageSize);
  const list = rows.slice(offset, offset + Number(pageSize)).map((r, i) => ({
    id: total - offset - i, // 倒序展示 ID
    request_id: r.requestId,
    channel: r.channel,
    model: r.model,
    prompt_tokens: r.promptTokens,
    completion_tokens: r.completionTokens,
    total_tokens: r.totalTokens,
    cost: r.cost.toFixed(4),
    latency_ms: r.latencyMs,
    status: r.status,
    created_at: fmtTime(r.createdAt)
  }));

  return { page: Number(page), pageSize: Number(pageSize), total, list };
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
    // 加密类适配器解密失败时标记
    const src = SOURCES[t.id];
    if (src && src.status && src.status().healthy === false) status = '解密失败';
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

module.exports = {
  getOverview, getTrend, getChannels, getModels, getPrices,
  getUsage, getChannelList, getTools,
  invalidate, warmup
};
