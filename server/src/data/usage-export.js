/**
 * 用量明细导出序列化（CSV）
 * 规则：UTF-8 BOM（Excel 识别）+ CRLF 行尾；含逗号/引号/换行的字段加引号包裹；
 * = + - @ 开头的字段加单引号前缀，防止 Excel 打开时被当作公式执行（CSV 公式注入）。
 * 独立于路由层：路由只设置响应头并回传此模块产出的 Buffer。
 */
const COLUMNS = [
  ['created_at', '时间'],
  ['channel', '渠道'],
  ['model', '模型'],
  ['source', '来源'],
  ['project', '项目'],
  ['prompt_tokens', '输入'],
  ['completion_tokens', '输出'],
  ['cache_tokens', '缓存'],
  ['total_tokens', '总量'],
  ['cost', '费用'],
  ['latency_ms', '延迟ms'],
  ['ttft_ms', '首字延迟ms'],
  ['error_type', '错误类型'],
  ['status', '状态']
];

function csvEscape(v) {
  let s = String(v ?? '');
  if (s.length && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 明细视图行数组 -> CSV Buffer（含 BOM） */
function toCsv(rows) {
  const lines = [COLUMNS.map(([, title]) => csvEscape(title)).join(',')];
  for (const r of rows) {
    lines.push(COLUMNS.map(([key]) => csvEscape(r[key])).join(','));
  }
  return Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8');
}

module.exports = { toCsv };
