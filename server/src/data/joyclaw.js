/**
 * 数据源：JoyClaw
 * 读 AppData\Roaming\JoyClaw\state\desktop-token-usage-state.json。
 * 结构已就绪（sessions map），当前可能为空；做防御性解析。只读访问。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_FILE = path.join(os.homedir(), 'AppData', 'Roaming', 'JoyClaw', 'state', 'desktop-token-usage-state.json');
const REFRESH_INTERVAL_MS = 15000;

const cache = { records: [], lastScan: 0, file: null };

/** 防御性提取数值字段（兼容多种命名） */
function num(obj, ...keys) {
  for (const k of keys) {
    if (obj && typeof obj[k] === 'number' && !Number.isNaN(obj[k])) return obj[k];
  }
  return 0;
}

function rebuild() {
  const file = process.env.JOYCLAW_FILE || DEFAULT_FILE;
  const records = [];
  try {
    if (fs.existsSync(file)) {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sessions = state.sessions || {};
      for (const [sessionId, s] of Object.entries(sessions)) {
        if (!s || typeof s !== 'object') continue;
        // 尝试常见结构：直接字段 或 usage 嵌套
        const u = (s.usage && typeof s.usage === 'object') ? s.usage : s;
        const total = num(u, 'totalTokens', 'total_tokens');
        if (!total) continue;
        const createdAt = num(s, 'createdAtMs', 'createdAt', 'startedAtMs', 'startedAt', 'updatedAt', 'updatedAtMs') || Date.now();
        const model = s.model || s.modelId || 'unknown';
        records.push({
          requestId: 'joyclaw:' + sessionId,
          channel: model,
          channelKind: 'joyclaw',
          model,
          source: 'joyclaw',
          promptTokens: num(u, 'inputTokens', 'input_tokens'),
          completionTokens: num(u, 'outputTokens', 'output_tokens'),
          totalTokens: total,
          latencyMs: 0,
          status: 1,
          remark: `session=${sessionId.slice(0, 24)}`.slice(0, 255),
          createdAt
        });
      }
    }
  } catch (e) {
    console.warn('[joyclaw] 读取用量状态失败:', e.message);
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.file = file;
}

function ensureFresh() {
  const file = process.env.JOYCLAW_FILE || DEFAULT_FILE;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.file === file) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

module.exports = { getRows, source: 'joyclaw' };
