/**
 * 构建安装包（TokenView-Setup.exe）
 * 流程：build:exe 产出 TokenView.exe → iscc 编译 tokenview.iss
 * 用法：npm run build:setup
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const INSTALLER = path.join(__dirname, '..', 'installer');

// 1. 构建单文件 exe
console.log('\n[1/2] 构建 TokenView.exe ...');
execSync('npm run build:exe', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

// 2. 定位 iscc
console.log('\n[2/2] 编译安装包 ...');
const candidates = [
  'C:/Program Files (x86)/Inno Setup 6/ISCC.exe',
  'C:/Program Files/Inno Setup 6/ISCC.exe',
  'C:/Users/Administrator/AppData/Local/Programs/Inno Setup 6/ISCC.exe'
];
const iscc = candidates.find((p) => fs.existsSync(p));
if (!iscc) {
  console.error('❌ 未找到 Inno Setup 6（iscc），请先 winget install JRSoftware.InnoSetup');
  process.exit(1);
}

execSync(`"${iscc}" "${path.join(INSTALLER, 'tokenview.iss')}"`, { stdio: 'inherit' });
const setup = path.join(DIST, 'TokenView-Setup.exe');
if (!fs.existsSync(setup)) {
  console.error('❌ 安装包生成失败');
  process.exit(1);
}
console.log(`\n✅ 安装包构建完成: ${setup} (${(fs.statSync(setup).size / 1024 / 1024).toFixed(1)} MB)`);
