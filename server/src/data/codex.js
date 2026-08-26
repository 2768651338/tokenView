/**
 * 数据源：OpenAI Codex CLI
 * 扫描 ~/.codex/sessions 下各日期目录的 rollout-*.jsonl 与 archived_sessions/，
 * token_count 事件携带每次调用的 token 用量（last_token_usage 为增量），
 * 模型名从同文件 turn_context 事件按时间 join。只读访问。
 *
 * 增量扫描：turn_context 的模型名等跨行状态保存在每文件的解析上下文中，
 * 追加读取时无缝续用；文件截断/删除时自动全量重建。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createJsonlSource } = require('./jsonl-source');

const DEFAULT_DIR = path.join(os.homedir(), '.codex');
const REFRESH_INTERVAL_MS = 5000;

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

const source = createJsonlSource({
  collectFiles: (root) => [
    ...collectRollouts(path.join(root, 'sessions')),
    ...collectRollouts(path.join(root, 'archived_sessions'))
  ],
  createFileState: () => ({ sessionId: '', currentModel: '' }),
  reduceLine(state, obj, meta, emit) {
    if (obj.type === 'session_meta' && obj.payload && obj.payload.id) {
      state.sessionId = obj.payload.id;
      return;
    }
    if (obj.type === 'turn_context' && obj.payload && obj.payload.model) {
      state.currentModel = obj.payload.model;
      return;
    }
    if (obj.type === 'event_msg' && obj.payload && obj.payload.type === 'token_count') {
      const info = obj.payload.info || {};
      const usage = info.last_token_usage || {};
      const total = Number(usage.total_tokens) || 0;
      if (!total) return;
      const prompt = Number(usage.input_tokens) || 0;
      const completion = (Number(usage.output_tokens) || 0) + (Number(usage.reasoning_output_tokens) || 0);
      const currentModel = state.currentModel;
      const sid = state.sessionId || path.basename(meta.file, '.jsonl').replace(/^rollout-/, '');
      emit({
        requestId: `codex:${path.basename(meta.file, '.jsonl')}:${meta.lineNo}`,
        channel: currentModel || '未知模型',
        channelKind: 'codex',
        model: currentModel || 'unknown',
        source: 'codex',
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
        latencyMs: 0,
        status: 1,
        remark: `session=${sid.slice(0, 24)} cached=${Number(usage.cached_input_tokens) || 0} reasoning=${Number(usage.reasoning_output_tokens) || 0}`.slice(0, 255),
        createdAt: Date.parse(obj.timestamp) || 0
      });
    }
  }
});

const cache = { lastScan: 0, dir: null };

function ensureFresh() {
  const root = process.env.CODEX_DIR ? path.resolve(process.env.CODEX_DIR) : DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === root) return;
  source.refresh(root);
  cache.lastScan = now;
  cache.dir = root;
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return source.getRecords().filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

module.exports = { getRows, source: 'codex' };
