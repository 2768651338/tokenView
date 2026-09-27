/**
 * 数据源：Claude Code 本地会话 JSONL
 * 扫描 ~/.claude/projects 下所有 jsonl，提取 assistant 消息的 usage。
 * 增量扫描：按文件记录已读偏移，仅解析追加字节；文件截断/删除时自动全量重建。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createJsonlSource } = require('./jsonl-source');

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'projects');
const REFRESH_INTERVAL_MS = 5000;

/** 模型名 -> 渠道名 推断规则 */
const MODEL_CHANNEL_RULES = [
  { pattern: /^claude/i, channel: 'Anthropic' },
  { pattern: /^(gpt|o[1-9])/i, channel: 'OpenAI' },
  { pattern: /^glm/i, channel: '智谱AI' },
  { pattern: /^deepseek/i, channel: 'DeepSeek' },
  { pattern: /^(kimi|moonshot)/i, channel: 'Kimi' },
  { pattern: /^qwen/i, channel: '通义千问' },
  { pattern: /^gemini/i, channel: 'Gemini' },
  { pattern: /^ernie/i, channel: '百度文心' },
  { pattern: /^doubao/i, channel: '火山方舟' }
];

function inferChannel(modelName) {
  const rule = MODEL_CHANNEL_RULES.find((r) => r.pattern.test(modelName || ''));
  return rule ? rule.channel : '其他';
}

function collectJsonlFiles(dir, depth = 0, result = []) {
  if (depth > 4 || !fs.existsSync(dir)) return result;
  const base = path.resolve(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.resolve(base, entry.name);
    if (full !== base && !full.startsWith(base + path.sep)) continue; // 越界路径防护
    if (entry.isDirectory()) collectJsonlFiles(full, depth + 1, result);
    else if (entry.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
}

const source = createJsonlSource({
  collectFiles: (root) => collectJsonlFiles(root),
  createFileState: () => ({}),
  reduceLine(_state, obj, meta, emit) {
    const ts = obj.timestamp;
    // API 错误行：无有效用量但携带错误码/状态，计入失败调用（不能与 usage 行重复计数）
    if (obj.isApiErrorMessage === true) {
      if (!ts) return;
      const errMsg = obj.message || {};
      emit({
        requestId: 'claude-code:err:' + (obj.uuid || `${path.basename(meta.file)}:${meta.lineNo}`),
        channel: inferChannel(msgModelOf(obj)),
        channelKind: '',
        model: msgModelOf(obj) || 'unknown',
        source: 'claude-code',
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        // cwd 是明文完整项目路径，比编码目录名更干净；缺失时回退目录名推断
        project: objCwdProject(obj, meta),
        latencyMs: 0,
        status: 0,
        sessionId: String(obj.sessionId || '').slice(0, 64),
        sessionTitle: '',
        isSubagent: obj.isSidechain ? 1 : 0,
        errorType: String(obj.error || 'api_error').slice(0, 64),
        remark: `apiErrorStatus=${obj.apiErrorStatus != null ? obj.apiErrorStatus : ''}`.slice(0, 255),
        createdAt: Date.parse(ts)
      });
      return;
    }
    const msg = obj.message || {};
    if (msg.role !== 'assistant' || !msg.usage) return;
    if (/^<.*>$/.test(msg.model || '')) return; // 内部占位消息
    if (!ts) return;
    const u = msg.usage || {};
    // 口径统一：promptTokens 为纯输入（不含缓存），缓存读写单独成列，费用在 stats 层按缓存价率计算
    const cacheRead = Number(u.cache_read_input_tokens) || 0;
    const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
    const prompt = Number(u.input_tokens) || 0;
    const completion = Number(u.output_tokens) || 0;
    const total = prompt + completion + cacheRead + cacheWrite;
    emit({
      requestId: 'claude-code:' + (msg.id || `${path.basename(meta.file)}:${ts}`),
      channel: inferChannel(msg.model),
      channelKind: '',
      model: msg.model || 'unknown',
      source: 'claude-code',
      promptTokens: prompt,
      completionTokens: completion,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: total,
      project: objCwdProject(obj, meta),
      latencyMs: 0,
      status: 1,
      sessionId: String(obj.sessionId || '').slice(0, 64),
      sessionTitle: '',
      isSubagent: obj.isSidechain ? 1 : 0,
      errorType: '',
      remark: [obj.gitBranch ? `branch=${String(obj.gitBranch).slice(0, 48)}` : '', obj.version ? `v=${String(obj.version).slice(0, 24)}` : ''].filter(Boolean).join(' ').slice(0, 255),
      createdAt: Date.parse(ts)
    });
  }
});

/** 行内模型名（错误行 message.model 常为 <synthetic> 占位，归为 unknown） */
function msgModelOf(obj) {
  const m = obj.message && obj.message.model;
  return typeof m === 'string' && !/^<.*>$/.test(m) ? m : '';
}

/** 项目名：优先行内明文 cwd，缺失时回退会话文件所在目录（编码目录名截断） */
function objCwdProject(obj, meta) {
  if (typeof obj.cwd === 'string' && obj.cwd.trim()) {
    return path.basename(obj.cwd.trim()).slice(0, 128) || path.basename(path.dirname(meta.file)).slice(0, 128);
  }
  return path.basename(path.dirname(meta.file)).slice(0, 128);
}

const cache = { lastScan: 0, dir: null };

/** 确保缓存新鲜（TTL 内不重复扫描） */
function ensureFresh() {
  const dir = process.env.CLAUDE_PROJECTS_DIR ? path.resolve(process.env.CLAUDE_PROJECTS_DIR) : DEFAULT_DIR;
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

module.exports = { getRows, source: 'claude-code', inferChannel };
