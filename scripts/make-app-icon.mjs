// Generates the Forge3D app icon from the brand logo (assets/forge3d-logo.png):
// a macOS-style rounded tile with the F3 mark centered. Pure Node (no deps).
// Writes build/icon.png (1024, for electron-builder) and src/assets/forge3d-mark.png
// (256, for the in-app header). Run:  node scripts/make-app-icon.mjs
import zlib from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(root, 'assets', 'forge3d-logo.png');

// ---------- PNG decode (8-bit, non-interlaced, RGB/RGBA) ----------
function decodePNG(file) {
  const b = readFileSync(file);
  let p = 8, w, h, bitDepth, colorType; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; if (data[12] !== 0) throw new Error('interlaced'); }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('need 8-bit png');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : (() => { throw new Error('colorType ' + colorType); })();
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride); let cur = Buffer.alloc(stride), q = 0;
  const paeth = (a, bb, c) => { const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    for (let i = 0; i < stride; i++) {
      const x = raw[q++], a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v; if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + bb; else if (f === 3) v = x + ((a + bb) >> 1); else if (f === 4) v = x + paeth(a, bb, c); else throw new Error('filter ' + f);
      cur[i] = v & 0xff;
    }
    for (let xp = 0; xp < w; xp++) { const si = xp * ch, di = (y * w + xp) * 4; out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = ch === 4 ? cur[si + 3] : 255; }
    cur.copy(prev); cur = Buffer.alloc(stride);
  }
  return { w, h, data: out };
}

// ---------- find the F3 mark (top content block, above the wordmark) ----------
function markBBox({ w, h, data }) {
  const lum = (x, y) => { const i = (y * w + x) * 4; return Math.max(data[i], data[i + 1], data[i + 2]); };
  const BG = 45, minRow = w * 0.01, rc = new Array(h).fill(0);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (lum(x, y) > BG) c++; rc[y] = c; }
  let y0 = 0; while (y0 < h && rc[y0] < minRow) y0++;
  let y1 = y0; while (y1 < h && rc[y1] >= minRow) y1++;
  let yEnd = y1;
  for (let g = y1; g < h; g++) { if (rc[g] >= minRow) { if (g - yEnd < h * 0.03) { let k = g; while (k < h && rc[k] >= minRow) k++; yEnd = k; } else break; } }
  y1 = yEnd; let x0 = w, x1 = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (lum(x, y) > BG) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { x0, y0, x1: x1 + 1, y1 };
}

// ---------- render a `size` macOS-style icon: rounded tile + mark ----------
function render(src, box, size) {
  const { w } = src;
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, side = Math.max(bw, bh);
  const crop = side * 1.16;                          // square source crop around the mark
  const cx0 = box.x0 + bw / 2 - crop / 2, cy0 = box.y0 + bh / 2 - crop / 2;
  const bg = (() => { const i = (8 * w + 8) * 4; return [src.data[i], src.data[i + 1], src.data[i + 2]]; })(); // logo corner color
  const out = Buffer.alloc(size * size * 4);
  const R = Math.round(size * 0.225);                 // macOS-ish corner radius
  const inset = Math.round(size * 0.085);             // tile margin inside the canvas
  const tile0 = inset, tile1 = size - inset, tspan = tile1 - tile0;
  const inRound = (x, y) => { const cx = Math.min(Math.max(x, tile0 + R), tile1 - R), cy = Math.min(Math.max(y, tile0 + R), tile1 - R); return x >= tile0 && x <= tile1 && y >= tile0 && y <= tile1 && (x - cx) ** 2 + (y - cy) ** 2 <= R * R; };
  const sample = (fx, fy) => {
    if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= src.h - 1) return bg;
    const x = Math.floor(fx), y = Math.floor(fy), dx = fx - x, dy = fy - y;
    const px = (xx, yy) => { const i = (yy * w + xx) * 4; return [src.data[i], src.data[i + 1], src.data[i + 2]]; };
    const a = px(x, y), b = px(x + 1, y), c = px(x, y + 1), d = px(x + 1, y + 1);
    return [0, 1, 2].map((k) => a[k] * (1 - dx) * (1 - dy) + b[k] * dx * (1 - dy) + c[k] * (1 - dx) * dy + d[k] * dx * dy);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const di = (y * size + x) * 4;
    if (!inRound(x, y)) { out[di + 3] = 0; continue; }            // transparent outside the squircle
    const fx = cx0 + ((x - tile0) / tspan) * crop, fy = cy0 + ((y - tile0) / tspan) * crop;
    const [r, g, bl] = sample(fx, fy);
    out[di] = r; out[di + 1] = g; out[di + 2] = bl; out[di + 3] = 255;
  }
  return out;
}

// ---------- PNG encode (8-bit RGBA) ----------
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, cr]); }
function encodePNG(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const img = decodePNG(SRC);
const box = markBBox(img);
mkdirSync(path.join(root, 'build'), { recursive: true });
mkdirSync(path.join(root, 'src', 'assets'), { recursive: true });
writeFileSync(path.join(root, 'build', 'icon.png'), encodePNG(render(img, box, 1024), 1024));
writeFileSync(path.join(root, 'src', 'assets', 'forge3d-mark.png'), encodePNG(render(img, box, 256), 256));
console.log('wrote build/icon.png (1024) and src/assets/forge3d-mark.png (256) from mark bbox', JSON.stringify(box));
