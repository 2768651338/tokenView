/**
 * 应用设置：存储于数据目录 settings.json
 * 目前仅存美元汇率覆盖（modelradar 在线价换算用）；null 表示未覆盖，
 * 回退顺序：settings.json > 环境变量 MODELRADAR_FX_USD_CNY > 默认值（modelradar 内置）
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../runtime');

const FILE = () => path.join(dataDir(), 'settings.json');

const cache = { mtimeMs: null, size: null, obj: null };

function load() {
  let st = null;
  try {
    st = fs.statSync(FILE());
  } catch { /* 文件不存在 */ }
  if (!st) {
    if (cache.mtimeMs !== null) {
      cache.mtimeMs = null;
      cache.size = null;
      cache.obj = null;
    }
    return {};
  }
  if (cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.obj;
  let obj = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
  } catch { /* 文件损坏：视为空设置 */ }
  cache.mtimeMs = st.mtimeMs;
  cache.size = st.size;
  cache.obj = obj;
  return obj;
}

function save(obj) {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  cache.mtimeMs = null;
  cache.size = null;
  cache.obj = null;
}

/** 汇率覆盖值；未设置返回 null（调用方继续走环境变量/默认） */
function getFxRate() {
  const v = Number(load().fx_rate);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 设置汇率覆盖；rate 为 null/非法值表示清除覆盖。返回 { fx_rate } */
function setFxRate(rate) {
  const obj = load();
  const v = Number(rate);
  if (rate === null || rate === undefined || rate === '' || !Number.isFinite(v) || v <= 0) {
    delete obj.fx_rate;
  } else {
    obj.fx_rate = Number(v.toFixed(6));
  }
  save(obj);
  return { fx_rate: getFxRate() };
}

/* ---------- ZCode 数据位置覆盖 ---------- */

/** 用户手动指定的 .zcode 根目录；未设置返回 ''（走默认 ~/.zcode 或环境变量） */
function getZcodeDir() {
  const v = String(load().zcode_dir || '').trim();
  return v.slice(0, 512);
}

/** 设置 / 清除 ZCode 数据目录；dir 为空串/null 表示清除。返回 { zcode_dir } */
function setZcodeDir(dir) {
  const obj = load();
  const v = String(dir || '').trim().slice(0, 512);
  if (v) obj.zcode_dir = v;
  else delete obj.zcode_dir;
  save(obj);
  return { zcode_dir: getZcodeDir() };
}

/* ---------- Webhook 告警推送 ---------- */

const WEBHOOK_TYPES = ['dingtalk', 'feishu', 'wecom', 'generic'];

/**
 * Webhook 配置 { enabled, url, type }；环境变量 TOKENVIEW_WEBHOOK_URL 优先级更高
 * （url 字段与 UI 展示仍保留设置值，实际发送走环境变量）。
 */
function getWebhook() {
  const obj = load();
  const w = obj.webhook && typeof obj.webhook === 'object' ? obj.webhook : {};
  const type = WEBHOOK_TYPES.includes(w.type) ? w.type : 'dingtalk';
  return {
    enabled: !!w.enabled,
    url: String(w.url || '').trim().slice(0, 2048),
    type,
    env_locked: !!String(process.env.TOKENVIEW_WEBHOOK_URL || '').trim()
  };
}

/** 保存 Webhook 配置；url 为空串时清除。返回清洗后的配置 */
function setWebhook({ enabled, url, type } = {}) {
  const obj = load();
  const u = String(url || '').trim().slice(0, 2048);
  if (u) {
    obj.webhook = {
      enabled: !!enabled,
      url: u,
      type: WEBHOOK_TYPES.includes(type) ? type : 'dingtalk'
    };
  } else {
    delete obj.webhook;
  }
  save(obj);
  return getWebhook();
}

/* ---------- 订阅渠道（包月制渠道的市场价等价视图） ---------- */

/** 读取订阅渠道列表 [{ name, monthly_fee }]，过滤非法条目 */
function getSubscriptionChannels() {
  const raw = load().subscription_channels;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim().slice(0, 64);
    const fee = Number(item.monthly_fee);
    if (!name || !Number.isFinite(fee) || fee < 0) continue;
    out.push({ name, monthly_fee: Number(fee.toFixed(2)) });
    if (out.length >= 20) break; // 订阅渠道数量封顶，防止误导入
  }
  return out;
}

/** 保存订阅渠道列表（全量替换；同名去重，保留费率较大者） */
function setSubscriptionChannels(list) {
  const obj = load();
  const cleaned = [];
  const byName = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim().slice(0, 64);
    const fee = Number(item.monthly_fee);
    if (!name || !Number.isFinite(fee) || fee < 0) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    if (prev && prev.monthly_fee >= fee) continue;
    if (prev) cleaned.splice(cleaned.indexOf(prev), 1);
    const entry = { name, monthly_fee: Number(fee.toFixed(2)) };
    byName.set(key, entry);
    cleaned.push(entry);
    if (cleaned.length >= 20) break;
  }
  obj.subscription_channels = cleaned;
  save(obj);
  return getSubscriptionChannels();
}

/* ---------- 上报数据保留策略 ---------- */

const RETENTION_DEFAULTS = { enabled: false, max_age_days: 0, max_lines: 0 };

/** 读取保留策略；两项阈值至少要启用一项才有意义，读取时原样返回由调用方判断 */
function getRetention() {
  const r = load().report_retention;
  if (!r || typeof r !== 'object') return { ...RETENTION_DEFAULTS };
  const age = Number(r.max_age_days);
  const lines = Number(r.max_lines);
  return {
    enabled: !!r.enabled,
    max_age_days: Number.isFinite(age) && age > 0 ? Math.floor(age) : 0,
    max_lines: Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 0
  };
}

/** 保存保留策略；enabled 为 false 时保留阈值但不再生效 */
function setRetention({ enabled, max_age_days, max_lines } = {}) {
  const obj = load();
  const age = Number(max_age_days);
  const lines = Number(max_lines);
  obj.report_retention = {
    enabled: !!enabled,
    max_age_days: Number.isFinite(age) && age > 0 ? Math.floor(age) : 0,
    max_lines: Number.isFinite(lines) && lines > 0 ? Math.floor(lines) : 0
  };
  save(obj);
  return getRetention();
}

module.exports = {
  getFxRate, setFxRate, getZcodeDir, setZcodeDir,
  getWebhook, setWebhook,
  getSubscriptionChannels, setSubscriptionChannels,
  getRetention, setRetention
};
