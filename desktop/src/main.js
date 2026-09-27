/**
 * TokenView 桌面端主进程
 * 内嵌启动 Express 服务（随机空闲端口）+ 原生窗口加载，不再打开浏览器
 * 注：本文件构建时与 server.cjs、web/ 装配到同一目录，因此使用相对路径静态引用
 */
const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// 依赖库触发的 fs.Stats 弃用告警与运行无关，避免以 [ERROR] 噪音污染日志
process.noDeprecation = true;

let mainWindow = null;
let serverHandle = null;
let tray = null;
let closeToTrayEnabled = false; // 设置页开关（经 preload IPC 同步），默认关闭 = 关闭窗口即退出
let quitting = false;           // before-quit 置位：区分"用户点关闭"与"真正退出"
let trayNoticeShown = false;    // 首次最小化到托盘时提示一次

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

/** 托盘图标：装配后与本文件同级 tokenview.ico；缺失则不创建托盘 */
function resolveTrayIcon() {
  const p = path.join(__dirname, 'tokenview.ico');
  return fs.existsSync(p) ? p : null;
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = resolveTrayIcon();
  if (!iconPath || tray) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('TokenView · 多渠道 Token 消耗监控');
    tray.on('click', showMainWindow);
    tray.on('right-click', () => {
      const menu = Menu.buildFromTemplate([
        { label: '显示主窗口', click: showMainWindow },
        {
          label: '关闭时最小化到托盘',
          type: 'checkbox',
          checked: closeToTrayEnabled,
          click: (item) => { closeToTrayEnabled = item.checked; }
        },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ]);
      tray.popUpContextMenu(menu);
    });
  } catch (e) {
    console.warn('[TokenView] 托盘创建失败:', e.message);
    tray = null;
  }
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
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
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
  // 关闭窗口：若启用"最小化到托盘"则隐藏而不是退出（保持服务运行）
  mainWindow.on('close', (e) => {
    if (!closeToTrayEnabled || quitting || tray === null) return;
    e.preventDefault();
    mainWindow.hide();
    if (!trayNoticeShown) {
      trayNoticeShown = true;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'TokenView 仍在运行',
            body: '已最小化到系统托盘，双击托盘图标可重新打开；退出请从托盘菜单选择。'
          }).show();
        }
      } catch { /* 通知失败不影响 */ }
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(url);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // 第二次双击 exe：聚焦已开窗口，而不是再起一个服务
  app.on('second-instance', showMainWindow);

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
    createTray();
    createWindow(url);
  });

  // 设置页的"关闭时最小化到托盘"开关
  ipcMain.handle('tokenview:get-close-to-tray', () => closeToTrayEnabled);
  ipcMain.handle('tokenview:set-close-to-tray', (_e, v) => {
    closeToTrayEnabled = !!v;
    return closeToTrayEnabled;
  });

  // 设置页的"选择文件夹"（ZCode 数据位置等）；取消或窗口已销毁时返回空串
  ipcMain.handle('tokenview:pick-folder', async () => {
    if (!mainWindow) return '';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件夹',
      properties: ['openDirectory']
    });
    return result.canceled || !result.filePaths.length ? '' : result.filePaths[0];
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    if (serverHandle && serverHandle.server) {
      try { serverHandle.server.close(); } catch { /* 忽略 */ }
    }
    app.quit();
  });
}
