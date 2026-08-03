const express = require('express');
const config = require('./config');
const statsRouter = require('./routes/stats');
const usageRouter = require('./routes/usage');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 路由挂载
app.use('/api/usage', usageRouter);
app.use('/api/stats', statsRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'TokenView server OK', time: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}` });
});

// 统一错误兜底
app.use((err, req, res, next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

app.listen(config.port, () => {
  console.log(`🚀 TokenView server 已启动: http://localhost:${config.port}`);
  console.log(`   数据源: ZCode SQLite + Claude Code JSONL（实时直读，无数据库）`);
});
