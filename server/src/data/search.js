/**
 * 跨会话全文搜索：ZCode / Claude Code / Codex 三源消息正文与会话标题。
 * - ZCode：SQLite LIKE（message.part 正文 + session 标题），高效且天然支持大小写不敏感
 * - Claude Code / Codex：JSONL 逐行扫描（先做小写子串预筛，命中才 JSON.parse），有字节总量上限
 * 搜索为用户手动触发（不参与自动刷新），单次扫描有字节/会话数/匹配数三重上限防失控。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zcode = require('./zcode');
const claudeCode = require('./claude-code');
const codex = require('./codex');

/** 单源扫描字节上限（防止超大目录拖垮请求） */
const SCAN_BYTE_CAP = 256 * 1024 * 1024;
/** 单文件大小上限（异常大文件直接跳过） */
const FILE_BYTE_CAP = 128 * 1024 * 1024;
/** 单会话匹配计数上限 */
const MATCHES_PER_SESSION_CAP = 99;
/** 摘要上下文半径（字符） */
const SNIPPET_RADIUS = 70;

const SOURCE_NAMES = { zcode: 'ZCode', 'claude-code': 'Claude Code', codex: 'Codex' };

/** 时间范围：最近 N 天（含今天）→ startMs；'all' 不限 */
function rangeStart(days) {
  if (days === 'all') return 0;
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const start = new Date();
  start.setDate(start.getDate() - (Math.min(n, 365) - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/** 在 text 中生成关键词上下文摘要（大小写不敏感定位，首尾截断标记） */
function snippetOf(text, queryLower) {
  const idx = text.toLowerCase().indexOf(queryLower);
  if (idx < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const from = Math.max(0, idx - SNIPPET_RADIUS);
  const to = Math.min(text.length, idx + queryLower.length + SNIPPET_RADIUS);
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '');
}

/** 深度收集对象中的短文本字符串（跳过长 base64 / 工具大输出） */
function collectTexts(obj, out = [], depth = 0) {
  if (!obj || out.length >= 200 || depth > 8) return out;
  if (typeof obj === 'string') {
    if (obj.length <= 20000) out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) collectTexts(item, out, depth + 1);
    return out;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectTexts(v, out, depth + 1);
  }
  return out;
}

/** 在一组文本里找首个含关键词的文本，返回 { text, snippet } 或 null */
function firstMatch(texts, queryLower) {
  for (const t of texts) {
    if (t && t.toLowerCase().includes(queryLower)) {
      return { text: t, snippet: snippetOf(t, queryLower) };
    }
  }
  return null;
}

function roleOf(obj) {
  const r = (obj.message && obj.message.role) || (obj.payload && obj.payload.role) || '';
  return typeof r === 'string' ? r.slice(0, 16) : '';
}

/** 会话桶：聚合匹配、维护最近匹配时间 */
function bucketOf(map, source, sessionId) {
  const key = `${source}::${sessionId}`;
  let b = map.get(key);
  if (!b) {
    b = { source, session_id: sessionId, title: '', project: '', snippet: '', role: '', matches: 0, last_ms: 0 };
    map.set(key, b);
  }
  return b;
}

/** 记录一次命中（含摘要、角色、时间、项目、标题；首个命中生成摘要） */
function recordHit(bucket, { snippet, role = '', ms = 0, project = '', title = '' }) {
  bucket.matches = Math.min(bucket.matches + 1, MATCHES_PER_SESSION_CAP + 1);
  if (!bucket.snippet && snippet) bucket.snippet = snippet;
  if (!bucket.role && role) bucket.role = role;
  if (ms > bucket.last_ms) bucket.last_ms = ms;
  if (!bucket.project && project) bucket.project = project;
  if (!bucket.title && title) bucket.title = title;
}

/* ---------- ZCode：SQLite LIKE ---------- */

async function searchZcode(queryLower, startMs, buckets) {
  const raw = await zcode.searchRaw(queryLower, 3000);
  const extras = zcode.getSessionExtras();
  for (const p of raw.parts) {
    const sid = String(p.session_id || '').slice(0, 64);
    if (!sid) continue;
    // 时间过滤：message.data JSON 内的 time.created（epoch ms）
    let ms = 0;
    let mobj = null;
    try { mobj = JSON.parse(p.mdata || '{}'); } catch { /* 结构异常按无时间处理 */ }
    ms = Number(mobj && mobj.time && mobj.time.created) || 0;
    if (startMs && ms && ms < startMs) continue;
    let ptext = '';
    try {
      const pobj = JSON.parse(p.pdata || '{}');
      if (pobj.type === 'text' && typeof pobj.text === 'string') ptext = pobj.text;
      else if (pobj.type === 'tool' && pobj.tool) ptext = `[工具] ${pobj.tool}`;
    } catch { /* 跳过损坏 part */ }
    if (!ptext) continue;
    const hit = ptext.toLowerCase().includes(queryLower)
      ? { snippet: snippetOf(ptext, queryLower) }
      : null;
    // LIKE 命中但正文提取后不含（如命中转义 JSON 字段）：跳过
    if (!hit) continue;
    const ex = extras.get(sid) || {};
    recordHit(bucketOf(buckets, 'zcode', sid), {
      snippet: hit.snippet,
      role: roleOf(mobj || {}),
      ms,
      project: ex.directory ? path.basename(ex.directory).slice(0, 128) : '',
      title: ex.title || ''
    });
  }
  for (const t of raw.titles) {
    const sid = String(t.id || '').slice(0, 64);
    if (!sid) continue;
    const ms = Number(t.time_updated) || 0;
    if (startMs && ms && ms < startMs) continue;
    recordHit(bucketOf(buckets, 'zcode', sid), {
      snippet: `[标题] ${t.title}`,
      ms,
      project: t.directory ? path.basename(t.directory).slice(0, 128) : '',
      title: String(t.title || '')
    });
  }
}

/* ---------- Claude Code / Codex：JSONL 行扫描 ---------- */

/** Claude Code 行内文本：message.content（字符串或 content 数组）与 summary 标题 */
function claudeLineTexts(obj) {
  const texts = [];
  if (obj.type === 'summary' && typeof obj.summary === 'string') {
    texts.push(`[标题] ${obj.summary}`);
    return { texts, title: obj.summary };
  }
  const msg = obj.message || {};
  const content = msg.content;
  if (typeof content === 'string') texts.push(content);
  else if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object' && typeof c.text === 'string') texts.push(c.text);
    }
  }
  return { texts, title: '' };
}

/** Codex 行内文本：response_item 消息与 event_msg 用户/助手消息 */
function codexLineTexts(obj, state) {
  const p = obj.payload;
  if (!p || typeof p !== 'object') return { texts: [], title: '' };
  if (obj.type === 'session_meta' && p.id) {
    state.sessionId = String(p.id).slice(0, 64);
    state.cwd = typeof p.cwd === 'string' ? p.cwd : '';
    return { texts: [], title: '' };
  }
  if (obj.type === 'response_item' && p.type === 'message' && Array.isArray(p.content)) {
    const texts = [];
    for (const c of p.content) {
      if (c && typeof c === 'object' && typeof c.text === 'string') texts.push(c.text);
    }
    return { texts, title: '' };
  }
  if (obj.type === 'event_msg' && (p.type === 'user_message' || p.type === 'agent_message') && typeof p.message === 'string') {
    return { texts: [p.message], title: '' };
  }
  return { texts: [], title: '' };
}

async function searchJsonlSource(source, files, queryLower, startMs, buckets, state) {
  const extract = source === 'claude-code' ? claudeLineTexts : codexLineTexts;
  let bytesScanned = 0;
  let truncated = false;
  // 最近修改的文件优先（新会话更可能被搜到）
  const metas = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.isFile() && st.size <= FILE_BYTE_CAP) metas.push({ file: f, mtimeMs: st.mtimeMs, size: st.size });
      else if (st.isFile()) truncated = true;
    } catch { truncated = true; /* 读取中文件消失 */ }
  }
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const meta of metas) {
    if (bytesScanned + meta.size > SCAN_BYTE_CAP) { truncated = true; break; }
    if (!meta.size) continue;
    bytesScanned += meta.size;
    let sessionId = state.sessionId || path.basename(meta.file, '.jsonl').replace(/^rollout-/, '');
    const input = fs.createReadStream(meta.file, { encoding: 'utf8', end: meta.size - 1 });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let lineCount = 0;
    try {
      for await (const line of lines) {
        // 流式读取并定期让出事件循环，搜索期间统计与导出仍可响应。
        if (++lineCount % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
        if (!line.toLowerCase().includes(queryLower)
          && !(source === 'codex' && line.includes('"session_meta"'))) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (source === 'claude-code') {
          const sid = String(obj.sessionId || '').slice(0, 64);
          if (sid) sessionId = sid;
        }
        const { texts, title } = extract(obj, state);
        if (source === 'codex' && state.sessionId) sessionId = state.sessionId;
        const ts = Date.parse(obj.timestamp) || 0;
        if (startMs && ts && ts < startMs) continue;
        const hit = firstMatch(texts, queryLower);
        if (!hit) continue;
        const project = source === 'claude-code'
          ? (typeof obj.cwd === 'string' && obj.cwd ? path.basename(obj.cwd).slice(0, 128) : '')
          : (state.cwd ? path.basename(state.cwd).slice(0, 128) : '');
        recordHit(bucketOf(buckets, source, sessionId), {
          snippet: hit.snippet,
          role: roleOf(obj),
          ms: ts,
          project,
          title
        });
      }
    } catch {
      truncated = true; // 扫描中文件被移动或变更，保留已找到的结果并告知截断。
    } finally {
      lines.close();
      input.destroy();
    }
    state.sessionId = '';
    state.cwd = '';
  }
  return truncated;
}

/* ---------- 入口 ---------- */

/**
 * 跨会话全文搜索。
 * @returns {{ query, days, list: [{source, source_name, session_id, title, project, role, snippet, matches, last_time}], total_sessions, truncated }}
 */
async function search({ query = '', days = 'all', limit = 20 } = {}) {
  const q = String(query || '').trim().slice(0, 64);
  if (!q) return { error: '搜索词不能为空' };
  const queryLower = q.toLowerCase();
  const startMs = rangeStart(days);
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const buckets = new Map();
  let truncated = false;

  await searchZcode(queryLower, startMs, buckets);

  const ccRoot = claudeCode.getRootDir();
  if (fs.existsSync(ccRoot)) {
    const t = await searchJsonlSource('claude-code', claudeCode.collectJsonlFiles(ccRoot), queryLower, startMs, buckets, {});
    truncated = truncated || t;
  }
  const codexRoot = codex.getRootDir();
  if (fs.existsSync(codexRoot)) {
    const t = await searchJsonlSource('codex', [
      ...codex.collectRollouts(path.join(codexRoot, 'sessions')),
      ...codex.collectRollouts(path.join(codexRoot, 'archived_sessions'))
    ], queryLower, startMs, buckets, { sessionId: '', cwd: '' });
    truncated = truncated || t;
  }

  const list = [...buckets.values()]
    .sort((a, b) => b.last_ms - a.last_ms || b.matches - a.matches)
    .slice(0, cap)
    .map((b) => ({
      source: b.source,
      source_name: SOURCE_NAMES[b.source] || b.source,
      session_id: b.session_id,
      title: b.title || (b.project ? `${b.project} · ${b.session_id.slice(-6)}` : b.session_id.slice(-12)),
      project: b.project,
      role: b.role,
      snippet: b.snippet,
      matches: b.matches,
      last_time: b.last_ms ? formatTime(b.last_ms) : ''
    }));
  return {
    query: q,
    days: days === 'all' ? 'all' : Number(days),
    list,
    total_sessions: buckets.size,
    truncated
  };
}

const pad = (n) => String(n).padStart(2, '0');
function formatTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = { search };
