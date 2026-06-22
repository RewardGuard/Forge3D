// Generates the MCP bundle icon (icon.png, 512x512) from the brand logo
// (assets/forge3d-logo.png). It crops the F3 mark out of the full logo — the
// "FORGE3D" wordmark goes illegible at menu size, so the mark alone reads best,
// the way Gmail/Drive use just their marks. Pure Node (no ImageMagick). Run:
//   node make-icon.mjs   (or: npm run icon)
import zlib from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../../assets/forge3d-logo.png', import.meta.url); // canonical brand logo at repo root
const OUT = new URL('./icon.png', import.meta.url);
const OUTSIZE = 512;

// ---------- minimal PNG decoder (8-bit, non-interlaced, RGB/RGBA) ----------
function decodePNG(file) {
  const b = readFileSync(file);
  let p = 8, w, h, bitDepth, colorType;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; if (data[12] !== 0) throw new Error('interlaced PNG not supported'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('expected 8-bit PNG, got ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : (() => { throw new Error('unsupported colorType ' + colorType); })();
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels, out = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride), q = 0;
  const paeth = (a, bb, c) => { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    for (let i = 0; i < stride; i++) {
      const x = raw[q++], a = i >= channels ? cur[i - channels] : 0, bb = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + bb; else if (f === 3) v = x + ((a + bb) >> 1); else if (f === 4) v = x + paeth(a, bb, c); else throw new Error('filter ' + f);
      cur[i] = v & 0xff;
    }
    for (let xp = 0; xp < w; xp++) { const si = xp * channels, di = (y * w + xp) * 4; out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = channels === 4 ? cur[si + 3] : 255; }
    cur.copy(prev); cur = Buffer.alloc(stride);
  }
  return { w, h, data: out };
}

// ---------- find the mark: the top content block, above the wordmark ----------
function markBBox({ w, h, data }) {
  const lum = (x, y) => { const i = (y * w + x) * 4; return Math.max(data[i], data[i + 1], data[i + 2]); };
  const BG = 45, minRow = w * 0.01, rowCount = new Array(h).fill(0);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (lum(x, y) > BG) c++; rowCount[y] = c; }
  let y0 = 0; while (y0 < h && rowCount[y0] < minRow) y0++;
  let y1 = y0; while (y1 < h && rowCount[y1] >= minRow) y1++;
  let yEnd = y1;
  for (let g = y1; g < h; g++) {
    if (rowCount[g] >= minRow) {
      if (g - yEnd < h * 0.03) { let k = g; while (k < h && rowCount[k] >= minRow) k++; yEnd = k; } else break; // real gap = wordmark, stop
    }
  }
  y1 = yEnd;
  let x0 = w, x1 = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (lum(x, y) > BG) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { x0, y0, x1: x1 + 1, y1 };
}

// ---------- bilinear resize the squared crop into OUTSIZE ----------
function render(src, box) {
  const { w } = src, bw = box.x1 - box.x0, bh = box.y1 - box.y0, side = Math.max(bw, bh), pad = Math.round(side * 0.14), sq = side + pad * 2;
  const cx0 = box.x0 + bw / 2 - sq / 2, cy0 = box.y0 + bh / 2 - sq / 2, out = Buffer.alloc(OUTSIZE * OUTSIZE * 4);
  const sample = (fx, fy) => {
    if (fx < 0 || fy < 0 || fx >= src.w - 1 || fy >= src.h - 1) return [13, 13, 16, 255];
    const x = Math.floor(fx), y = Math.floor(fy), dx = fx - x, dy = fy - y;
    const px = (xx, yy) => { const i = (yy * w + xx) * 4; return [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]; };
    const a = px(x, y), b = px(x + 1, y), c = px(x, y + 1), d = px(x + 1, y + 1);
    return [0, 1, 2, 3].map((k) => a[k] * (1 - dx) * (1 - dy) + b[k] * dx * (1 - dy) + c[k] * (1 - dx) * dy + d[k] * dx * dy);
  };
  for (let y = 0; y < OUTSIZE; y++) for (let x = 0; x < OUTSIZE; x++) {
    const fx = cx0 + (x / OUTSIZE) * sq, fy = cy0 + (y / OUTSIZE) * sq, [r, g, bl, al] = sample(fx, fy), di = (y * OUTSIZE + x) * 4;
    out[di] = r; out[di + 1] = g; out[di + 2] = bl; out[di + 3] = al;
  }
  return out;
}

// ---------- PNG encoder (8-bit RGBA) ----------
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c; }
function chunk(type, d) { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); }
function encodePNG(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const img = decodePNG(SRC);
const box = markBBox(img);
console.log(`logo ${img.w}x${img.h} | mark bbox ${JSON.stringify(box)} (${box.x1 - box.x0}x${box.y1 - box.y0})`);
writeFileSync(OUT, encodePNG(render(img, box), OUTSIZE));
console.log('wrote icon.png (512x512) from the F3 mark');
