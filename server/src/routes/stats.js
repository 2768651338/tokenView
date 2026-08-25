const express = require('express');
const stats = require('../data/stats');
const priceTable = require('../data/custom-prices');

const router = express.Router();

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error('[stats error]', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
};

// ---------- 核心 KPI 汇总 ----------
router.get('/overview', wrap((req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  res.json({ code: 0, data: stats.getOverview(days) });
}));

// ---------- 时间趋势 ----------
router.get('/trend', wrap((req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
    ? req.query.granularity : 'day';
  res.json({
    code: 0,
    data: stats.getTrend(days, granularity, req.query.channel || '')
  });
}));

// ---------- 渠道维度统计 ----------
router.get('/channels', wrap((req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 365);
  res.json({ code: 0, data: stats.getChannels(days) });
}));

// ---------- 模型 Top 排行 ----------
router.get('/models', wrap((req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 365);
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  res.json({ code: 0, data: stats.getModels(days, limit) });
}));

// ---------- 工具统计（13 个 code 工具） ----------
router.get('/tools', wrap((req, res) => {
  res.json({ code: 0, data: stats.getTools() });
}));

// ---------- 模型市场价参考 ----------
router.get('/prices', wrap((req, res) => {
  res.json({
    code: 0,
    data: {
      currency: '元 / 百万 tokens',
      note: '官方市场价（2026-08 查询，美元计价按汇率 6.8 换算），中转渠道实际收费可能不同；标「自定义」的为手动覆盖价',
      list: stats.getPrices()
    }
  });
}));

// 新增/修改自定义模型单价（覆盖默认价，也可新增默认表外的模型）
router.post('/prices', wrap((req, res) => {
  const { model, input, output } = req.body || {};
  const r = priceTable.setPrice(model, input, output);
  if (r.error) return res.status(400).json({ code: 400, message: r.error });
  res.json({ code: 0, message: '已保存', data: r });
}));

// 恢复默认价（删除自定义覆盖）
router.post('/prices/reset', wrap((req, res) => {
  const { model } = req.body || {};
  const r = priceTable.removePrice(model);
  if (r.error) return res.status(400).json({ code: 400, message: r.error });
  res.json({ code: 0, message: '已恢复默认价', data: r });
}));

// ---------- 用量明细分页 ----------
router.get('/usage', wrap((req, res) => {
  res.json({
    code: 0,
    data: stats.getUsage({
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 200),
      channel: req.query.channel || '',
      status: req.query.status,
      start: req.query.start || '',
      end: req.query.end || '',
      source: req.query.source || ''
    })
  });
}));

// ---------- 渠道列表 ----------
router.get('/channels', wrap((req, res) => {
  res.json({ code: 0, data: stats.getChannelList() });
}));

module.exports = router;
