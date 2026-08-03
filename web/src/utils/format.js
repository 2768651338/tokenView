/** 数字格式化工具 */

/** token 量：亿/万 缩写 */
export function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
  return v.toLocaleString('zh-CN');
}

/** 精确 token 数（表格用） */
export function fmtNum(n) {
  return (Number(n) || 0).toLocaleString('zh-CN');
}

/** 金额 */
export function fmtCost(n) {
  return '¥' + (Number(n) || 0).toFixed(2);
}

/** 百分比 */
export function fmtPercent(n) {
  return (Number(n) || 0).toFixed(2) + '%';
}

/** 毫秒 → 可读延迟 */
export function fmtLatency(ms) {
  const v = Number(ms) || 0;
  return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v + ' ms';
}
