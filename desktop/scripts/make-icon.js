/**
 * 生成 TokenView 应用图标（assets/tokenview.ico）
 * 纯 Node 实现：像素绘制 → PNG 编码 → 多尺寸 ICO 打包，无第三方依赖
 * 图案：深蓝圆角底 + 三根递增柱状图（仪表盘意象）
 * 用法：node scripts/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
/** rgba: Uint8Array(w*h*4) */
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 绘制（256 坐标空间） ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const BG_TOP = hex('#16233f');
const BG_BOTTOM = hex('#070b14');
const BAR_COLORS = ['#2dd4bf', '#60a5fa', '#a78bfa'].map(hex);
// 圆角矩形有向距离（负值在内部）
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return Math.hypot(px - cx, py - cy) - r;
}
// 柱状条几何：baseline 上三根递增圆顶柱
const BASELINE = 196, BW = 34;
const BARS = [
  { x0: 63, x1: 97, top: 132 },
  { x0: 111, x1: 145, top: 100 },
  { x0: 159, x1: 193, top: 68 }
].map((b, i) => ({ ...b, color: BAR_COLORS[i], r: BW / 2 }));
/** 单点采样：返回 [r,g,b,a] */
function sample(px, py) {
  const sdBg = sdRoundRect(px, py, 12, 12, 244, 244, 56);
  if (sdBg > 0.5) return [0, 0, 0, 0];
  const t = Math.min(Math.max(py / 256, 0), 1);
  let c = BG_TOP.map((v, i) => v + (BG_BOTTOM[i] - v) * t);
  for (const b of BARS) {
    if (sdRoundRect(px, py, b.x0, b.top, b.x1, BASELINE, b.r) <= 0) { c = b.color; break; }
  }
  return [...c, 255];
}
/** 渲染任意尺寸（3x 超采样抗锯齿），返回 RGBA 像素 */
function renderRGBA(size) {
  const SS = 3, px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, bl = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample(((x + (sx + 0.5) / SS) / size) * 256, ((y + (sy + 0.5) / SS) / size) * 256);
          r += s[0]; g += s[1]; bl += s[2]; a += s[3];
        }
      }
      const n = SS * SS, off = (y * size + x) * 4;
      px[off] = Math.round(r / n); px[off + 1] = Math.round(g / n);
      px[off + 2] = Math.round(bl / n); px[off + 3] = Math.round(a / n);
    }
  }
  return px;
}
/** 渲染为 PNG Buffer */
function render(size) {
  return encodePNG(size, size, renderRGBA(size));
}

// ---------- ICO 打包（PNG 压缩条目） ----------
function buildICO(sizes) {
  const pngs = sizes.map(render);
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  pngs.forEach((png, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0);
    e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

const OUT = path.join(__dirname, '..', 'assets', 'tokenview.ico');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buildICO([256, 128, 64, 48, 32, 24, 16]));
console.log(`✅ 图标已生成: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);

module.exports = { renderRGBA };
