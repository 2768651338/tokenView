/**
 * 构建单文件 Windows 可执行程序（TokenView.exe）
 * 流程：前端构建 → 资源打包 → esbuild 单文件 bundle → Node SEA → postject 注入
 * 用法：npm run build:exe
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const WEB = path.join(ROOT, 'web');
const DIST = path.join(SERVER, 'dist');
const WEB_DIST = path.join(WEB, 'dist');
const ASSETS = path.join(DIST, 'assets.bin');
const BUNDLE = path.join(DIST, 'server.cjs');
const SEA_CONFIG = path.join(DIST, 'sea-config.json');
const SEA_BLOB = path.join(DIST, 'sea-prep.blob');
const EXE = path.join(DIST, 'TokenView.exe');

const step = (msg) => console.log(`\n[${++step.n}/${step.total}] ${msg}`);
step.n = 0;
step.total = 6;

// 1. 构建前端
step('构建前端 (npm run build in web/)');
spawnSync('npm', ['run', 'build'], { cwd: WEB, stdio: 'inherit', shell: true });
if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.error('❌ 前端构建失败：未生成 index.html');
  process.exit(1);
}

// 2. 打包前端资源（自定义格式：'TVWEB1' + 文件数 + [路径长 路径 内容长 内容]）
step('打包前端资源 → assets.bin');
function collect(dir, base = '', result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, rel, result);
    else result.push({ name: rel, data: fs.readFileSync(full) });
  }
  return result;
}
const files = collect(WEB_DIST);
const chunks = [Buffer.from('TVWEB1'), Buffer.alloc(4)];
chunks[1].writeUInt32LE(files.length, 0);
for (const f of files) {
  const nameBuf = Buffer.from(f.name, 'utf8');
  const head = Buffer.alloc(2 + nameBuf.length + 4);
  head.writeUInt16LE(nameBuf.length, 0);
  nameBuf.copy(head, 2);
  head.writeUInt32LE(f.data.length, 2 + nameBuf.length);
  chunks.push(head, f.data);
}
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(ASSETS, Buffer.concat(chunks));
console.log(`   ${files.length} 个文件，${(fs.statSync(ASSETS).size / 1024 / 1024).toFixed(2)} MB`);

// 3. esbuild 打包后端为单文件
step('esbuild bundle 后端 → server.cjs');
const esbuild = require('esbuild');
esbuild.buildSync({
  entryPoints: [path.join(SERVER, 'src', 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: BUNDLE,
  logLevel: 'warning'
});
console.log(`   ${(fs.statSync(BUNDLE).size / 1024 / 1024).toFixed(2)} MB`);

// 4. SEA 配置并生成骨架
step('生成 SEA 骨架');
const seaConfig = {
  main: 'server.cjs',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets: { web: 'assets.bin' }
};
fs.writeFileSync(SEA_CONFIG, JSON.stringify(seaConfig, null, 2));
execSync('node --experimental-sea-config sea-config.json', { cwd: DIST, stdio: 'inherit' });

// 5. 拷贝 node.exe 为 TokenView.exe
step('复制 Node 运行时 → TokenView.exe');
fs.copyFileSync(process.execPath, EXE);
console.log(`   ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);

// 6. postject 注入 blob
step('postject 注入 SEA blob');
const sentinel = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
try {
  execSync(`npx --yes postject "${EXE}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse ${sentinel}`,
    { cwd: DIST, stdio: 'inherit' });
} catch (e) {
  console.error('❌ postject 注入失败：', e.message);
  process.exit(1);
}

console.log(`\n✅ 构建完成: ${EXE} (${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB)`);
console.log('   运行：双击 TokenView.exe（或命令行加 --port 指定端口 / --no-browser 禁用自动打开浏览器）');
