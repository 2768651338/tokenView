/**
 * 数据源：LobsterAI（Claude Code 封装）
 * 扫描 AppData\Roaming\LobsterAI\openclaw\state\agents\main\sessions\*.jsonl。
 * 兼容两种格式：
 *   1. 旧版会话 jsonl：assistant 消息携带 message.usage；
 *   2. 新版 *.trajectory.jsonl（openclaw-trajectory）：type=model.completed 行的
 *      data.usage 为累计用量，trace.artifacts 行是同一数据的落档快照，不重复解析。
 * 只读访问；增量扫描：仅解析文件追加字节；文件截断/删除时自动全量重建。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createJsonlSource } = require('./jsonl-source');

const DEFAULT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'LobsterAI', 'openclaw', 'state', 'agents', 'main', 'sessions');
const REFRESH_INTERVAL_MS = 5000;

function collectJsonl(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.jsonl') && !entry.name.includes('.deleted.')) result.push(path.join(dir, entry.name));
  }
  return result;
}

const source = createJsonlSource({
  collectFiles: (root) => collectJsonl(root),
  createFileState: () => ({ rowCount: 0 }),
  reduceLine(state, obj, meta, emit) {
    // 新版轨迹格式：只认 model.completed（每 run 一次），避免与 trace.artifacts 重复计数
    if (obj && obj.traceSchema === 'openclaw-trajectory') {
      if (obj.type !== 'model.completed' || !obj.data || !obj.data.usage) return;
      const u = obj.data.usage || {};
      const d = obj.data;
      const input = Number(u.input) || 0;
      const output = Number(u.output) || 0;
      const cacheRead = Number(u.cacheRead) || 0;
      const reasoning = Number(u.reasoningTokens) || 0;
      // usage.total 不含 reasoning（实测 input+output+cacheRead === total），统一按四项之和
      const total = input + output + cacheRead + reasoning;
      if (!total) return;
      const failed = !!(d.aborted || d.timedOut || d.externalAbort || d.idleTimedOut || d.promptErrorSource);
      emit({
        requestId: 'lobsterai:traj:' + (obj.traceId || path.basename(meta.file, '.jsonl')) + ':' + (obj.seq != null ? obj.seq : obj.sourceSeq != null ? obj.sourceSeq : meta.lineNo),
        channel: 'LobsterAI',
        channelKind: 'lobsterai',
        model: obj.modelId || 'unknown',
        source: 'lobsterai',
        promptTokens: input,
        completionTokens: output + reasoning,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        totalTokens: total,
        project: '',
        latencyMs: 0,
        status: failed ? 0 : 1,
        errorType: d.promptErrorSource ? String(d.promptErrorSource).slice(0, 64) : (failed ? 'aborted' : ''),
        remark: `run=${String(obj.runId || '').slice(0, 36)} compaction=${Number(d.compactionCount) || 0}`.slice(0, 255),
        createdAt: Date.parse(obj.ts) || 0
      });
      return;
    }
    // 旧版会话格式
    const msg = obj.message || {};
    if (msg.role !== 'assistant' || !msg.usage) return;
    const u = msg.usage || {};
    const total = Number(u.totalTokens) || 0;
    if (!total) return;
    state.rowCount++;
    const prompt = (Number(u.input) || 0) + (Number(u.cacheWrite) || 0);
    const completion = (Number(u.output) || 0) + (Number(u.reasoningTokens) || 0);
    emit({
      requestId: 'lobsterai:' + (obj.id || `${path.basename(meta.file)}:${state.rowCount - 1}`),
      channel: msg.model || 'unknown',
      channelKind: 'lobsterai',
      model: msg.model || 'unknown',
      source: 'lobsterai',
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      latencyMs: 0,
      status: 1,
      remark: `cacheRead=${Number(u.cacheRead) || 0} cacheWrite=${Number(u.cacheWrite) || 0} reasoning=${Number(u.reasoningTokens) || 0}`.slice(0, 255),
      createdAt: Date.parse(obj.timestamp) || 0
    });
  }
});

const cache = { lastScan: 0, dir: null };

function ensureFresh() {
  const dir = process.env.LOBSTERAI_DIR ? path.resolve(process.env.LOBSTERAI_DIR) : DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === dir) return;
  source.refresh(dir);
  cache.lastScan = now;
  cache.dir = dir;
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return source.getRecords().filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

module.exports = { getRows, source: 'lobsterai' };
