const express = require('express');
const reports = require('../data/reports');
const priceTable = require('../data/custom-prices');

const router = express.Router();

/**
 * 上报一次 token 消耗（写入本地 JSONL，实时生效）
 * POST /api/usage/report
 * body: {
 *   channel: "deepseek",              // 渠道名称
 *   model: "deepseek-chat",           // 模型名称
 *   prompt_tokens: 1234,              // 输入 tokens
 *   completion_tokens: 567,           // 输出 tokens
 *   latency_ms: 850,                  // 可选，延迟
 *   status: 1,                        // 可选，1成功 0失败，默认 1
 *   request_id: "req_xxx",            // 可选，未传则自动生成
 *   tool: "Trae"                      // 可选，工具标识（工具维度统计用）
 * }
 */
router.post('/report', (req, res) => {
  try {
    const {
      channel: channelName = '',
      model: modelName = '',
      prompt_tokens = 0,
      completion_tokens = 0,
      latency_ms = 0,
      status = 1,
      request_id = '',
      tool = ''
    } = req.body || {};

    // 基础校验
    if (!String(channelName).trim() || !String(modelName).trim()) {
      return res.status(400).json({ code: 400, message: 'channel 与 model 为必填项' });
    }
    const pTokens = Math.max(0, Number(prompt_tokens) || 0);
    const cTokens = Math.max(0, Number(completion_tokens) || 0);
    if (pTokens + cTokens <= 0) {
      return res.status(400).json({ code: 400, message: 'token 数量必须大于 0' });
    }
    const requestId = String(request_id).trim() || reports.newRequestId();

    const row = reports.append({
      channel: String(channelName).trim(),
      model: String(modelName).trim(),
      promptTokens: pTokens,
      completionTokens: cTokens,
      latencyMs: Math.max(0, Number(latency_ms) || 0),
      status: status ? 1 : 0,
      requestId,
      tool: String(tool).trim().slice(0, 32)
    });

    if (!row) {
      // 相同 request_id 重复上报：幂等返回成功（调用方重试场景）
      return res.json({
        code: 0,
        message: '重复上报，已忽略（request_id 已存在）',
        data: { duplicate: true, request_id: requestId }
      });
    }

    const p = priceTable.getPrices()[row.model] || {};
    const cost = Number(((row.promptTokens * (Number(p.input) || 0) + row.completionTokens * (Number(p.output) || 0)) / 1000).toFixed(4));
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
