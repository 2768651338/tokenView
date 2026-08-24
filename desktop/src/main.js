/**
 * TokenView 桌面端主进程
 * 内嵌启动 Express 服务（随机空闲端口）+ 原生窗口加载，不再打开浏览器
 * 注：本文件构建时与 server.cjs、web/ 装配到同一目录，因此使用相对路径静态引用
 */
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 依赖库触发的 fs.Stats 弃用告警与运行无关，避免以 [ERROR] 噪音污染日志
process.noDeprecation = true;

let mainWindow = null;
let serverHandle = null;

/** 解析端口：--port 参数 / TOKENVIEW_PORT 环境变量；缺省 0 = 系统分配随机空闲端口 */
function resolvePort() {
  const argv = process.argv.slice(1);
  const i = argv.indexOf('--port');
  if (i >= 0 && Number.isInteger(Number(argv[i + 1])) && Number(argv[i + 1]) > 0) return Number(argv[i + 1]);
  const env = Number(process.env.TOKENVIEW_PORT);
  if (Number.isInteger(env) && env > 0 && env < 65536) return env;
  return 0;
}

/** 前端资源目录：打包后与本文件同级的 web/；开发态回退 web/dist */
function resolveWebDist() {
  const packaged = path.join(__dirname, 'web');
  if (fs.existsSync(path.join(packaged, 'index.html'))) return packaged;
  const devDist = path.join(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(path.join(devDist, 'index.html'))) return devDist;
  return null;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0d1117', // 与前端 --bg-0 一致，避免启动白闪
    titleBarStyle: 'hidden', // 去掉白色系统标题栏，窗口与应用内容融为一体
    titleBarOverlay: {
      // 覆盖层配色贴合 .topbar 背景（#0d1117）
      color: '#0d1117',
      symbolColor: '#9198a1',
      height: 44
    },
    autoHideMenuBar: true,
    title: 'TokenView',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // 仅放行 http(s) 外链到系统浏览器；窗口内只承载本应用页面
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(parsed.toString());
      }
    } catch { /* 非法 URL 直接忽略 */ }
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(url);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 第二次双击 exe：聚焦已开窗口，而不是再起一个服务
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  Menu.setApplicationMenu(null);

  app.whenReady().then(async () => {
    let url;
    try {
      const { startServer } = require('./server.cjs');
      serverHandle = await startServer({
        port: resolvePort(),
        webDist: resolveWebDist(),
        fileLog: true // 打包后无控制台，日志落 %LOCALAPPDATA%\TokenView\logs
      });
      console.log(`[TokenView] 服务已启动 http://127.0.0.1:${serverHandle.port}`);
      url = `http://127.0.0.1:${serverHandle.port}`;
    } catch (err) {
      dialog.showErrorBox('TokenView 启动失败', String((err && err.stack) || err));
      app.quit();
      return;
    }
    createWindow(url);
  });

  app.on('window-all-closed', () => {
    if (serverHandle && serverHandle.server) {
      try { serverHandle.server.close(); } catch { /* 忽略 */ }
    }
    app.quit();
  });
}
