/**
 * 数据源：CodeBuddy CN（腾讯）
 * 用量缓存在 VS Code secret storage（v10t 加密），best-effort 解密后
 * 递归提取含 tokens 字段的对象。解密失败时 healthy=false（工具显示"解密失败"）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readSecret } = require('./vscode-secret');

const DEFAULT_ROOT = path.join(os.homedir(), 'AppData', 'Roaming', 'CodeBuddy CN');
const SECRET_KEY = 'CodeBuddy-LLMDataReportCACHE-llm-data';
const REFRESH_INTERVAL_MS = 15000;

const cache = { records: [], lastScan: 0, healthy: true, root: null, reason: '' };

const num = (o, ...ks) => { for (const k of ks) if (o && typeof o[k] === 'number' && !Number.isNaN(o[k])) return o[k]; return 0; };

/** 递归寻找含 tokens 字段的对象并提取为记录 */
function extractRecords(node, records, pathHint = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) extractRecords(item, records, pathHint);
    return;
  }
  const total = num(node, 'totalTokens', 'total_tokens');
  if (total > 0) {
    const prompt = num(node, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
    const completion = num(node, 'outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens');
    const ts = num(node, 'timestamp', 'time', 'createdAt', 'created_at', 'updatedAt') || Date.now();
    const model = node.model || node.modelId || node.modelName || 'unknown';
    records.push({
      requestId: `codebuddy-cn:${pathHint}:${ts}`,
      channel: model,
      channelKind: 'codebuddy-cn',
      model,
      source: 'codebuddy-cn',
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      latencyMs: 0,
      status: 1,
      remark: `key=${pathHint.slice(0, 40)}`.slice(0, 255),
      createdAt: ts
    });
  }
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') extractRecords(v, records, pathHint ? `${pathHint}.${k}` : k);
  }
}

function rebuild() {
  const root = process.env.CODEBUDDY_CN_DIR || DEFAULT_ROOT;
  const vscdb = path.join(root, 'User', 'globalStorage', 'state.vscdb');
  const localState = path.join(root, 'Local State');
  const records = [];
  try {
    const plain = readSecret(vscdb, localState, SECRET_KEY);
    if (!plain) {
      cache.healthy = false;
      cache.reason = '解密失败';
      console.warn('[codebuddy-cn] 用量缓存解密失败（加密格式或密钥不可用）');
    } else {
      let data = null;
      try { data = JSON.parse(plain); } catch { /* 明文非 JSON（如纯时间戳） */ }
      if (data && typeof data === 'object') {
        extractRecords(data, records, 'root');
      }
      // 解密可用但无 token 明细（本地仅存最后上报时间戳等）→ 不算解密失败
      cache.healthy = true;
      cache.reason = records.length ? '' : '缓存无用量明细';
    }
  } catch (e) {
    cache.healthy = false;
    cache.reason = '解密失败';
    console.warn('[codebuddy-cn] 解析失败:', e.message);
  }
  cache.records = records;
  cache.lastScan = Date.now();
  cache.root = root;
}

function ensureFresh() {
  const root = process.env.CODEBUDDY_CN_DIR || DEFAULT_ROOT;
  const now = Date.now();
  if (now - cache.lastScan < REFRESH_INTERVAL_MS && cache.root === root) return;
  rebuild();
}

/** 提取时间范围内全部记录 */
function getRows(startMs = 0, endMs = Infinity) {
  ensureFresh();
  return cache.records.filter((r) => r.createdAt >= startMs && r.createdAt <= endMs);
}

/** 数据源健康状态（解密是否成功） */
function status() {
  ensureFresh();
  return { healthy: cache.healthy, reason: cache.reason };
}

module.exports = { getRows, status, source: 'codebuddy-cn' };
