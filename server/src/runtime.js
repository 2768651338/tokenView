/**
 * 单文件运行环境适配（SEA / 便携模式）
 * - SEA 检测与内嵌前端资源解包
 * - 数据目录解析（exe 同目录 data/ → %LOCALAPPDATA% 回退）
 * - 端口解析与冲突探测
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** 是否运行在 SEA（单文件 exe）中 */
function isSea() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

/**
 * 解包内嵌的前端资源到临时目录（幂等，按内容哈希缓存）
 * 资源格式：'TVWEB1'(6) + 文件数 u32 + [路径长 u16 路径 内容长 u32 内容]*
 * @returns {string|null} 解包后的目录；非 SEA 或无资源返回 null
 */
function unpackWebAssets() {
  if (!isSea()) return null;
  let asset;
  try {
    asset = require('node:sea').getAsset('web');
  } catch {
    return null;
  }
  // getAsset 可能返回 Buffer 或 ArrayBuffer，统一转 Buffer
  asset = Buffer.isBuffer(asset) ? asset : Buffer.from(asset);
  const magic = asset.toString('utf8', 0, 6);
  if (magic !== 'TVWEB1') return null;

  let off = 6;
  const count = asset.readUInt32LE(off); off += 4;
  const hash = crypto.createHash('sha1').update(asset).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), `tokenview-web-${hash}`);
  if (fs.existsSync(dir)) return dir; // 已解包过

  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const nameLen = asset.readUInt16LE(off); off += 2;
    const name = asset.toString('utf8', off, off + nameLen); off += nameLen;
    const size = asset.readUInt32LE(off); off += 4;
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, asset.subarray(off, off + size));
    off += size;
  }
  return dir;
}

/**
 * 数据目录解析：
 * 1. --data-dir 参数
 * 2. TOKENVIEW_DATA_DIR 环境变量
 * 3. SEA 模式：exe 同目录 data/（绿色便携）
 * 4. 回退 %LOCALAPPDATA%\TokenView\data
 * 开发模式（非 SEA）：server/data/
 */
function dataDir(argv = process.argv.slice(2)) {
  const idx = argv.indexOf('--data-dir');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  if (process.env.TOKENVIEW_DATA_DIR) return process.env.TOKENVIEW_DATA_DIR;
  if (isSea()) {
    const exeData = path.join(path.dirname(process.execPath), 'data');
    try {
      fs.mkdirSync(exeData, { recursive: true });
      fs.accessSync(exeData, fs.constants.W_OK);
      return exeData;
    } catch { /* exe 目录不可写，回退 */ }
  }
  const p = path.join(os.homedir(), 'AppData', 'Local', 'TokenView', 'data');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 解析端口：--port 参数 > TOKENVIEW_PORT > 默认 3000 */
function resolvePort(argv = process.argv.slice(2)) {
  const idx = argv.indexOf('--port');
  if (idx >= 0) {
    const v = Number(argv[idx + 1]);
    if (Number.isInteger(v) && v > 0 && v < 65536) return v;
  }
  const env = Number(process.env.TOKENVIEW_PORT);
  if (Number.isInteger(env) && env > 0 && env < 65536) return env;
  return 3000;
}

/** 是否自动打开浏览器（默认开，--no-browser 关闭） */
function shouldOpenBrowser(argv = process.argv.slice(2)) {
  return !argv.includes('--no-browser');
}

/**
 * 文件日志：stdout 不可用（隐藏窗口运行）或带 --log 参数 / TOKENVIEW_LOG=1 时，
 * 将 console 输出 tee 到 <data 上级>/logs/server-YYYY-MM-DD.log（保留 7 天）
 * @param {string} dataDirPath 数据目录（日志放其同级 logs/）
 * @param {string[]} argv 命令行参数（--log 启用）
 */
function setupFileLogging(dataDirPath, argv = []) {
  const needFileLog = !process.stdout || argv.includes('--log') || process.env.TOKENVIEW_LOG === '1';
  if (!needFileLog) return;
  const logsDir = path.join(path.dirname(dataDirPath), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const day = () => new Date().toISOString().slice(0, 10);
  const file = () => path.join(logsDir, `server-${day()}.log`);
  const write = (line) => {
    try { fs.appendFileSync(file(), line + '\n', 'utf8'); } catch { /* 忽略日志写入失败 */ }
  };
  // 清理 7 天前的日志
  try {
    const cutoff = Date.now() - 7 * 86400000;
    for (const f of fs.readdirSync(logsDir)) {
      const p = path.join(logsDir, f);
      if (f.startsWith('server-') && f.endsWith('.log') && fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
      }
    }
  } catch { /* 忽略 */ }

  const tee = (fn, level) => (...args) => {
    const line = `[${new Date().toLocaleString('zh-CN')}] [${level}] ` +
      args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    write(line);
    if (process.stdout) fn.apply(console, args);
  };
  console.log = tee(console.log, 'INFO');
  console.warn = tee(console.warn, 'WARN');
  console.error = tee(console.error, 'ERROR');
}

module.exports = { isSea, unpackWebAssets, dataDir, setupFileLogging, resolvePort, shouldOpenBrowser };
