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
    const msg = obj.message || {};
    if (msg.role !== 'assistant' || !msg.usage) return;
    if (/^<.*>$/.test(msg.model || '')) return; // 内部占位消息
    const ts = obj.timestamp;
    if (!ts) return;
    const u = msg.usage || {};
    const prompt = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
    const completion = Number(u.output_tokens) || 0;
    const total = prompt + completion + (Number(u.cache_read_input_tokens) || 0);
    emit({
      requestId: 'claude-code:' + (msg.id || `${path.basename(meta.file)}:${ts}`),
      channel: inferChannel(msg.model),
      channelKind: '',
      model: msg.model || 'unknown',
      source: 'claude-code',
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      latencyMs: 0,
      status: 1,
      remark: `cache_read=${Number(u.cache_read_input_tokens) || 0} cache_write=${Number(u.cache_creation_input_tokens) || 0}`.slice(0, 255),
      createdAt: Date.parse(ts)
    });
  }
});

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

module.exports = { getRows, source: 'claude-code' };
