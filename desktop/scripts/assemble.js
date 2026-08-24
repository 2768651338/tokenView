/**
 * 装配桌面应用目录（app/）—— 纯文件操作 + esbuild JS API，不调用外部进程
 * 外部命令（electron-packager / ISCC / electron）由 package.json 的 npm scripts 编排
 * 用法：npm run assemble（在 desktop/ 下）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP = path.join(__dirname, '..');
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const SERVER_ENTRY = path.join(ROOT, 'server', 'src', 'embed.js');
const APP = path.join(DESKTOP, 'app');
const ICON = path.join(DESKTOP, 'assets', 'tokenview.ico');

const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const APP_VERSION = pkg.version;

// 0. 前置检查（防呆：缺什么指什么）
if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.error('❌ 未找到前端构建产物 web/dist/index.html，请先执行: cd web && npm run build');
  process.exit(1);
}
if (!fs.existsSync(ICON)) {
  console.log('   图标缺失，生成中 ...');
  require('./make-icon.js');
}

// 1. 清空并重建 app/
fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// 2. 主进程入口 + 包描述
fs.copyFileSync(path.join(DESKTOP, 'src', 'main.js'), path.join(APP, 'main.js'));
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: 'tokenview',
  productName: 'TokenView',
  version: APP_VERSION,
  main: 'main.js'
}, null, 2));

// 3. 服务端 bundle（esbuild JS API）
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: [SERVER_ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20', // 与 Electron 内置 Node 版本对齐
  outfile: path.join(APP, 'server.cjs'),
  logLevel: 'warning'
});

// 4. 前端静态资源
fs.cpSync(WEB_DIST, path.join(APP, 'web'), { recursive: true });

console.log(`✅ app/ 装配完成: main.js + server.cjs + web/（服务端 bundle ${(fs.statSync(path.join(APP, 'server.cjs')).size / 1024 / 1024).toFixed(2)} MB）`);
