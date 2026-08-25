/**
 * 数据源：OpenAI Codex CLI
 * 扫描 ~/.codex/sessions 下各日期目录的 rollout-*.jsonl 与 archived_sessions/，
 * token_count 事件携带每次调用的 token 用量（last_token_usage 为增量），
 * 模型名从同文件 turn_context 事件按时间 join。只读访问。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = path.join(os.homedir(), '.codex');
const REFRESH_INTERVAL_MS = 15000;

const cache = { records: [], lastScan: 0, dir: null };

function collectRollouts(dir, depth = 0, result = []) {
  if (depth > 4 || !fs.existsSync(dir)) return result;
  const base = path.resolve(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.resolve(base, entry.name);
    if (full !== base && !full.startsWith(base + path.sep)) continue; // 越界路径防护
    if (entry.isDirectory()) collectRollouts(full, depth + 1, result);
    else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
}

function rebuild() {
  const root = process.env.CODEX_DIR || DEFAULT_DIR;
  const files = [
    ...collectRollouts(path.join(root, 'sessions')),
    ...collectRollouts(path.join(root, 'archived_sessions'))
  ];
  const records = [];
  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    let sessionId = path.basename(file, '.jsonl').replace(/^rollout-/, '');
    let currentModel = '';
    const baseName = path.basename(file, '.jsonl');
    lines.forEach((line, idx) => {
      if (!line.trim()) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return;
      }
      if (obj.type === 'session_meta' && obj.payload && obj.payload.id) {
        sessionId = obj.payload.id;
      } else if (obj.type === 'turn_context' && obj.payload && obj.payload.model) {
        currentModel = obj.payload.model;
      } else if (obj.type === 'event_msg' && obj.payload && obj.payload.type === 'token_count') {
        const info = obj.payload.info || {};
        const usage = info.last_token_usage || {};
        const total = Number(usage.total_tokens) || 0;
        if (!total) return;
        const prompt = Number(usage.input_tokens) || 0;
        const completion = (Number(usage.output_tokens) || 0) + (Number(usage.reasoning_output_tokens) || 0);
        records.push({
          requestId: `codex:${baseName}:${idx}`,
          channel: currentModel || '未知模型',
          channelKind: 'codex',
          model: currentModel || 'unknown',
          source: 'codex',
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          latencyMs: 0,
          status: 1,
          remark: `session=${sessionId.slice(0, 24)} cached=${Number(usage.cached_input_tokens) || 0} reasoning=${Number(usage.reasoning_output_tokens) || 0}`.slice(0, 255),
          createdAt: Date.parse(obj.timestamp) || 0
        });
      }
    });
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.dir = root;
}

function ensureFresh() {
  const root = process.env.CODEX_DIR || DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === root) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

module.exports = { getRows, source: 'codex' };
