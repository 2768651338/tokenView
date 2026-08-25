/**
 * 生成安装器品牌素材：assets/installer-logo.bmp（96x96 24 位 BMP）
 * 应用图标合成到侧栏底色 #161b22 上（BMP 不支持透明，直接混色避免白边）
 * 由 assemble.js 在装配时自动调用
 */
const fs = require('fs');
const path = require('path');
const { renderRGBA } = require('./make-icon');

const SIZE = 96;
const BG = [0x22, 0x1b, 0x16]; // #161b22 (RGB)

const rgba = renderRGBA(SIZE);
// 24 位 BMP：BGR、行自底向上、行宽需 4 字节对齐（96*3=288 已对齐）
const rowSize = SIZE * 3;
const dataSize = rowSize * SIZE;
const buf = Buffer.alloc(54 + dataSize);

buf.write('BM', 0, 'ascii');
buf.writeUInt32LE(54 + dataSize, 2);
buf.writeUInt32LE(54, 10);          // 像素数据偏移
buf.writeUInt32LE(40, 14);          // DIB 头大小
buf.writeInt32LE(SIZE, 18);
buf.writeInt32LE(SIZE, 22);
buf.writeUInt16LE(1, 26);           // planes
buf.writeUInt16LE(24, 28);          // bpp
buf.writeUInt32LE(dataSize, 34);

for (let y = 0; y < SIZE; y++) {
  const bmpRow = 54 + (SIZE - 1 - y) * rowSize; // 自底向上
  for (let x = 0; x < SIZE; x++) {
    const o = (y * SIZE + x) * 4;
    const a = rgba[o + 3] / 255;
    const r = Math.round(rgba[o] * a + BG[0] * (1 - a));
    const g = Math.round(rgba[o + 1] * a + BG[1] * (1 - a));
    const b = Math.round(rgba[o + 2] * a + BG[2] * (1 - a));
    buf[bmpRow + x * 3] = b;
    buf[bmpRow + x * 3 + 1] = g;
    buf[bmpRow + x * 3 + 2] = r;
  }
}

const OUT = path.join(__dirname, '..', 'assets', 'installer-logo.bmp');
fs.writeFileSync(OUT, buf);
console.log(`✅ 安装器品牌图已生成: ${OUT}`);
