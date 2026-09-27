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

module.exports = { getFxRate, setFxRate, getZcodeDir, setZcodeDir };
