const express = require('express');
const stats = require('../data/stats');
const priceTable = require('../data/custom-prices');
const modelradar = require('../data/modelradar');

const router = express.Router();

const wrap = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    console.error('[stats error]', err.message);
    if (!res.headersSent) res.status(500).json({ code: 500, message: '服务器内部错误' });
  });
};

// ---------- 核心 KPI 汇总 ----------
router.get('/overview', wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  res.json({ code: 0, data: await stats.getOverview(days) });
}));

// ---------- 时间趋势 ----------
router.get('/trend', wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
    ? req.query.granularity : 'day';
  res.json({
    code: 0,
    data: await stats.getTrend(days, granularity, req.query.channel || '')
  });
}));

// ---------- 渠道维度统计 ----------
router.get('/channels', wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 365);
  res.json({ code: 0, data: await stats.getChannels(days) });
}));

// ---------- 模型 Top 排行 ----------
router.get('/models', wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 365);
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  res.json({ code: 0, data: await stats.getModels(days, limit) });
}));

// ---------- 工具统计（13 个 code 工具） ----------
router.get('/tools', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getTools() });
}));

// ---------- 模型市场价参考 ----------
router.get('/prices', wrap(async (req, res) => {
  res.json({
    code: 0,
    data: {
      currency: '元 / 百万 tokens',
      note: '价目分三层：自定义 > 在线同步（modelradar.cn，USD 按汇率换算）> 官方默认（2026-08 查询）；中转渠道实际收费可能不同',
      online: priceTable.getOnlineMeta(),
      list: await stats.getPrices()
    }
  });
}));

// 新增/修改自定义模型单价（覆盖在线价与默认价，也可新增价表外的模型）
router.post('/prices', wrap(async (req, res) => {
  const { model, input, output } = req.body || {};
  const r = priceTable.setPrice(model, input, output);
  if (r.error) return res.status(400).json({ code: 400, message: r.error });
  stats.invalidate(); // 费用按单价重算
  res.json({ code: 0, message: '已保存', data: r });
}));

// 恢复默认价（删除自定义覆盖；若存在在线价则回落到在线价）
router.post('/prices/reset', wrap(async (req, res) => {
  const { model } = req.body || {};
  const r = priceTable.removePrice(model);
  if (r.error) return res.status(400).json({ code: 400, message: r.error });
  stats.invalidate();
  res.json({ code: 0, message: '已恢复默认价', data: r });
}));

// 从 ModelRadar 同步在线价目（手动触发；仅 https + host 白名单 + 拒绝私网地址）
router.post('/prices/sync-modelradar', (req, res) => {
  modelradar.syncFromModelRadar()
    .then((r) => {
      stats.invalidate();
      res.json({ code: 0, message: '同步成功', data: r });
    })
    .catch((e) => {
      console.error('[modelradar sync]', e.message);
      res.status(502).json({ code: 502, message: '同步失败：' + e.message });
    });
});

// ---------- 用量明细分页 ----------
router.get('/usage', wrap(async (req, res) => {
  res.json({
    code: 0,
    data: await stats.getUsage({
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
router.get('/channels/list', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getChannelList() });
}));

module.exports = router;
