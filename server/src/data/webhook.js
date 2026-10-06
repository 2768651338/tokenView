/**
 * Webhook 告警推送：预算告警推送到钉钉 / 飞书 / 企业微信 / 自定义接收端。
 * - URL 存储：数据目录 settings.json（用户在界面配置）；环境变量 TOKENVIEW_WEBHOOK_URL 优先
 * - 仅允许 http(s)，8 秒超时；发送失败不影响预算检查主流程
 * - 预算轮询 5 分钟一次，告警级别每天每级最多推送一次（与桌面通知同一节流口径）
 * 注：轮询节流状态在内存中（进程重启后当天可能重发一次，可接受）
 */
const settings = require('./settings');

const SEND_TIMEOUT_MS = 8000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** 生效配置：环境变量 URL 存在时强制启用并覆盖设置值 */
function effectiveWebhook() {
  const cfg = settings.getWebhook();
  const envUrl = String(process.env.TOKENVIEW_WEBHOOK_URL || '').trim();
  if (envUrl) return { ...cfg, enabled: true, url: envUrl, env_locked: true };
  return cfg;
}

/** 校验目标 URL：仅 http(s) 且有主机名 */
function assertSafeUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('无效的 URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅允许 http(s) 请求');
  if (!url.hostname) throw new Error('URL 缺少主机名');
  return url;
}

/** 按平台构造消息体（text 支持钉钉/企微 markdown，飞书走纯文本） */
function buildBody(type, title, text) {
  if (type === 'feishu') {
    return { msg_type: 'text', content: { text: `${title}\n${text}` } };
  }
  if (type === 'wecom') {
    return { msgtype: 'markdown', markdown: { content: `**${title}**\n${text}` } };
  }
  if (type === 'generic') {
    return { title, text, timestamp: new Date().toISOString() };
  }
  // dingtalk（默认）
  return { msgtype: 'markdown', markdown: { title, text } };
}

/**
 * 推送一条消息。
 * @returns {{ ok: boolean, status?: number, error?: string, body?: string }}
 */
async function send(title, text) {
  const cfg = effectiveWebhook();
  if (!cfg.enabled) return { ok: false, error: 'Webhook 未启用' };
  if (!cfg.url) return { ok: false, error: 'Webhook URL 未配置' };
  let url;
  try {
    url = assertSafeUrl(cfg.url);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(cfg.type, title, text)),
      signal: ctrl.signal
    });
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { /* 响应体读取失败不影响结果 */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? `超过 ${SEND_TIMEOUT_MS / 1000} 秒超时` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 预算告警轮询 ---------- */

let loopStarted = false;
const sentKeys = new Set(); // `${level}-${YYYY-MM-DD}`，每天每级最多一次

/** 预算状态 → 推送正文 */
function budgetText(st) {
  const lines = [];
  if (st.daily > 0) {
    lines.push(`- 今日：¥${st.today_cost.toFixed(2)} / ¥${st.daily.toFixed(2)}（${Math.round(st.daily_ratio)}%）`);
  }
  if (st.monthly > 0) {
    lines.push(`- 本月：¥${st.month_cost.toFixed(2)} / ¥${st.monthly.toFixed(2)}（${Math.round(st.monthly_ratio)}%）`);
  }
  return lines.join('\n');
}

/**
 * 启动预算告警轮询（进程内仅一次；由 app 工厂调用，getStatus 注入避免循环依赖）。
 */
function startBudgetLoop(getStatus, intervalMs = CHECK_INTERVAL_MS) {
  if (loopStarted || typeof getStatus !== 'function') return;
  loopStarted = true;
  const tick = async () => {
    try {
      const st = await getStatus();
      if (!st || !st.enabled || (st.level !== 'warn' && st.level !== 'danger')) return;
      const day = new Date().toISOString().slice(0, 10);
      const key = `${st.level}-${day}`;
      if (sentKeys.has(key)) return;
      sentKeys.add(key);
      const title = st.level === 'danger' ? 'TokenView 预算告警' : 'TokenView 预算提醒';
      const r = await send(title, budgetText(st));
      if (r.ok) console.log(`[webhook] 预算${st.level === 'danger' ? '告警' : '提醒'}已推送`);
      else console.warn(`[webhook] 推送失败: ${r.error || `HTTP ${r.status}`}`);
    } catch (e) {
      console.error('[webhook] 预算检查失败:', e.message);
    }
  };
  setTimeout(tick, 20 * 1000).unref(); // 启动后稍等首轮（等聚合缓存预热）
  setInterval(tick, intervalMs).unref();
}

module.exports = { send, startBudgetLoop, effectiveWebhook, buildBody, assertSafeUrl };
