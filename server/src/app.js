/**
 * Express 应用工厂：API 路由 + 前端静态资源
 * 供 CLI 入口（index.js）与桌面端（desktop/）内嵌启动共用
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const runtime = require('./runtime');
const statsRouter = require('./routes/stats');
const usageRouter = require('./routes/usage');

/**
 * @param {{ webDist?: string|null }} [options] 显式指定前端构建产物目录（桌面端传入）
 * @returns {{ app: import('express').Express, webDist: string|null }}
 */
function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 路由挂载
  app.use('/api/usage', usageRouter);
  app.use('/api/stats', statsRouter);

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ code: 0, message: 'TokenView server OK', time: new Date().toISOString() });
  });

  // ---- 前端静态资源：显式指定 > SEA 内嵌解包 > 开发构建产物 ----
  let webDist = options.webDist || null;
  if (!webDist) {
    webDist = runtime.unpackWebAssets()
      || (fs.existsSync(path.join(__dirname, '..', '..', 'web', 'dist')) ? path.join(__dirname, '..', '..', 'web', 'dist') : null);
  }

  if (webDist) {
    app.use(express.static(webDist, { maxAge: '1h' }));
    // SPA fallback（非 /api 路径回 index.html）
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // 404
  app.use((req, res) => {
    res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}` });
  });

  // 统一错误兜底
  app.use((err, req, res, next) => {
    console.error('[server error]', err.message);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  });

  return { app, webDist };
}

module.exports = { createApp };
