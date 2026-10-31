/**
 * 上报存储：本地 JSONL 文件（server/data/reports.jsonl）
 * 追加写 + 内存索引，request_id 幂等去重。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('../runtime');
const settings = require('./settings');

const FILE = path.join(dataDir(), 'reports.jsonl');

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
function append({ channel, model, promptTokens, completionTokens, cacheReadTokens = 0, cacheWriteTokens = 0, latencyMs, status, requestId, tool = '', project = '', remark = '' }) {
  load();
  if (state.ids.has(requestId)) return null;
  const row = {
    requestId,
    channel,
    channelKind: 'api',
    model,
    source: 'api',
    tool, // 工具标识（Trae / kimi / ...），用于工具维度统计
    project: String(project || '').slice(0, 128), // 项目名（项目维度统计用）
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
    cost: 0, // 费用由 stats 层按单价计算
    latencyMs,
    status: status ? 1 : 0,
    remark: remark.slice(0, 255),
    createdAt: Date.now()
  };
  if (!fs.existsSync(path.dirname(FILE))) fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(row) + '\n', 'utf8');
  state.records.push(row);
  state.ids.add(requestId);
  maybeApplyRetention();
  return row;
}

/** 追加后按保留策略节流裁剪（读取失败/异常均不影响上报主流程） */
function maybeApplyRetention() {
  try {
    applyRetention(settings.getRetention());
  } catch { /* 裁剪失败下次再试 */ }
}

/** 提取时间范围内全部上报记录 */
function getRows(startMs = 0, endMs = Infinity) {
  load();
  const end = endMs === Infinity ? Number.MAX_SAFE_INTEGER : endMs;
  return state.records.filter((r) => r.createdAt >= startMs && r.createdAt <= end);
}

/** 生成本地上报 ID */
function newRequestId() {
  return `api-${crypto.randomUUID()}`;
}

/* ---------- 保留策略（reports.jsonl 无限增长治理） ---------- */

const RETENTION_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastRetentionAt = 0;

/** 清空内存态，强制下次访问重读文件（备份导入后调用） */
function reset() {
  state.records = [];
  state.ids.clear();
  state.loaded = false;
}

/**
 * 按保留策略裁剪 reports.jsonl：保留「时间未过期」且「按行数不超过上限」的最新记录。
 * 两项阈值可任选，均为 0 表示该维度不限制；实际裁剪有 5 分钟节流，测试可传 force。
 * @returns {{ kept: number, removed: number } | null} 未启用/未触发返回 null
 */
function applyRetention(cfg, force = false) {
  load();
  const now = Date.now();
  if (!cfg || !cfg.enabled) return null;
  if (!cfg.max_age_days && !cfg.max_lines) return null;
  if (!force) {
    if (now - lastRetentionAt < RETENTION_CHECK_INTERVAL_MS) return null;
  }
  lastRetentionAt = now;
  const cutoff = cfg.max_age_days > 0 ? now - cfg.max_age_days * 86400000 : 0;
  const maxLines = cfg.max_lines > 0 ? Math.floor(cfg.max_lines) : Infinity;
  // 时间过滤后取最新 maxLines 条（记录按追加序，即时间序）
  const byAge = cutoff ? state.records.filter((r) => r.createdAt >= cutoff) : state.records;
  const kept = byAge.slice(-maxLines);
  if (kept.length === state.records.length) return { kept: kept.length, removed: 0 };
  const removed = state.records.length - kept.length;
  state.records = kept;
  state.ids = new Set(kept.map((r) => r.requestId));
  const file = FILE;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, file);
  return { kept: kept.length, removed };
}

/** 当前上报记录条数与文件大小（保留策略展示用） */
function retentionStats() {
  load();
  let bytes = 0;
  try { bytes = fs.statSync(FILE).size; } catch { /* 文件不存在 */ }
  return { records: state.records.length, bytes };
}

module.exports = { append, getRows, newRequestId, applyRetention, retentionStats, reset, source: 'api' };
