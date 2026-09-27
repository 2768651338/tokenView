/**
 * 数据源：ZCode 本地 SQLite（只读直查，无需同步）
 * 使用 Node 内置 node:sqlite，WAL 模式下可与运行中的 ZCode 并发读。
 * 渠道名映射读取 ~/.zcode/v2/config.json（provider UUID -> 渠道名）。
 *
 * 数据位置解析优先级：环境变量（ZCODE_DB_PATH / ZCODE_CONFIG_PATH）
 * > 设置文件中的 zcode_dir（用户在界面手动指定 .zcode 根目录，见 settings.js）
 * > 默认 ~/.zcode。库文件缺失时本源返回空数组并在 status() 中说明原因，
 * 不再向上抛错拖垮整个统计构建。
 *
 * 性能：常驻只读连接 + 内存行缓存，按 started_at 索引增量同步；
 * 无新数据时每轮同步只有一条 MAX(started_at) 索引查询。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const settings = require('./settings');

const DEFAULT_DB = path.resolve(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
const DEFAULT_CONFIG = path.resolve(os.homedir(), '.zcode', 'v2', 'config.json');

/** 增量同步回看窗口：覆盖近期行的状态更新 */
const OVERLAP_MS = 60 * 60 * 1000;

/** 环境变量可覆盖路径：统一规范化，杜绝 ../ 相对穿越 */
function normalizeOverride(v) {
  return v ? path.resolve(v) : '';
}

/* ---------- 路径解析（env > 设置 > 默认） ---------- */

/** 解析 db / config 路径与来源标识 */
function resolvePaths() {
  const dbEnv = normalizeOverride(process.env.ZCODE_DB_PATH);
  const cfgEnv = normalizeOverride(process.env.ZCODE_CONFIG_PATH);
  let customDir = '';
  try {
    customDir = String(settings.getZcodeDir() || '').trim();
  } catch { /* 设置读取失败按未设置处理 */ }
  const dir = customDir ? path.resolve(customDir) : '';
  return {
    dbPath: dbEnv || (dir ? path.join(dir, 'cli', 'db', 'db.sqlite') : DEFAULT_DB),
    configPath: cfgEnv || (dir ? path.join(dir, 'v2', 'config.json') : DEFAULT_CONFIG),
    source: dbEnv || cfgEnv ? 'env' : (dir ? 'settings' : 'default'),
    defaultDb: DEFAULT_DB
  };
}

/** provider_id -> { name, kind }（兼容嵌套与扁平结构）；按 config 路径 + mtime 缓存 */
let providerMapCache = null;

function providerMap(configPath) {
  let st = null;
  try {
    st = fs.statSync(configPath);
  } catch { /* config 不存在：使用短 ID 兜底 */ }
  if (providerMapCache && providerMapCache.path === configPath && st
    && providerMapCache.mtimeMs === st.mtimeMs && providerMapCache.size === st.size) {
    return providerMapCache.map;
  }
  const map = {};
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
  providerMapCache = { path: configPath, mtimeMs: st ? st.mtimeMs : null, size: st ? st.size : null, map };
  return map;
}

function channelOf(providerId, configPath) {
  const p = providerMap(configPath)[providerId] || {};
  return {
    channel: p.name || `渠道-${String(providerId).slice(0, 8)}`,
    kind: p.kind || ''
  };
}

/** 原始记录 -> 统一行结构（含会话归属 / 错误 / TTFT / 子代理等扩展字段） */
function toRow(r, configPath) {
  const { channel, kind } = channelOf(r.provider_id, configPath);
  // ZCode 的 input_tokens 已含缓存读（OpenAI 口径，经 computed_total_tokens 对账确认），
  // 拆分后 promptTokens 只保留纯输入；缓存写列当前恒为 0，按"input 不含缓存写"处理
  const inputRaw = Number(r.input_tokens) || 0;
  const cacheRead = Number(r.cache_read_input_tokens) || 0;
  const cacheWrite = Number(r.cache_creation_input_tokens) || 0;
  const prompt = Math.max(0, inputRaw - cacheRead);
  const completion = (Number(r.output_tokens) || 0) + (Number(r.reasoning_tokens) || 0);
  const total = Number(r.computed_total_tokens) || 0 || (prompt + completion + cacheWrite + cacheRead);
  const sessionDir = typeof r.session_directory === 'string' ? r.session_directory : '';
  const sessionTaskType = r.session_task_type || r.task_type || '';
  return {
    requestId: 'zcode:' + r.id,
    channel,
    channelKind: kind,
    model: r.model_id,
    source: 'zcode',
    promptTokens: prompt,
    completionTokens: completion,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: total,
    project: sessionDir ? path.basename(sessionDir).slice(0, 128) : '',
    latencyMs: Number(r.duration_ms) || 0,
    status: r.status === 'completed' ? 1 : 0,
    sessionId: String(r.session_id || '').slice(0, 64),
    sessionTitle: String(r.session_title || '').slice(0, 128),
    isSubagent: (r.session_parent_id != null && r.session_parent_id !== '') || sessionTaskType === 'subagent_child' ? 1 : 0,
    ttftMs: Number(r.time_to_first_token_ms) || 0,
    errorType: String(r.error_type || '').slice(0, 64),
    cancelled: Number(r.cancelled_by_user) ? 1 : 0,
    retryCount: Number(r.retry_count) || 0,
    contextExceeded: Number(r.context_exceeded) ? 1 : 0,
    remark: ['agent=' + (r.agent || ''), 'mode=' + (r.mode || ''), 'src=' + (r.query_source || ''), 'task=' + (r.task_type || '')].join(' ').slice(0, 255),
    createdAt: Number(r.started_at) || 0 // epoch ms
  };
}

/* ---------- 连接与增量缓存 ---------- */

const conn = { db: null, dbPath: '', configPath: '' };
const state = { rowsById: new Map(), sortedRows: null, maxStartedAt: 0 };
const warnState = { dbPath: '', warned: false };

function closeDb() {
  try {
    if (conn.db) conn.db.close();
  } catch { /* 已关闭或句柄失效 */ }
  conn.db = null;
  conn.dbPath = '';
  conn.configPath = '';
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
  // LEFT JOIN session 补齐项目目录 / 会话标题 / 子代理归属（实测 model_usage 全量可关联）
  const stmt = conn.db.prepare(`
    SELECT m.id, m.provider_id, m.model_id, m.status, m.started_at, m.duration_ms,
           m.input_tokens, m.output_tokens, m.reasoning_tokens,
           m.cache_creation_input_tokens, m.cache_read_input_tokens,
           m.computed_total_tokens, m.agent, m.mode, m.task_type, m.query_source,
           m.session_id, m.time_to_first_token_ms, m.retry_count,
           m.cancelled_by_user, m.context_exceeded, m.error_type,
           s.directory AS session_directory, s.title AS session_title,
           s.parent_id AS session_parent_id, s.task_type AS session_task_type
    FROM model_usage m
    LEFT JOIN session s ON m.session_id = s.id
    WHERE m.started_at >= ?
    ORDER BY m.started_at ASC
  `);
  let added = 0;
  for (const r of stmt.all(since)) {
    if (!state.rowsById.has(r.id)) added++;
    state.rowsById.set(r.id, toRow(r, conn.configPath));
    const ts = Number(r.started_at) || 0;
    if (ts > state.maxStartedAt) state.maxStartedAt = ts;
  }
  if (added > 0) state.sortedRows = null;
}

/** 确保连接可用并与数据库同步一次 */
function ensureSynced() {
  const { dbPath, configPath } = resolvePaths();
  if (!fs.existsSync(dbPath)) {
    // 每个路径只告警一次，避免自动刷新刷屏
    if (warnState.dbPath !== dbPath || !warnState.warned) {
      console.warn(`[zcode] 数据库不存在（未安装或数据目录被移动）: ${dbPath}`);
      warnState.dbPath = dbPath;
      warnState.warned = true;
    }
    throw new Error(`ZCode 数据库不存在: ${dbPath}`);
  }
  warnState.warned = false;
  warnState.dbPath = dbPath;
  if (!conn.db || conn.dbPath !== dbPath || conn.configPath !== configPath) {
    closeDb();
    resetState(); // 换库/换配置后缓存作废
    conn.db = openDb(dbPath);
    conn.dbPath = dbPath;
    conn.configPath = configPath;
  }
  syncIncremental();
}

function openDb(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * 提取时间范围内全部记录（用于聚合与分页）。
 * 防呆：库缺失/损坏时不再向上抛错（否则拖垮整个统计构建），返回空数组；
 * 具体原因经 status() 呈现在数据源健康面板。
 */
function getRows(startMs = 0, endMs = Infinity) {
  try {
    ensureSynced();
  } catch (e1) {
    closeDb();
    resetState();
    try {
      ensureSynced(); // 库文件被替换/迁移等异常：重置后重试一次
    } catch {
      return [];
    }
  }
  if (!state.sortedRows) {
    state.sortedRows = [...state.rowsById.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return state.sortedRows.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

/** 数据源健康状态：库缺失时给出可操作的指引 */
function status() {
  const { dbPath, source } = resolvePaths();
  if (fs.existsSync(dbPath)) return { healthy: true, reason: '' };
  const hint = source === 'default'
    ? '（若 ZCode 数据目录被移动，可在设置中手动指定位置）'
    : '（检查设置中的 ZCode 数据位置或环境变量）';
  return { healthy: false, reason: `数据库不存在：${dbPath}${hint}` };
}

/* ---------- 会话 / 工具扩展查询（供 stats 会话统计与详情） ---------- */

/** sessionId 的校验：只放行 zcode 风格 ID（字母数字下划线连字符），防注入/防越界 */
function validSessionId(sessionId) {
  const s = String(sessionId || '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(s) ? s : '';
}

/** 全部会话元信息（count 门控缓存；供项目增删行数与 会话列表 标题补齐） */
const sessionExtrasState = { count: -1, map: null };
function getSessionExtras() {
  try {
    ensureSynced();
  } catch { return new Map(); }
  try {
    const n = conn.db.prepare('SELECT COUNT(*) AS c FROM session').get().c;
    if (sessionExtrasState.map && sessionExtrasState.count === n) return sessionExtrasState.map;
    const map = new Map();
    for (const s of conn.db.prepare(`
      SELECT id, title, directory, parent_id, task_type,
             summary_additions, summary_deletions, summary_files,
             time_created, time_updated
      FROM session
    `).all()) {
      map.set(s.id, {
        title: String(s.title || ''),
        directory: String(s.directory || ''),
        parentId: s.parent_id || null,
        taskType: String(s.task_type || ''),
        // 注意 Number(null) === 0：必须先判空，避免"未落值"被当成 0 行增删
        additions: s.summary_additions != null && Number.isFinite(Number(s.summary_additions)) ? Number(s.summary_additions) : null,
        deletions: s.summary_deletions != null && Number.isFinite(Number(s.summary_deletions)) ? Number(s.summary_deletions) : null,
        files: s.summary_files != null && Number.isFinite(Number(s.summary_files)) ? Number(s.summary_files) : null,
        timeCreated: Number(s.time_created) || 0,
        timeUpdated: Number(s.time_updated) || 0
      });
    }
    sessionExtrasState.count = n;
    sessionExtrasState.map = map;
    return map;
  } catch {
    return new Map(); // session 表缺失（旧版 ZCode）：按无扩展信息处理
  }
}

/** 真实工具调用统计（tool_usage 表按工具名聚合；仅 ZCode 提供） */
function getToolUsage(startMs = 0, endMs = Number.MAX_SAFE_INTEGER, limit = 50) {
  try {
    ensureSynced();
  } catch { return []; }
  try {
    const rows = conn.db.prepare(`
      SELECT tool_name,
             COUNT(*) AS calls,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
             SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
             AVG(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms END) AS avg_ms,
             MAX(CASE WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms END) AS max_ms,
             SUM(CASE WHEN read_only = 1 THEN 1 ELSE 0 END) AS readonly_calls,
             SUM(CASE WHEN destructive = 1 THEN 1 ELSE 0 END) AS destructive_calls,
             SUM(CASE WHEN cancelled_by_user = 1 THEN 1 ELSE 0 END) AS cancelled,
             MAX(started_at) AS last_used
      FROM tool_usage
      WHERE started_at >= ? AND started_at <= ?
      GROUP BY tool_name
      ORDER BY calls DESC
      LIMIT ?
    `).all(Number(startMs) || 0, Number(endMs) || Number.MAX_SAFE_INTEGER, Math.min(Math.max(Number(limit) || 50, 1), 200));
    return rows.map((r) => ({
      tool: String(r.tool_name || 'unknown'),
      calls: Number(r.calls) || 0,
      errors: Number(r.errors) || 0,
      running: Number(r.running) || 0,
      avg_ms: Math.round(Number(r.avg_ms) || 0),
      max_ms: Math.round(Number(r.max_ms) || 0),
      readonly_calls: Number(r.readonly_calls) || 0,
      destructive_calls: Number(r.destructive_calls) || 0,
      cancelled: Number(r.cancelled) || 0,
      last_used: Number(r.last_used) || 0
    }));
  } catch {
    return []; // tool_usage 表缺失（旧版 ZCode）
  }
}

/** 会话消息预览（正文截断，仅供详情弹窗；不含附件/工具原始输出） */
function getSessionMessages(sessionId, limit = 60) {
  const sid = validSessionId(sessionId);
  if (!sid) return { error: 'session_id 格式非法' };
  try {
    ensureSynced();
  } catch { return { messages: [], total: 0 }; }
  try {
    const total = Number(conn.db.prepare('SELECT COUNT(*) AS c FROM message WHERE session_id = ?').get(sid).c) || 0;
    // 只取最近 N 条消息（按 sequence 倒序取，再正序返回），文本截断防大响应
    const cap = Math.min(Math.max(Number(limit) || 60, 1), 200);
    const messages = conn.db.prepare(`
      SELECT id, sequence, data FROM message
      WHERE session_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(sid, cap);
    const partStmt = conn.db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY sequence ASC LIMIT 40');
    const out = [];
    for (const m of messages.reverse()) {
      let role = 'unknown';
      let time = 0;
      try {
        const d = JSON.parse(m.data || '{}');
        role = String(d.role || 'unknown');
        time = Number(d.time && d.time.created) || 0;
      } catch { /* 结构异常按 unknown 角色 */ }
      const parts = [];
      for (const p of partStmt.all(m.id)) {
        try {
          const d = JSON.parse(p.data || '{}');
          if (d.type === 'text' && typeof d.text === 'string' && d.text.trim()) {
            parts.push({ kind: 'text', text: d.text.slice(0, 800) });
          } else if (d.type === 'tool' && d.tool) {
            parts.push({ kind: 'tool', text: `[工具] ${d.tool}` });
          } else if (d.type === 'step-finish' && d.tokens && Number(d.tokens.total) > 0) {
            parts.push({ kind: 'meta', text: `[本轮 ${Number(d.tokens.total).toLocaleString()} tokens]` });
          }
        } catch { /* 跳过损坏 part */ }
        if (parts.length >= 12) break; // 单条消息部件封顶
      }
      if (parts.length) out.push({ role, time, parts });
    }
    return { messages: out, total };
  } catch {
    return { messages: [], total: 0 }; // message/part 表缺失
  }
}

module.exports = {
  getRows, status, resolvePaths,
  getSessionExtras, getToolUsage, getSessionMessages,
  source: 'zcode'
};
