/**
 * 数据源：Claude Code 本地会话 JSONL
 * 扫描 ~/.claude/projects 下所有 jsonl，提取 assistant 消息的 usage。
 * 内存缓存：文件 mtime 变化或超过 15s 时全量重建（数据量小，重建成本极低）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'projects');
const REFRESH_INTERVAL_MS = 15000;

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

const cache = { records: [], lastScan: 0, dir: null };

/** 全量重建内存缓存 */
function rebuild() {
  const dir = process.env.CLAUDE_PROJECTS_DIR || DEFAULT_DIR;
  const files = collectJsonlFiles(dir);
  const records = [];
  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // 跳过写入中的不完整行
      }
      const msg = obj.message || {};
      if (msg.role !== 'assistant' || !msg.usage) continue;
      if (/^<.*>$/.test(msg.model || '')) continue; // 内部占位消息
      const ts = obj.timestamp;
      if (!ts) continue;
      const u = msg.usage || {};
      const prompt = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
      const completion = Number(u.output_tokens) || 0;
      const total = prompt + completion + (Number(u.cache_read_input_tokens) || 0);
      records.push({
        requestId: 'claude-code:' + (msg.id || `${path.basename(file)}:${ts}`),
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
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.dir = dir;
}

/** 确保缓存新鲜（mtime 变化或超时则重建） */
function ensureFresh() {
  const dir = process.env.CLAUDE_PROJECTS_DIR || DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === dir) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

module.exports = { getRows, source: 'claude-code' };
