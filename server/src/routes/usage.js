const express = require('express');
const crypto = require('crypto');
const reports = require('../data/reports');
const priceTable = require('../data/custom-prices');
const stats = require('../data/stats');

const router = express.Router();

/**
 * 上报鉴权：设置环境变量 TOKENVIEW_REPORT_TOKEN 后启用，
 * 调用方需携带请求头 x-report-token。未设置时保持开放（本机使用场景）。
 * 双方先做 SHA-256 再比较：长度恒定，可用 timingSafeEqual 防时序侧信道。
 */
function assertReportAuth(req, res) {
  const expected = String(process.env.TOKENVIEW_REPORT_TOKEN || '');
  if (!expected) return true;
  const got = String(req.get('x-report-token') || '');
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  if (crypto.timingSafeEqual(a, b)) return true;
  res.status(401).json({ code: 401, message: '上报鉴权失败：缺少或错误的 x-report-token 请求头' });
  return false;
}

/**
 * 上报一次 token 消耗（写入本地 JSONL，实时生效）
 * POST /api/usage/report
 * body: {
 *   channel: "deepseek",              // 渠道名称
 *   model: "deepseek-chat",           // 模型名称
 *   prompt_tokens: 1234,              // 输入 tokens（不含缓存）
 *   completion_tokens: 567,           // 输出 tokens
 *   cache_read_tokens: 0,             // 可选，缓存读 tokens
 *   cache_write_tokens: 0,            // 可选，缓存写 tokens
 *   latency_ms: 850,                  // 可选，延迟
 *   status: 1,                        // 可选，1成功 0失败，默认 1
 *   request_id: "req_xxx",            // 可选，未传则自动生成
 *   tool: "Trae",                     // 可选，工具标识（工具维度统计用）
 *   project: "my-app",                // 可选，项目名（项目维度统计用）
 *   remark: "备注"                    // 可选，备注（≤255 字符）
 * }
 */
router.post('/report', (req, res) => {
  try {
    if (!assertReportAuth(req, res)) return;
    const {
      channel: channelName = '',
      model: modelName = '',
      prompt_tokens = 0,
      completion_tokens = 0,
      cache_read_tokens = 0,
      cache_write_tokens = 0,
      latency_ms = 0,
      status = 1,
      request_id = '',
      tool = '',
      project = '',
      remark = ''
    } = req.body || {};

    // 基础校验
    if (!String(channelName).trim() || !String(modelName).trim()) {
      return res.status(400).json({ code: 400, message: 'channel 与 model 为必填项' });
    }
    const pTokens = Math.max(0, Number(prompt_tokens) || 0);
    const cTokens = Math.max(0, Number(completion_tokens) || 0);
    const crTokens = Math.max(0, Number(cache_read_tokens) || 0);
    const cwTokens = Math.max(0, Number(cache_write_tokens) || 0);
    if (pTokens + cTokens + crTokens + cwTokens <= 0) {
      return res.status(400).json({ code: 400, message: 'token 数量必须大于 0' });
    }
    const requestId = String(request_id).trim() || reports.newRequestId();

    const row = reports.append({
      channel: String(channelName).trim(),
      model: String(modelName).trim(),
      promptTokens: pTokens,
      completionTokens: cTokens,
      cacheReadTokens: crTokens,
      cacheWriteTokens: cwTokens,
      latencyMs: Math.max(0, Number(latency_ms) || 0),
      status: status ? 1 : 0,
      requestId,
      tool: String(tool).trim().slice(0, 32),
      project: String(project).trim().slice(0, 128),
      remark: String(remark).slice(0, 255)
    });

    if (!row) {
      // 相同 request_id 重复上报：幂等返回成功（调用方重试场景）
      return res.json({
        code: 0,
        message: '重复上报，已忽略（request_id 已存在）',
        data: { duplicate: true, request_id: requestId }
      });
    }

    stats.invalidate(); // 新上报进入聚合缓存

    // 费用与 stats 聚合同一计算口径（cc-switch 真实缓存价 > 价率估算）
    const p = priceTable.getPrices()[row.model] || {};
    const cost = Number(stats.computeRowCost(
      row,
      Number(p.input) || 0,
      Number(p.output) || 0,
      stats.cachePricesFor(row.model)
    ).toFixed(4));
    res.json({
      code: 0,
      message: '上报成功',
      data: {
        request_id: row.requestId,
        channel: row.channel,
        model: row.model,
        total_tokens: row.totalTokens,
        cost
      }
    });
  } catch (err) {
    console.error('[report error]', err.message);
    res.status(500).json({ code: 500, message: '上报失败: ' + err.message });
  }
});

module.exports = router;
