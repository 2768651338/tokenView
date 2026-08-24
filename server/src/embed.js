/**
 * 嵌入式启动入口（桌面端 Electron 主进程使用）
 * 与 CLI（index.js）共用 createApp，但不解析浏览器/单实例逻辑 —— 窗口由外壳负责
 */
const runtime = require('./runtime');
const { createApp } = require('./app');

/**
 * 启动 HTTP 服务
 * @param {{ port?: number, host?: string, webDist?: string|null, dataDir?: string, fileLog?: boolean }} [options]
 *   - port 缺省为 0（系统分配随机空闲端口，天然免冲突）
 *   - 显式端口被占用时自动回退随机端口
 * @returns {Promise<{ server: import('http').Server, port: number }>}
 */
function startServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const requested = Number.isInteger(options.port) && options.port > 0 && options.port < 65536 ? options.port : 0;
  const dataPath = options.dataDir || runtime.dataDir();
  if (options.fileLog) runtime.setupFileLogging(dataPath, ['--log']);

  return new Promise((resolve, reject) => {
    const { app } = createApp({ webDist: options.webDist });
    const server = app.listen(requested, host, () => {
      resolve({ server, port: server.address().port });
    });
    server.on('error', (err) => {
      // 防呆：显式端口被占用时回退随机端口，而不是启动失败
      if (err.code === 'EADDRINUSE' && requested !== 0) {
        const retry = app.listen(0, host, () => {
          console.warn(`端口 ${requested} 被占用，已改用随机端口 ${retry.address().port}`);
          resolve({ server: retry, port: retry.address().port });
        });
        retry.on('error', reject);
      } else {
        reject(err);
      }
    });
  });
}

module.exports = { startServer };
