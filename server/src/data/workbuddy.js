/**
 * 数据源：WorkBuddy
 * 扫描 ~/.workbuddy/projects 下各会话目录的 jsonl 会话文件，
 * 每条带 providerData.rawUsage 的记录为一次模型调用。只读访问。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = path.join(os.homedir(), '.workbuddy');
const REFRESH_INTERVAL_MS = 15000;

const cache = { records: [], lastScan: 0, dir: null };

function collectSessionFiles(dir, depth = 0, result = []) {
  if (depth > 3 || !fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSessionFiles(full, depth + 1, result);
    else if (entry.name.endsWith('.jsonl')) result.push(full);
  }
  return result;
}

function rebuild() {
  const root = process.env.WORKBUDDY_DIR || DEFAULT_DIR;
  const files = collectSessionFiles(path.join(root, 'projects'));
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
        continue;
      }
      const pd = obj.providerData || {};
      const usage = pd.rawUsage || {};
      const total = Number(usage.total_tokens) || 0;
      if (!total) continue;
      const cached = ((usage.prompt_tokens_details || {}).cached_tokens) || 0;
      const reasoning = ((usage.completion_tokens_details || {}).reasoning_tokens) || 0;
      const model = pd.requestModelName || pd.requestModelId || 'auto';
      const credit = Number(usage.credit) || 0;
      records.push({
        requestId: 'workbuddy:' + (pd.messageId || `${obj.id || 'row'}`),
        channel: model === 'auto' ? 'auto' : model,
        channelKind: 'workbuddy',
        model,
        source: 'workbuddy',
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        totalTokens: total,
        latencyMs: 0,
        status: 1,
        remark: `cached=${cached} reasoning=${reasoning} credit=${credit}`.slice(0, 255),
        createdAt: Number(obj.timestamp) || Date.parse(String(obj.timestamp)) || 0
      });
    }
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.dir = root;
}

function ensureFresh() {
  const root = process.env.WORKBUDDY_DIR || DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === root) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

module.exports = { getRows, source: 'workbuddy' };
