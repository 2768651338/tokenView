/**
 * 数据源：OpenCode 本地 SQLite（只读直查，无需同步）
 * 库文件 ~/.local/share/opencode/opencode.db，assistant 消息行 data 列为 JSON：
 *   { role, modelID, providerID, tokens: { input, output, reasoning, cache: { read, write } },
 *     cost, error?, time: { created(ms), completed? } }
 * 兼容两代表：session_message（新，含 type/seq）与 message（旧迁移遗留），
 * 两表按消息 id 去重合并；官方 schema 字段缺失时逐条跳过，不影响其他数据。
 *
 * 防呆：库文件/表不存在（尚未使用或旧版本）时告警并返回空数组，
 * 不向上抛错，避免单个空源拖垮整体聚合。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { inferChannel } = require('./claude-code');

const DEFAULT_DB = path.resolve(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const REFRESH_INTERVAL_MS = 5000;

/** 增量同步回看窗口：覆盖近期行的状态更新 */
const OVERLAP_MS = 60 * 60 * 1000;

/** 时间戳兜底：官方为 epoch ms，防御性兼容秒级值 */
function toMs(t) {
  const n = Number(t) || 0;
  return n > 1e12 ? n : n * 1000;
}

/** assistant 消息 data JSON -> 统一行结构；字段不完整返回 null */
function toRow(id, obj) {
  if (!obj || obj.role !== 'assistant' || !obj.tokens) return null;
  const model = String(obj.modelID || '') || 'unknown';
  const u = obj.tokens;
  const prompt = (Number(u.input) || 0) + (Number(u.cache?.write) || 0);
  const completion = (Number(u.output) || 0) + (Number(u.reasoning) || 0);
  const total = prompt + completion + (Number(u.cache?.read) || 0);
  if (!total) return null; // 空消息（如中断占位）不入库
  const created = toMs(obj.time && obj.time.created);
  const completed = toMs(obj.time && obj.time.completed);
  const remark = [
    obj.agent ? 'agent=' + obj.agent : '',
    obj.mode ? 'mode=' + obj.mode : '',
    Number(obj.cost) > 0 ? 'cost=' + Number(obj.cost).toFixed(4) : ''
  ].filter(Boolean).join(' ').slice(0, 255);
  return {
    requestId: 'opencode:' + id,
    channel: inferChannel(model),
    channelKind: String(obj.providerID || ''),
    model,
    source: 'opencode',
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    latencyMs: completed > created ? Math.min(completed - created, 24 * 3600000) : 0,
    status: obj.error ? 0 : 1,
    remark,
    createdAt: created
  };
}

/* ---------- 连接与增量缓存 ---------- */

const conn = { db: null, dbPath: '', warned: false };
const state = { rowsById: new Map(), sortedRows: null, maxCreated: 0 };

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
  state.maxCreated = 0;
}

/** 单表增量拉取；表不存在（旧版本库）视为无数据 */
function syncTable(table) {
  let stmt;
  try {
    stmt = conn.db.prepare(`SELECT id, time_created, data FROM ${table} WHERE time_created >= ?`);
  } catch {
    return; // 表不存在
  }
  for (const r of stmt.all(state.maxCreated - OVERLAP_MS)) {
    if (state.rowsById.has(r.id)) continue;
    let row = null;
    try {
      row = toRow(r.id, JSON.parse(String(r.data)));
    } catch { // data 非法 JSON：跳过该行
    }
    if (!row) continue;
    state.rowsById.set(r.id, row);
    const ts = Number(r.time_created) || 0;
    if (ts > state.maxCreated) state.maxCreated = ts;
  }
}

function syncIncremental() {
  syncTable('session_message'); // 新版
  syncTable('message');         // 旧版（id 去重，迁移副本不会重复计数）
  state.sortedRows = null;
}

function ensureSynced() {
  const dbPath = process.env.OPENCODE_DB_PATH ? path.resolve(process.env.OPENCODE_DB_PATH) : DEFAULT_DB;
  if (!fs.existsSync(dbPath)) {
    if (!conn.warned) console.warn(`[opencode] 数据库不存在（未安装或从未使用）: ${dbPath}`);
    conn.warned = true;
    return false;
  }
  conn.warned = false;
  if (!conn.db || conn.dbPath !== dbPath) {
    closeDb();
    resetState(); // 换库后缓存作废
    conn.db = new DatabaseSync(dbPath, { readOnly: true });
    conn.dbPath = dbPath;
    state.maxCreated = 0; // 新连接全量加载
  }
  syncIncremental();
  return true;
}

/** 提取时间范围内全部记录（用于聚合与分页） */
function getRows(startMs = 0, endMs = Infinity) {
  try {
    ensureSynced();
  } catch (e) {
    // 库文件被替换/迁移等异常：重置后重试一次，仍失败则本轮视为无数据
    closeDb();
    resetState();
    try {
      ensureSynced();
    } catch (e2) {
      console.warn('[opencode] 数据读取失败，本轮回退为空:', e2.message);
      return [];
    }
  }
  if (!state.sortedRows) {
    state.sortedRows = [...state.rowsById.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return state.sortedRows.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

module.exports = { getRows, source: 'opencode' };
