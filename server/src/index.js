const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const config = require('./config');
const runtime = require('./runtime');
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

// ---- 前端静态资源（单文件模式内嵌 / 开发构建产物） ----
const webDist = runtime.unpackWebAssets() // SEA 内嵌资源解包
  || (fs.existsSync(path.join(__dirname, '..', '..', 'web', 'dist')) ? path.join(__dirname, '..', '..', 'web', 'dist') : null);

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

// ---- 工具函数 ----
function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
}

/** 探测指定端口是否已运行 TokenView */
function isTokenViewRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1200 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).message === 'TokenView server OK');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ---- 启动流程 ----
const port = runtime.resolvePort();
const dataPath = runtime.dataDir();
const openBrowserFlag = runtime.shouldOpenBrowser();

runtime.setupFileLogging(dataPath, process.argv.slice(2));

(async () => {
  // 单实例保护：目标端口已有 TokenView 在跑 → 只打开浏览器并退出
  if (openBrowserFlag && (await isTokenViewRunning(port))) {
    console.log(`TokenView 已在运行 (${port})，打开浏览器后退出`);
    openBrowser(`http://localhost:${port}`);
    process.exit(0);
  }

  // 端口冲突自动递增探测
  function listen(p, maxTries = 11) {
    const server = app.listen(p, () => {
      const addr = `http://localhost:${p}`;
      console.log(`🚀 TokenView 已启动: ${addr}`);
      console.log(`   数据目录: ${dataPath}`);
      if (!webDist) console.log('   提示: 未找到前端资源（web/dist），仅提供 API 服务');
      if (openBrowserFlag) {
        openBrowser(addr);
        console.log(`   已打开浏览器 ${addr}（--no-browser 可禁用）`);
      }
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && p < config.port + maxTries) {
        console.warn(`   端口 ${p} 被占用，尝试 ${p + 1} ...`);
        server.close();
        listen(p + 1, maxTries);
      } else {
        console.error('❌ 启动失败:', err.message);
        process.exit(1);
      }
    });
  }
  listen(port);
})();
