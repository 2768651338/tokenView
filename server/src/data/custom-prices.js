/**
 * 自定义模型市场价：存储于数据目录 custom-prices.json
 * 结构与默认 prices.json 一致（元 / 1K tokens）；自定义值覆盖默认值，也可新增默认表外的模型
 * 每次调用重读文件：外部手工修改同样即时生效；文件损坏时安全回退默认价
 */
const fs = require('fs');
const path = require('path');
const defaults = require('./prices.json');
const modelradar = require('./modelradar');
const { dataDir } = require('../runtime');

const FILE = () => path.join(dataDir(), 'custom-prices.json');

/** mtime 缓存：文件未变时不重复读盘解析（费用计算每轮构建会高频调用） */
const customCache = { mtimeMs: null, size: null, map: {} };

/** 读取并清洗自定义价格表（过滤非法条目） */
function loadCustom() {
  let st = null;
  try {
    st = fs.statSync(FILE());
  } catch { /* 文件不存在 */ }
  if (!st) {
    if (customCache.mtimeMs !== null) {
      customCache.mtimeMs = null;
      customCache.size = null;
      customCache.map = {};
    }
    return {};
  }
  if (customCache.mtimeMs === st.mtimeMs && customCache.size === st.size) return customCache.map;
  const out = {};
  try {
    const obj = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [model, p] of Object.entries(obj)) {
        if (!p || typeof p !== 'object') continue;
        const input = Number(p.input);
        const output = Number(p.output);
        if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
          out[model] = { input, output };
        }
      }
    }
  } catch { /* 文件损坏：全部回退默认价 */ }
  customCache.mtimeMs = st.mtimeMs;
  customCache.size = st.size;
  customCache.map = out;
  return out;
}

function saveCustom(map) {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2));
}

/** 生效价格表 = 默认 prices.json + 在线同步（modelradar）+ 自定义覆盖，三层依次覆盖 */
function getPrices() {
  return { ...defaults, ...modelradar.getOnlinePrices(), ...loadCustom() };
}

/** 价格来源判定：custom / modelradar / default */
function getLayer(model) {
  const custom = loadCustom();
  if (model in custom) return 'custom';
  if (model in modelradar.getOnlinePrices()) return 'modelradar';
  return 'default';
}

/** 仅自定义覆盖部分 */
function getCustomMap() {
  return loadCustom();
}

/** 仅默认价目表 */
function getDefaults() {
  return defaults;
}

/** 新增/修改自定义价格；返回 { model } 或 { error } */
function setPrice(model, input, output) {
  const name = String(model || '').trim().slice(0, 128);
  if (!name) return { error: 'model 不能为空' };
  const i = Number(input);
  const o = Number(output);
  if (!Number.isFinite(i) || i < 0 || !Number.isFinite(o) || o < 0) {
    return { error: '单价必须为不小于 0 的数字' };
  }
  const map = loadCustom();
  map[name] = { input: Number(i.toFixed(6)), output: Number(o.toFixed(6)) };
  saveCustom(map);
  return { model: name };
}

/** 删除自定义价格（该模型回退默认价；默认表也没有则从价表中消失）；返回 { model } 或 { error } */
function removePrice(model) {
  const name = String(model || '').trim();
  if (!name) return { error: 'model 不能为空' };
  const map = loadCustom();
  if (!(name in map)) return { error: '该模型没有自定义价格' };
  delete map[name];
  saveCustom(map);
  return { model: name };
}

module.exports = {
  getPrices,
  getCustomMap,
  getDefaults,
  getLayer,
  getOnlinePrices: () => modelradar.getOnlinePrices(),
  getOnlineMeta: () => modelradar.getOnlineMeta(),
  setPrice,
  removePrice
};
