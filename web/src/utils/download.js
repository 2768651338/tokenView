/** 文件下载与 CSV 生成工具 */

/** 单元格转义：公式注入防护 + 引号/逗号/换行包裹（与后端 usage-export.js 规则一致） */
function csvEscape(v) {
  let s = String(v ?? '');
  if (s.length && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 前端数据转 CSV 下载（columns: [[key, 表头], ...]，rows: 对象数组） */
export function downloadCsv(filename, columns, rows) {
  const lines = [columns.map(([, title]) => csvEscape(title)).join(',')];
  for (const r of rows) {
    lines.push(columns.map(([key]) => csvEscape(r[key])).join(','));
  }
  triggerDownload(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
}

/** 触发浏览器下载 blob（Electron 渲染进程同样适用，不走 window.open） */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 从 axios blob 响应触发下载，文件名优先取 Content-Disposition */
export function saveBlobResponse(res, fallbackName) {
  let name = fallbackName;
  const dispo = String((res.headers && res.headers['content-disposition']) || '');
  if (dispo) {
    const m = dispo.match(/filename\*=UTF-8''([^;]+)/i) || dispo.match(/filename="?([^";]+)"?/i);
    if (m && m[1]) {
      try { name = decodeURIComponent(m[1]); } catch { name = fallbackName; }
    }
  }
  triggerDownload(res.data, name);
}
