/**
 * 数据源：ZCode 本地 SQLite（只读直查，无需同步）
 * 使用 Node 内置 node:sqlite，WAL 模式下可与运行中的 ZCode 并发读。
 * 渠道名映射读取 ~/.zcode/v2/config.json（provider UUID -> 渠道名）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
const DEFAULT_CONFIG = path.join(os.homedir(), '.zcode', 'v2', 'config.json');

let providerMapCache = null;

/** provider_id -> { name, kind }（兼容嵌套与扁平结构） */
function providerMap() {
  if (providerMapCache) return providerMapCache;
  const map = {};
  const configPath = process.env.ZCODE_CONFIG_PATH || DEFAULT_CONFIG;
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

/** 打开只读连接（每次查询独立打开，避免句柄长期占用） */
function openDb() {
  const dbPath = process.env.ZCODE_DB_PATH || DEFAULT_DB;
  if (!fs.existsSync(dbPath)) throw new Error(`ZCode 数据库不存在: ${dbPath}`);
  return new DatabaseSync(dbPath, { readOnly: true });
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

/** 提取时间范围内全部记录（用于聚合与分页） */
function getRows(startMs = 0, endMs = Infinity) {
  const db = openDb();
  try {
    const stmt = db.prepare(`
      SELECT id, provider_id, model_id, status, started_at, duration_ms,
             input_tokens, output_tokens, reasoning_tokens,
             cache_creation_input_tokens, cache_read_input_tokens,
             computed_total_tokens, agent, mode, task_type, query_source
      FROM model_usage
      WHERE started_at >= ? AND started_at <= ?
      ORDER BY started_at ASC
    `);
    return stmt.all(startMs, endMs).map(toRow);
  } finally {
    db.close();
  }
}

module.exports = { getRows, source: 'zcode' };
