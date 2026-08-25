/**
 * 统计聚合层：合并 ZCode + Claude Code + 上报 三个数据源，
 * 统一行结构：
 *   { requestId, channel, channelKind, model, source,
 *     promptTokens, completionTokens, totalTokens, cost,
 *     latencyMs, status, remark, createdAt(epoch ms) }
 */
const zcode = require('./zcode');
const claudeCode = require('./claude-code');
const codex = require('./codex');
const workbuddy = require('./workbuddy');
const lobsterai = require('./lobsterai');
const joyclaw = require('./joyclaw');
const codebuddyCn = require('./codebuddy-cn');
const qoder = require('./qoder');
const reports = require('./reports');
const priceTable = require('./custom-prices');

/** 固定工具清单（展示顺序与用户定义一致） */
const TOOL_LIST = [
  { id: 'zcode', name: 'ZCode' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN' },
  { id: 'joyclaw', name: 'JoyClaw' },
  { id: 'kimi', name: 'Kimi' },
  { id: 'lobsterai', name: 'LobsterAI' },
  { id: 'opensquilla', name: 'OpenSquilla' },
  { id: 'qoder', name: 'Qoder' },
  { id: 'trae', name: 'Trae' },
  { id: 'trae-cn', name: 'Trae CN' },
  { id: 'trae-solo-cn', name: 'TRAE SOLO CN' },
  { id: 'workbuddy', name: 'WorkBuddy' },
  { id: 'coze', name: '扣子' }
];

/** 全部数据源适配器（source 即工具标识） */
const SOURCES = { zcode, claudeCode, codex, workbuddy, lobsterai, joyclaw, codebuddyCn, qoder };

/* ---------- 工具 ---------- */

/** 模型单价（元 / 1K tokens）：默认表 + 自定义覆盖 */
function priceOf(modelName) {
  const p = priceTable.getPrices()[modelName] || {};
  return { input: Number(p.input) || 0, output: Number(p.output) || 0 };
}

/** 按单价补全费用 */
function withCost(row) {
  const p = priceOf(row.model);
  row.cost = Number(((row.promptTokens * p.input + row.completionTokens * p.output) / 1000).toFixed(4));
  return row;
}

/** 解析时间范围：最近 N 天（含今天），返回 [startMs, endMs] */
function parseRange(days = 7) {
  const end = Date.now();
  const start = new Date();
  start.setDate(start.getDate() - (Number(days) - 1));
  start.setHours(0, 0, 0, 0);
  return [start.getTime(), end];
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

/** 合并全部数据源（默认带费用计算） */
function getAllRows(startMs = 0, endMs = Infinity) {
  const rows = [
    ...zcode.getRows(startMs, endMs),
    ...claudeCode.getRows(startMs, endMs),
    ...codex.getRows(startMs, endMs),
    ...workbuddy.getRows(startMs, endMs),
    ...lobsterai.getRows(startMs, endMs),
    ...joyclaw.getRows(startMs, endMs),
    ...codebuddyCn.getRows(startMs, endMs),
    ...qoder.getRows(startMs, endMs),
    ...reports.getRows(startMs, endMs)
  ].map(withCost);
  // 上报数据按 tool 字段归属工具（未填 tool 归入 api）
  for (const r of rows) {
    if (r.source === 'api' && r.tool) {
      r.source = normalizeTool(r.tool);
    }
  }
  return rows;
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
function getOverview(days = 30) {
  const [start, end] = parseRange(days);
  const allRows = getAllRows(); // 全量（ZCode ~10k 行，本地毫秒级）

  const totalCalls = allRows.length;
  const totalTokens = allRows.reduce((s, r) => s + r.totalTokens, 0);
  const totalCost = allRows.reduce((s, r) => s + r.cost, 0);
  const successCalls = allRows.filter((r) => r.status === 1).length;
  const activeChannels = new Set(allRows.map((r) => r.channel)).size;

  const periodRows = allRows.filter((r) => r.createdAt >= start && r.createdAt <= end);
  const periodTokens = periodRows.reduce((s, r) => s + r.totalTokens, 0);
  const periodCost = periodRows.reduce((s, r) => s + r.cost, 0);

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const y0 = new Date(today0); y0.setDate(y0.getDate() - 1);
  const todayRows = allRows.filter((r) => r.createdAt >= today0.getTime());
  const yesterdayRows = allRows.filter((r) => r.createdAt >= y0.getTime() && r.createdAt < today0.getTime());
  const todayTokens = todayRows.reduce((s, r) => s + r.totalTokens, 0);
  const todayCost = todayRows.reduce((s, r) => s + r.cost, 0);
  const yesterdayTokens = yesterdayRows.reduce((s, r) => s + r.totalTokens, 0);
  const todayDelta = yesterdayTokens > 0 ? ((todayTokens - yesterdayTokens) / yesterdayTokens) * 100 : null;

  const dayKeys = new Set(periodRows.map((r) => fmtDay(r.createdAt)));
  const avgDailyTokens = dayKeys.size ? periodTokens / dayKeys.size : 0;

  return {
    total_tokens: totalTokens,
    total_cost: Number(totalCost.toFixed(2)),
    total_calls: totalCalls,
    active_channels: activeChannels,
    success_rate: totalCalls ? Number((successCalls / totalCalls * 100).toFixed(2)) : 100,
    period_tokens: periodTokens,
    period_cost: Number(periodCost.toFixed(2)),
    today_tokens: todayTokens,
    today_cost: Number(todayCost.toFixed(2)),
    today_calls: todayRows.length,
    today_delta: todayDelta === null ? null : Number(todayDelta.toFixed(2)),
    avg_daily_tokens: Math.round(avgDailyTokens),
    range_days: Number(days)
  };
}

/** 时间趋势 */
function getTrend(days = 30, granularity = 'day', channel = '') {
  const [start, end] = parseRange(days);
  const rows = getAllRows(start, end).filter((r) => !channel || r.channel === channel);

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
function getChannels(days = 7) {
  const [start, end] = parseRange(days);
  const rows = getAllRows(start, end);
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
function getModels(days = 7, limit = 10) {
  const [start, end] = parseRange(days);
  const rows = getAllRows(start, end);
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
function getPrices() {
  const rows = getAllRows();
  const effective = priceTable.getPrices();
  const customMap = priceTable.getCustomMap();
  const defaultsMap = priceTable.getDefaults();
  const map = new Map();
  for (const r of rows) {
    const key = `${r.channel}::${r.model}`;
    const m = map.get(key) || { channel: r.channel, model: r.model, tokens: 0, cost: 0, calls: 0 };
    m.tokens += r.totalTokens;
    m.cost += r.cost;
    m.calls += 1;
    map.set(key, m);
  }
  // 价表中存在但尚无用量的模型（如新增自定义价），追加在列表末尾
  const seen = new Set([...map.values()].map((m) => m.model));
  for (const model of Object.keys(effective)) {
    if (!seen.has(model)) map.set(`__price_only__::${model}`, { channel: '', model, tokens: 0, cost: 0, calls: 0 });
  }
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
        has_default: m.model in defaultsMap
      };
    });
}

/** 调用明细分页 */
function getUsage({ page = 1, pageSize = 20, channel = '', status = '', start = '', end = '', source = '' } = {}) {
  let rows = getAllRows();
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
function getChannelList() {
  const names = new Map();
  for (const r of getAllRows()) {
    if (!names.has(r.channel)) names.set(r.channel, r.channelKind || r.channel);
  }
  return [...names.entries()].map(([name, provider], i) => ({
    id: i + 1, name, provider, enabled: 1, remark: ''
  }));
}

/** 工具统计：固定 13 工具清单 + 聚合数据 + 状态 */
function getTools() {
  const rows = getAllRows();
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
  getUsage, getChannelList, getTools
};
