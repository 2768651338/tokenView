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

module.exports = { getFxRate, setFxRate };
