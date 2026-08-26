/**
 * 在线价目源：ModelRadar（modelradar.cn 公开静态 JSON API，每日更新）
 * 拉取 https://modelradar.cn/data/models.json（USD / 百万 tokens），
 * 按汇率换算为元 / 1K tokens 后存入数据目录 modelradar-prices.json。
 * 价表合并优先级：自定义 custom-prices > 在线 modelradar-prices > 默认 prices.json。
 *
 * 安全约束：仅允许 https；host 白名单精确匹配 modelradar.cn；解析 DNS 后拒绝
 * 环回 / 私有 / 保留地址（防 SSRF）。
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const { dataDir } = require('../runtime');

const ENDPOINT = 'https://modelradar.cn/data/models.json';
const ALLOWED_HOST = 'modelradar.cn';
const TIMEOUT_MS = 15000;
const FILE = () => path.join(dataDir(), 'modelradar-prices.json');

/** 默认汇率：美元 → 人民币（可用环境变量 MODELRADAR_FX_USD_CNY 覆盖） */
function fxUsdCny() {
  const v = Number(process.env.MODELRADAR_FX_USD_CNY);
  return Number.isFinite(v) && v > 0 ? v : 6.8;
}

/** 校验请求目标：仅 https + host 白名单 + DNS 解析非私有/保留地址 */
async function assertSafeEndpoint(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('无效的 URL');
  }
  if (url.protocol !== 'https:') throw new Error('仅允许 https 请求');
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) throw new Error(`host 不在白名单内（仅允许 ${ALLOWED_HOST}）`);
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (!addrs.length) throw new Error('域名解析失败');
  for (const { address } of addrs) {
    if (isPrivateOrReserved(address)) {
      throw new Error(`解析到私有/保留地址（${address}），已拒绝请求`);
    }
  }
}

/** IPv4/IPv6 私有、环回与保留地址段判断 */
function isPrivateOrReserved(ip) {
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' || lower === '::' ||
      lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.') || lower.startsWith('::ffff:169.254.')
    );
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** 拉取并换算，写入本地快照；返回 { syncedAt, effectiveDate, count, fx } */
async function syncFromModelRadar() {
  await assertSafeEndpoint(ENDPOINT);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(ENDPOINT, { signal: ctrl.signal, headers: { 'User-Agent': 'TokenView-price-sync' } });
  } catch (e) {
    clearTimeout(timer);
    throw new Error('网络请求失败：' + (e.name === 'AbortError' ? `超过 ${TIMEOUT_MS / 1000} 秒超时` : e.message));
  }
  clearTimeout(timer);
  if (res.status !== 200) throw new Error(`远端返回 HTTP ${res.status}`);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('远端返回的不是有效 JSON');
  }
  if (!data || !Array.isArray(data.models) || data.models.length === 0) {
    throw new Error('远端数据缺少 models 数组');
  }

  const fx = fxUsdCny();
  const prices = {};
  let count = 0;
  for (const m of data.models) {
    if (!m || typeof m.id !== 'string' || !m.id.trim()) continue;
    const usdIn = Number(m.inputPriceUsdPer1M ?? m.inputPricePer1M);
    const usdOut = Number(m.outputPriceUsdPer1M ?? m.outputPricePer1M);
    if (!Number.isFinite(usdIn) || !Number.isFinite(usdOut) || usdIn < 0 || usdOut < 0) continue;
    // USD / 百万 tokens → 元 / 1K tokens
    prices[m.id.trim()] = {
      input: Number((usdIn * fx / 1000).toFixed(6)),
      output: Number((usdOut * fx / 1000).toFixed(6))
    };
    count++;
  }
  if (count === 0) throw new Error('远端数据中没有可用的价格条目');

  const syncedAt = new Date().toISOString();
  const payload = {
    syncedAt,
    source: 'modelradar.cn',
    effectiveDate: data.effectiveDate || null,
    fxUsdCny: fx,
    prices
  };
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return { syncedAt, effectiveDate: payload.effectiveDate, count, fx };
}

/** mtime 缓存：快照文件未变时不重复读盘解析 */
const snapCache = { mtimeMs: null, size: null, data: null };

/** 校验并读取在线价快照（损坏/缺失返回 null） */
function getOnline() {
  let st = null;
  try {
    st = fs.statSync(FILE());
  } catch { /* 未同步过 */ }
  if (!st) {
    snapCache.mtimeMs = null;
    snapCache.size = null;
    snapCache.data = null;
    return null;
  }
  if (snapCache.mtimeMs === st.mtimeMs && snapCache.size === st.size) return snapCache.data;
  let data = null;
  try {
    const obj = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (obj && typeof obj === 'object' && obj.prices && typeof obj.prices === 'object') data = obj;
  } catch { /* 损坏：视为未同步 */ }
  snapCache.mtimeMs = st.mtimeMs;
  snapCache.size = st.size;
  snapCache.data = data;
  return data;
}

/** 仅在线覆盖部分 */
function getOnlinePrices() {
  const o = getOnline();
  return o ? o.prices : {};
}

/** 在线同步元信息（供面板展示） */
function getOnlineMeta() {
  const o = getOnline();
  return o ? { syncedAt: o.syncedAt, effectiveDate: o.effectiveDate, fxUsdCny: o.fxUsdCny, source: o.source } : null;
}

module.exports = { syncFromModelRadar, getOnlinePrices, getOnlineMeta };
