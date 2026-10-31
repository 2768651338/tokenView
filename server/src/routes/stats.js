const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const stats = require('../data/stats');
const priceTable = require('../data/custom-prices');
const modelradar = require('../data/modelradar');
const settings = require('../data/settings');
const budget = require('../data/budget');
const usageExport = require('../data/usage-export');
const zcode = require('../data/zcode');
const searchMod = require('../data/search');
const webhook = require('../data/webhook');
const backup = require('../data/backup');
const reports = require('../data/reports');

const router = express.Router();

const wrap = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    console.error('[stats error]', err.message);
    if (!res.headersSent) res.status(500).json({ code: 500, message: '服务器内部错误' });
  });
};

// days 参数：'all' 表示全部数据，其余按最近 N 天处理（上限 365，非法值回退 fallback）
const parseDays = (raw, fallback) => (raw === 'all' ? 'all' : Math.min(Number(raw) || fallback, 365));

// ---------- 核心 KPI 汇总 ----------
router.get('/overview', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getOverview(days) });
}));

// ---------- 时间趋势 ----------
router.get('/trend', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
    ? req.query.granularity : 'day';
  res.json({
    code: 0,
    data: await stats.getTrend(days, granularity, req.query.channel || '')
  });
}));

// ---------- 渠道维度统计 ----------
router.get('/channels', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 7);
  res.json({ code: 0, data: await stats.getChannels(days) });
}));

// ---------- 模型 Top 排行 ----------
router.get('/models', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 7);
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

// ---------- 时段热力图（星期 × 小时） ----------
router.get('/heatmap', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getHeatmap(days) });
}));

// ---------- 延迟分析（P50 / P95 / 均值） ----------
router.get('/latency', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getLatency(days) });
}));

// ---------- 项目维度统计 ----------
router.get('/projects', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getProjects(days, req.query.limit) });
}));

// ---------- 会话维度统计（ZCode / Claude Code / Codex） ----------
router.get('/sessions', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json({ code: 0, data: await stats.getSessions(days, limit) });
}));

// ---------- 会话详情（用量汇总 + ZCode 消息预览） ----------
router.get('/session/detail', wrap(async (req, res) => {
  const detail = await stats.getSessionDetail(req.query.session_id, req.query.source);
  if (detail.error) return res.status(400).json({ code: 400, message: detail.error });
  res.json({ code: 0, data: detail });
}));

// ---------- 错误与中断分析 ----------
router.get('/errors', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getErrors(days) });
}));

// ---------- 真实工具调用统计（ZCode tool_usage） ----------
router.get('/tool-usage', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  res.json({ code: 0, data: await stats.getToolUsage(days, limit) });
}));

// ---------- 月度账单 ----------
router.get('/bill/months', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getBillMonths() });
}));

router.get('/bill', wrap(async (req, res) => {
  const bill = await stats.getBill(req.query.month);
  if (bill.error) return res.status(400).json({ code: 400, message: bill.error });
  res.json({ code: 0, data: bill });
}));

// ---------- 预算（配置 + 当前状态一并返回） ----------
router.get('/budget', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getBudgetStatus() });
}));

router.post('/budget', wrap(async (req, res) => {
  const { daily, monthly, enabled } = req.body || {};
  budget.set({ daily, monthly, enabled });
  res.json({ code: 0, message: '已保存', data: await stats.getBudgetStatus() });
}));

// ---------- 数据源健康 ----------
router.get('/health', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getHealth() });
}));

// ---------- 跨会话全文搜索（ZCode / Claude Code / Codex，手动触发） ----------
router.get('/search', wrap(async (req, res) => {
  const daysRaw = req.query.days;
  const days = daysRaw === 'all' || daysRaw === undefined || daysRaw === ''
    ? 'all' : Math.min(Number(daysRaw) || 'all', 365);
  const r = await searchMod.search({
    query: req.query.q,
    days,
    limit: Number(req.query.limit) || 20
  });
  if (r.error) return res.status(400).json({ code: 400, message: r.error });
  res.json({ code: 0, data: r });
}));

// ---------- 缓存命中率分析 ----------
router.get('/cache', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getCacheStats(days) });
}));

// ---------- What-if 成本模拟 ----------
router.get('/whatif', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 30);
  res.json({ code: 0, data: await stats.getWhatIf(days, req.query.model || '') });
}));

// ---------- 成本异常检测 ----------
router.get('/anomalies', wrap(async (req, res) => {
  const days = parseDays(req.query.days, 90);
  res.json({ code: 0, data: await stats.getAnomalies(days) });
}));

// ---------- 日报 / 周报 / 月报 Markdown 摘要 ----------
router.get('/digest', wrap(async (req, res) => {
  res.json({ code: 0, data: await stats.getDigest(req.query.period) });
}));

// ---------- Webhook 告警推送 ----------
router.post('/settings/webhook', wrap(async (req, res) => {
  const { enabled, url, type } = req.body || {};
  const saved = settings.setWebhook({ enabled, url, type });
  res.json({ code: 0, message: '已保存', data: saved });
}));

// 测试推送（使用当前配置；未配置时返回 400 带指引）
router.post('/webhook/test', wrap(async (req, res) => {
  const cfg = webhook.effectiveWebhook();
  if (!cfg.enabled || !cfg.url) {
    return res.status(400).json({ code: 400, message: '请先启用 Webhook 并填写 URL' });
  }
  const r = await webhook.send('TokenView 测试推送', `这是一条测试消息。类型：${cfg.type}；时间：${new Date().toLocaleString('zh-CN')}`);
  if (!r.ok) {
    return res.status(502).json({ code: 502, message: `推送失败：${r.error || `HTTP ${r.status}`}${r.body ? `，响应：${r.body}` : ''}` });
  }
  res.json({ code: 0, message: '推送成功', data: { status: r.status } });
}));

// ---------- 订阅渠道（月度账单的等价价值视图） ----------
router.post('/settings/subscription', wrap(async (req, res) => {
  const list = (req.body && Array.isArray(req.body.list)) ? req.body.list : req.body;
  const saved = settings.setSubscriptionChannels(Array.isArray(list) ? list : []);
  res.json({ code: 0, message: '已保存', data: saved });
}));

// ---------- 上报数据保留策略（保存后立即按新策略裁剪一次） ----------
router.post('/settings/retention', wrap(async (req, res) => {
  const { enabled, max_age_days, max_lines } = req.body || {};
  const saved = settings.setRetention({ enabled, max_age_days, max_lines });
  let applied = null;
  let applyError = '';
  try {
    applied = reports.applyRetention(saved, true);
    if (applied && applied.removed > 0) stats.invalidate();
  } catch (e) {
    applyError = e.message;
  }
  res.json({
    code: 0,
    message: '已保存',
    data: { ...saved, applied, apply_error: applyError, store: reports.retentionStats() }
  });
}));

// ---------- 应用设置（汇率覆盖 / ZCode 数据位置等） ----------
function zcodeStatus() {
  const p = zcode.resolvePaths();
  return {
    dir_setting: settings.getZcodeDir(),
    source: p.source, // env | settings | default
    db_path: p.dbPath,
    db_exists: fs.existsSync(p.dbPath),
    // 环境变量优先级高于界面设置：置灰提示用
    env_locked: p.source === 'env'
  };
}

router.get('/settings', wrap(async (req, res) => {
  const store = reports.retentionStats();
  res.json({
    code: 0,
    data: {
      fx_rate: settings.getFxRate(),
      fx_effective: modelradar.fxUsdCny(),
      zcode: zcodeStatus(),
      webhook: settings.getWebhook(),
      subscription_channels: settings.getSubscriptionChannels(),
      retention: settings.getRetention(),
      report: {
        // 上报接口信息（测试面板用；token 不回传，只告知是否启用鉴权）
        auth_enabled: !!process.env.TOKENVIEW_REPORT_TOKEN,
        records: store.records,
        bytes: store.bytes
      }
    }
  });
}));

router.post('/settings/fx', wrap(async (req, res) => {
  const { rate } = req.body || {};
  const saved = settings.setFxRate(rate === null || rate === undefined || rate === '' ? null : rate);
  // 快照含 USD 原始价时按新汇率本地重算；无快照/旧快照则等下次同步生效
  let reconverted = 0;
  let reconvertError = '';
  try {
    const r = modelradar.applyFxRate(modelradar.fxUsdCny());
    reconverted = r.count;
  } catch (e) {
    reconvertError = e.message;
  }
  stats.invalidate();
  res.json({ code: 0, message: '已保存', data: { ...saved, reconverted, reconvert_error: reconvertError } });
}));

/**
 * 设置 / 清除 ZCode 数据目录（.zcode 根目录）。
 * 防呆：仅接受"已存在目录且其下有 cli/db/db.sqlite"，或直接指向 db.sqlite 文件；
 * 环境变量 ZCODE_DB_PATH / ZCODE_CONFIG_PATH 优先级更高，此时界面设置不生效（返回提示）。
 */
router.post('/settings/zcode-dir', wrap(async (req, res) => {
  const { dir } = req.body || {};
  const raw = String(dir == null ? '' : dir).trim();
  if (!raw) {
    settings.setZcodeDir('');
    stats.invalidate();
    return res.json({ code: 0, message: '已恢复默认位置', data: zcodeStatus() });
  }
  if (process.env.ZCODE_DB_PATH || process.env.ZCODE_CONFIG_PATH) {
    return res.status(400).json({
      code: 400,
      message: '已通过环境变量 ZCODE_DB_PATH / ZCODE_CONFIG_PATH 指定路径，界面设置不生效；请先清除环境变量'
    });
  }
  let root = path.resolve(raw);
  let st = null;
  try { st = fs.statSync(root); } catch { /* 路径不存在 */ }
  if (st && st.isFile()) {
    // 直接选了 db.sqlite 文件：仅接受 .../cli/db/*.sqlite 结构，向上推导根目录
    const name = path.basename(root).toLowerCase();
    const parent = path.dirname(root);
    if ((name.endsWith('.sqlite') || name.endsWith('.db'))
      && path.basename(parent) === 'db' && path.basename(path.dirname(parent)) === 'cli') {
      root = path.dirname(path.dirname(parent));
      st = null;
      try { st = fs.statSync(root); } catch { /* 推导目录不存在 */ }
    } else {
      return res.status(400).json({ code: 400, message: '请选择 .zcode 根目录（其下应含 cli/db/db.sqlite），或直接选择 db.sqlite 文件' });
    }
  }
  if (!st || !st.isDirectory()) {
    return res.status(400).json({ code: 400, message: `路径不存在或不是目录：${root}` });
  }
  if (!fs.existsSync(path.join(root, 'cli', 'db', 'db.sqlite'))) {
    return res.status(400).json({ code: 400, message: `该目录下未找到 cli/db/db.sqlite（应为 .zcode 根目录）：${root}` });
  }
  settings.setZcodeDir(root);
  stats.invalidate();
  res.json({ code: 0, message: '已保存，ZCode 数据源已切换到新位置', data: zcodeStatus() });
}));

// ---------- 明细导出（CSV / JSON，按当前筛选，封顶 10 万行） ----------
router.get('/usage/export', wrap(async (req, res) => {
  const rows = await stats.getUsageExport({
    channel: req.query.channel || '',
    status: req.query.status,
    start: req.query.start || '',
    end: req.query.end || '',
    source: req.query.source || ''
  });
  const format = req.query.format === 'json' ? 'json' : 'csv';
  // 序列化到临时文件后经 res.download 附件下发，发送完成即清理
  const tmpPath = path.join(os.tmpdir(), `tokenview-usage-${crypto.randomBytes(6).toString('hex')}.${format}`);
  try {
    fs.writeFileSync(tmpPath, format === 'json' ? JSON.stringify(rows, null, 2) : usageExport.toCsv(rows));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await new Promise((resolve) => {
      res.download(tmpPath, `tokenview-usage-${stamp}.${format}`, (err) => {
        fs.unlink(tmpPath, () => { /* 忽略清理失败 */ });
        if (err && !res.headersSent) res.status(500).json({ code: 500, message: '导出失败' });
        resolve();
      });
    });
  } catch (e) {
    fs.unlink(tmpPath, () => { /* 忽略清理失败 */ });
    throw e;
  }
}));

// ---------- 数据备份 / 恢复 ----------
// 导出 bundle（JSON 下载，含上报数据 / 自定义价 / 预算 / 设置 / 在线价快照）
router.get('/backup/export', wrap(async (req, res) => {
  const bundle = backup.exportBundle();
  const tmpPath = path.join(os.tmpdir(), `tokenview-backup-${crypto.randomBytes(6).toString('hex')}.json`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(bundle, null, 2));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await new Promise((resolve) => {
      res.download(tmpPath, `tokenview-backup-${stamp}.json`, (err) => {
        fs.unlink(tmpPath, () => { /* 忽略清理失败 */ });
        if (err && !res.headersSent) res.status(500).json({ code: 500, message: '导出失败' });
        resolve();
      });
    });
  } catch (e) {
    fs.unlink(tmpPath, () => { /* 忽略清理失败 */ });
    throw e;
  }
}));

// 导入 bundle：独立大体积 JSON 中间件（reports.jsonl 可能远超应用级 1MB 限制）
router.post('/backup/import', (req, res) => {
  try {
    const r = backup.importBundle(req.body);
    res.json({ code: 0, message: `已导入 ${r.imported.length} 个文件`, data: r });
  } catch (e) {
    res.status(400).json({ code: 400, message: e.message });
  }
});

module.exports = router;
