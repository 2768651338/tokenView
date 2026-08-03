/**
 * 数据源：LobsterAI（Claude Code 封装）
 * 扫描 AppData\Roaming\LobsterAI\openclaw\state\agents\main\sessions\*.jsonl，
 * Claude Code 标准格式，assistant 消息携带 message.usage。只读访问。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'LobsterAI', 'openclaw', 'state', 'agents', 'main', 'sessions');
const REFRESH_INTERVAL_MS = 15000;

const cache = { records: [], lastScan: 0, dir: null };

function collectJsonl(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.jsonl') && !entry.name.includes('.deleted.')) result.push(path.join(dir, entry.name));
  }
  return result;
}

function rebuild() {
  const dir = process.env.LOBSTERAI_DIR || DEFAULT_DIR;
  const files = collectJsonl(dir);
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
      const msg = obj.message || {};
      if (msg.role !== 'assistant' || !msg.usage) continue;
      const u = msg.usage || {};
      const total = Number(u.totalTokens) || 0;
      if (!total) continue;
      const prompt = (Number(u.input) || 0) + (Number(u.cacheWrite) || 0);
      const completion = (Number(u.output) || 0) + (Number(u.reasoningTokens) || 0);
      records.push({
        requestId: 'lobsterai:' + (obj.id || `${path.basename(file)}:${records.length}`),
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
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.dir = dir;
}

function ensureFresh() {
  const dir = process.env.LOBSTERAI_DIR || DEFAULT_DIR;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.dir === dir) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

module.exports = { getRows, source: 'lobsterai' };
