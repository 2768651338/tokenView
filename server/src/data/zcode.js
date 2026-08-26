/**
 * 数据源：ZCode 本地 SQLite（只读直查，无需同步）
 * 使用 Node 内置 node:sqlite，WAL 模式下可与运行中的 ZCode 并发读。
 * 渠道名映射读取 ~/.zcode/v2/config.json（provider UUID -> 渠道名）。
 *
 * 性能：常驻只读连接 + 内存行缓存，按 started_at 索引增量同步；
 * 无新数据时每轮同步只有一条 MAX(started_at) 索引查询。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = path.resolve(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
const DEFAULT_CONFIG = path.resolve(os.homedir(), '.zcode', 'v2', 'config.json');

/** 增量同步回看窗口：覆盖近期行的状态更新 */
const OVERLAP_MS = 60 * 60 * 1000;

let providerMapCache = null;

/** 环境变量可覆盖路径：统一规范化，杜绝 ../ 相对穿越 */
function normalizeOverride(v) {
  return v ? path.resolve(v) : '';
}

/** provider_id -> { name, kind }（兼容嵌套与扁平结构） */
function providerMap() {
  if (providerMapCache) return providerMapCache;
  const map = {};
  const configPath = normalizeOverride(process.env.ZCODE_CONFIG_PATH) || DEFAULT_CONFIG;
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const providers = data.provider && typeof data.provider === 'object' ? data.provider : data;
    for (const [id, info] of Object.entries(providers)) {
      if (info && typeof info === 'object' && typeof info.name === 'string') {
        map[id] = { name: info.name, kind: typeof info.kind === 'string' ? info.kind : '' };
      }
    }
    // 扁平结构兜底
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== 'string') continue;
      const parts = key.split('.name.');
      if (parts.length === 2 && parts[0].startsWith('provider.')) {
        const id = parts[0].slice('provider.'.length);
        map[id] = map[id] || { name: parts[1], kind: '' };
      }
    }
  } catch (e) {
    console.warn('[zcode] 读取 config.json 失败，渠道名将使用 provider 短 ID:', e.message);
  }
  providerMapCache = map;
  return map;
}

function channelOf(providerId) {
  const p = providerMap()[providerId] || {};
  return {
    channel: p.name || `渠道-${String(providerId).slice(0, 8)}`,
    kind: p.kind || ''
  };
}

/** 原始记录 -> 统一行结构 */
function toRow(r) {
  const { channel, kind } = channelOf(r.provider_id);
  const prompt = Number(r.input_tokens) || 0;
  const completion = (Number(r.output_tokens) || 0) + (Number(r.reasoning_tokens) || 0);
  const total = Number(r.computed_total_tokens) || 0
    || (prompt + completion + (Number(r.cache_creation_input_tokens) || 0) + (Number(r.cache_read_input_tokens) || 0));
  return {
    requestId: 'zcode:' + r.id,
    channel,
    channelKind: kind,
    model: r.model_id,
    source: 'zcode',
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    latencyMs: Number(r.duration_ms) || 0,
    status: r.status === 'completed' ? 1 : 0,
    remark: ['agent=' + (r.agent || ''), 'mode=' + (r.mode || ''), 'src=' + (r.query_source || ''), 'task=' + (r.task_type || '')].join(' ').slice(0, 255),
    createdAt: Number(r.started_at) || 0 // epoch ms
  };
}

/* ---------- 连接与增量缓存 ---------- */

const conn = { db: null, dbPath: '' };
const state = { rowsById: new Map(), sortedRows: null, maxStartedAt: 0 };

function closeDb() {
  try {
    if (conn.db) conn.db.close();
  } catch { /* 已关闭或句柄失效 */ }
  conn.db = null;
  conn.dbPath = '';
}

function resetState() {
  state.rowsById.clear();
  state.sortedRows = null;
  state.maxStartedAt = 0;
}

function syncIncremental() {
  const firstLoad = state.rowsById.size === 0;
  if (!firstLoad) {
    // 索引上的 MAX 查询近乎零开销；无新数据直接返回
    const peak = conn.db.prepare('SELECT MAX(started_at) AS m FROM model_usage').get();
    if (!peak || Number(peak.m) <= state.maxStartedAt) return;
  }
  const since = firstLoad ? 0 : state.maxStartedAt - OVERLAP_MS;
  const stmt = conn.db.prepare(`
    SELECT id, provider_id, model_id, status, started_at, duration_ms,
           input_tokens, output_tokens, reasoning_tokens,
           cache_creation_input_tokens, cache_read_input_tokens,
           computed_total_tokens, agent, mode, task_type, query_source
    FROM model_usage
    WHERE started_at >= ?
    ORDER BY started_at ASC
  `);
  let added = 0;
  for (const r of stmt.all(since)) {
    if (!state.rowsById.has(r.id)) added++;
    state.rowsById.set(r.id, toRow(r));
    const ts = Number(r.started_at) || 0;
    if (ts > state.maxStartedAt) state.maxStartedAt = ts;
  }
  if (added > 0) state.sortedRows = null;
}

/** 确保连接可用并与数据库同步一次 */
function ensureSynced() {
  const dbPath = normalizeOverride(process.env.ZCODE_DB_PATH) || DEFAULT_DB;
  if (!fs.existsSync(dbPath)) throw new Error(`ZCode 数据库不存在: ${dbPath}`);
  if (!conn.db || conn.dbPath !== dbPath) {
    closeDb();
    resetState(); // 换库后缓存作废
    conn.db = openDb(dbPath);
    conn.dbPath = dbPath;
  }
  syncIncremental();
}

function openDb(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** 提取时间范围内全部记录（用于聚合与分页） */
function getRows(startMs = 0, endMs = Infinity) {
  try {
    ensureSynced();
  } catch (e) {
    // 库文件被替换/迁移等异常：重置后重试一次
    closeDb();
    resetState();
    ensureSynced();
  }
  if (!state.sortedRows) {
    state.sortedRows = [...state.rowsById.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return state.sortedRows.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

module.exports = { getRows, source: 'zcode' };
