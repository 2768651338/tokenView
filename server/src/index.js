const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const config = require('./config');
const runtime = require('./runtime');
const { createApp } = require('./app');

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

  const { app, webDist } = createApp();

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
