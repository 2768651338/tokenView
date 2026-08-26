/**
 * 数据源：CC Switch 本地 SQLite（只读直查）
 * 库文件 ~/.cc-switch/cc-switch.db，用量数据在 usage_daily_rollups 按天汇总表
 * （date/app_type/provider_id/model 六元组主键），供应商名取 providers 表。
 *
 * 注意：该表数据源自 Claude Code / Codex 等会话日志，与 claude-code、codex
 * 渠道存在重叠；按需求全量导入，重复部分由使用者自行知悉。
 *
 * input_token_semantics 口径（源自 cc-switch schema.rs 注释）：
 *   0 = 旧版未知（旧 Codex 行：input 已含 cache read，不含 cache creation）
 *   1 = total-inclusive（input 已含全部缓存 token）
 *   2 = fresh（input 为纯新增，缓存 read/write 单列）
 *
 * 防呆：库文件不存在时告警并返回空数组，不向上抛错；
 * 行数无变化时跳过重读（COUNT(*) 走主键索引，开销极低）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = path.resolve(os.homedir(), '.cc-switch', 'cc-switch.db');
const REFRESH_INTERVAL_MS = 5000;

/** cc-switch 内部合成 provider_id 的展示别名 */
const PROVIDER_ALIASES = {
  _codex_session: 'Codex 会话直连'
};

/** 'YYYY-MM-DD' -> 当地零点 epoch ms；非法值返回 0 */
function dayToMs(date) {
  const parts = String(date || '').split('-');
  if (parts.length !== 3) return 0;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  // 宽松校验：年月日均为有限数字且月份在 1-12
  if (![y, mo, d].every(Number.isFinite) || mo < 1 || mo > 12) return 0;
  return new Date(y, mo - 1, d).getTime();
}

/** 渠道名解析：providers 表名优先，合成/已删 provider 走别名，再兜底短 ID */
function providerNameOf(providerId) {
  return state.providerMap[providerId] || PROVIDER_ALIASES[providerId] || `渠道-${String(providerId).slice(0, 8)}`;
}

/** 汇总行 -> 统一行结构 */
function toRow(r, providerName) {
  const createdAt = dayToMs(r.date);
  const output = Number(r.output_tokens) || 0;
  const cacheRead = Number(r.cache_read_tokens) || 0;
  const cacheWrite = Number(r.cache_creation_tokens) || 0;
  let prompt;
  let total;
  if (Number(r.input_token_semantics) === 1) {
    // input 已含全部缓存
    prompt = Number(r.input_tokens) || 0;
    total = prompt + output;
  } else {
    // 0 与 2：input 均不含 cache creation，需并入 prompt；
    // 差异仅在 cache read 是否已含于 input（0 已含 / 2 未含）
    prompt = (Number(r.input_tokens) || 0) + cacheWrite;
    total = prompt + output + (Number(r.input_token_semantics) === 2 ? cacheRead : 0);
  }
  return {
    requestId: ['cc-switch', r.date, r.app_type, r.provider_id, r.model, r.request_model, r.pricing_model].join(':'),
    channel: providerName,
    channelKind: String(r.app_type || ''),
    model: String(r.model || 'unknown'),
    source: 'cc-switch',
    promptTokens: prompt,
    completionTokens: output,
    totalTokens: total,
    latencyMs: Math.round(Number(r.avg_latency_ms) || 0),
    status: (Number(r.success_count) || 0) > 0 ? 1 : 0,
    remark: `app=${r.app_type} reqs=${r.request_count} ok=${r.success_count} usd=${Number(r.total_cost_usd || 0).toFixed(4)}`.slice(0, 255),
    createdAt
  };
}

/* ---------- 连接与行数门控缓存 ---------- */

const conn = { db: null, dbPath: '', warned: false };
// count 缓存：rollup 行数与供应商数任一变化才触发重读
const state = { rollupCount: -1, providerCount: -1, providerMap: {}, rows: [] };

function closeDb() {
  try {
    if (conn.db) conn.db.close();
  } catch { /* 已关闭或句柄失效 */ }
  conn.db = null;
  conn.dbPath = '';
}

function resetState() {
  state.rollupCount = -1;
  state.providerCount = -1;
  state.providerMap = {};
  state.rows = [];
}

function loadProviders() {
  try {
    const n = conn.db.prepare('SELECT COUNT(*) AS c FROM providers').get().c;
    if (n === state.providerCount) return;
    state.providerCount = n;
    state.providerMap = {};
    for (const p of conn.db.prepare('SELECT id, name FROM providers').all()) {
      state.providerMap[p.id] = p.name || '';
    }
  } catch { // providers 表缺失：全部走兜底名
    state.providerCount = -2;
    state.providerMap = {};
  }
}

function loadRollups() {
  const n = conn.db.prepare('SELECT COUNT(*) AS c FROM usage_daily_rollups').get().c;
  if (n === state.rollupCount && state.rows.length) return;
  state.rollupCount = n;
  const stmt = conn.db.prepare(`
    SELECT date, app_type, provider_id, model, request_model, pricing_model,
           request_count, success_count, input_tokens, output_tokens,
           cache_read_tokens, cache_creation_tokens, input_token_semantics,
           total_cost_usd, avg_latency_ms
    FROM usage_daily_rollups
  `);
  state.rows = [];
  for (const r of stmt.all()) {
    const row = toRow(r, providerNameOf(r.provider_id));
    if (row.createdAt) state.rows.push(row); // 日期非法的行丢弃
  }
  state.rows.sort((a, b) => a.createdAt - b.createdAt);
}

function ensureSynced() {
  const dbPath = process.env.CC_SWITCH_DB_PATH ? path.resolve(process.env.CC_SWITCH_DB_PATH) : DEFAULT_DB;
  if (!fs.existsSync(dbPath)) {
    if (!conn.warned) console.warn(`[cc-switch] 数据库不存在（未安装或从未使用）: ${dbPath}`);
    conn.warned = true;
    return false;
  }
  conn.warned = false;
  if (!conn.db || conn.dbPath !== dbPath) {
    closeDb();
    resetState(); // 换库后缓存作废
    conn.db = new DatabaseSync(dbPath, { readOnly: true });
    conn.dbPath = dbPath;
  }
  loadProviders();
  loadRollups();
  return true;
}

/** 提取时间范围内全部记录（用于聚合与分页） */
function getRows(startMs = 0, endMs = Infinity) {
  try {
    ensureSynced();
  } catch (e) {
    // 库文件被替换等异常：重置后重试一次，仍失败则本轮视为无数据
    closeDb();
    resetState();
    try {
      ensureSynced();
    } catch (e2) {
      console.warn('[cc-switch] 数据读取失败，本轮回退为空:', e2.message);
      return [];
    }
  }
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return state.rows.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

module.exports = { getRows, source: 'cc-switch' };
