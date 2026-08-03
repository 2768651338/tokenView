/**
 * 上报存储：本地 JSONL 文件（server/data/reports.jsonl）
 * 追加写 + 内存索引，request_id 幂等去重。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'reports.jsonl');

const state = { records: [], ids: new Set(), loaded: false };

function load() {
  if (state.loaded) return;
  state.loaded = true;
  if (!fs.existsSync(FILE)) return;
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (state.ids.has(r.requestId)) continue;
      state.records.push(r);
      state.ids.add(r.requestId);
    } catch { /* 跳过损坏行 */ }
  }
}

/** 写入一条上报记录，重复 request_id 返回 null */
function append({ channel, model, promptTokens, completionTokens, latencyMs, status, requestId, tool = '', remark = '' }) {
  load();
  if (state.ids.has(requestId)) return null;
  const row = {
    requestId,
    channel,
    channelKind: 'api',
    model,
    source: 'api',
    tool, // 工具标识（Trae / kimi / ...），用于工具维度统计
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: 0, // 费用由 stats 层按单价计算
    latencyMs,
    status: status ? 1 : 0,
    remark: remark.slice(0, 255),
    createdAt: Date.now()
  };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(row) + '\n', 'utf8');
  state.records.push(row);
  state.ids.add(requestId);
  return row;
}

/** 提取时间范围内全部上报记录 */
function getRows(startMs = 0, endMs = Infinity) {
  load();
  return state.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

/** 生成本地上报 ID */
function newRequestId() {
  return `api-${crypto.randomUUID()}`;
}

module.exports = { append, getRows, newRequestId, source: 'api' };
