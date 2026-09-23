/**
 * 预算配置：存储于数据目录 budget.json
 * { daily: 元/天, monthly: 元/月, enabled: bool }，0 或缺省表示未设该项预算
 * 每次调用重读文件（mtime 缓存），外部手工修改同样即时生效；文件损坏时回退默认
 */
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../runtime');

const FILE = () => path.join(dataDir(), 'budget.json');

const DEFAULTS = { daily: 0, monthly: 0, enabled: false };

const cache = { mtimeMs: null, size: null, cfg: null };

/** 读取并清洗预算配置（负数与非法值一律按 0/默认处理） */
function get() {
  let st = null;
  try {
    st = fs.statSync(FILE());
  } catch { /* 文件不存在 */ }
  if (!st) {
    if (cache.mtimeMs !== null) {
      cache.mtimeMs = null;
      cache.size = null;
      cache.cfg = null;
    }
    return { ...DEFAULTS };
  }
  if (cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.cfg;
  let cfg = { ...DEFAULTS };
  try {
    const obj = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    const daily = Number(obj.daily);
    const monthly = Number(obj.monthly);
    cfg = {
      daily: Number.isFinite(daily) && daily > 0 ? daily : 0,
      monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : 0,
      enabled: !!obj.enabled
    };
  } catch { /* 文件损坏：回退默认 */ }
  cache.mtimeMs = st.mtimeMs;
  cache.size = st.size;
  cache.cfg = cfg;
  return cfg;
}

/** 保存预算配置；返回清洗后的配置 */
function set({ daily, monthly, enabled } = {}) {
  const d = Number(daily);
  const m = Number(monthly);
  const cfg = {
    daily: Number.isFinite(d) && d > 0 ? Number(d.toFixed(2)) : 0,
    monthly: Number.isFinite(m) && m > 0 ? Number(m.toFixed(2)) : 0,
    enabled: !!enabled
  };
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  cache.mtimeMs = null;
  cache.size = null;
  cache.cfg = null;
  return cfg;
}

module.exports = { get, set };
