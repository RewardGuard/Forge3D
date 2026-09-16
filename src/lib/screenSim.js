// Display simulation — what a screen part would show if the firmware ran.
//
// WHAT THIS IS
// A framebuffer plus an interpreter for the display calls found in the
// firmware. It recognises the two APIs almost every hobby and product display
// uses — Adafruit_GFX (SSD1306 / ILI9341 / ST7735 / e-paper / TFT_eSPI share
// it) and LiquidCrystal (character LCDs) — and draws them, in source order,
// with a real 5×7 bitmap font. A 128×64 OLED here renders the way a 128×64
// OLED renders.
//
// WHAT THIS IS NOT
// It is not an emulator. It does not execute control flow: a loop that draws
// 20 bars draws them once; an `if (temp > 30)` branch is taken as written;
// a value printed from a variable shows the live sim reading when one exists
// and the variable's name in brackets when it does not. The Inspector and the
// viewport label the result "display simulation" for exactly that reason.

// ── 5×7 bitmap font (the classic GFX glyph set, column-major, LSB = top) ──
const FONT = {
  ' ': [0x00,0x00,0x00,0x00,0x00], '!': [0x00,0x00,0x5F,0x00,0x00], '"': [0x00,0x07,0x00,0x07,0x00],
  '#': [0x14,0x7F,0x14,0x7F,0x14], '$': [0x24,0x2A,0x7F,0x2A,0x12], '%': [0x23,0x13,0x08,0x64,0x62],
  '&': [0x36,0x49,0x55,0x22,0x50], "'": [0x00,0x05,0x03,0x00,0x00], '(': [0x00,0x1C,0x22,0x41,0x00],
  ')': [0x00,0x41,0x22,0x1C,0x00], '*': [0x08,0x2A,0x1C,0x2A,0x08], '+': [0x08,0x08,0x3E,0x08,0x08],
  ',': [0x00,0x50,0x30,0x00,0x00], '-': [0x08,0x08,0x08,0x08,0x08], '.': [0x00,0x60,0x60,0x00,0x00],
  '/': [0x20,0x10,0x08,0x04,0x02], '0': [0x3E,0x51,0x49,0x45,0x3E], '1': [0x00,0x42,0x7F,0x40,0x00],
  '2': [0x42,0x61,0x51,0x49,0x46], '3': [0x21,0x41,0x45,0x4B,0x31], '4': [0x18,0x14,0x12,0x7F,0x10],
  '5': [0x27,0x45,0x45,0x45,0x39], '6': [0x3C,0x4A,0x49,0x49,0x30], '7': [0x01,0x71,0x09,0x05,0x03],
  '8': [0x36,0x49,0x49,0x49,0x36], '9': [0x06,0x49,0x49,0x29,0x1E], ':': [0x00,0x36,0x36,0x00,0x00],
  ';': [0x00,0x56,0x36,0x00,0x00], '<': [0x00,0x08,0x14,0x22,0x41], '=': [0x14,0x14,0x14,0x14,0x14],
  '>': [0x41,0x22,0x14,0x08,0x00], '?': [0x02,0x01,0x51,0x09,0x06], '@': [0x32,0x49,0x79,0x41,0x3E],
  'A': [0x7E,0x11,0x11,0x11,0x7E], 'B': [0x7F,0x49,0x49,0x49,0x36], 'C': [0x3E,0x41,0x41,0x41,0x22],
  'D': [0x7F,0x41,0x41,0x22,0x1C], 'E': [0x7F,0x49,0x49,0x49,0x41], 'F': [0x7F,0x09,0x09,0x01,0x01],
  'G': [0x3E,0x41,0x41,0x51,0x32], 'H': [0x7F,0x08,0x08,0x08,0x7F], 'I': [0x00,0x41,0x7F,0x41,0x00],
  'J': [0x20,0x40,0x41,0x3F,0x01], 'K': [0x7F,0x08,0x14,0x22,0x41], 'L': [0x7F,0x40,0x40,0x40,0x40],
  'M': [0x7F,0x02,0x04,0x02,0x7F], 'N': [0x7F,0x04,0x08,0x10,0x7F], 'O': [0x3E,0x41,0x41,0x41,0x3E],
  'P': [0x7F,0x09,0x09,0x09,0x06], 'Q': [0x3E,0x41,0x51,0x21,0x5E], 'R': [0x7F,0x09,0x19,0x29,0x46],
  'S': [0x46,0x49,0x49,0x49,0x31], 'T': [0x01,0x01,0x7F,0x01,0x01], 'U': [0x3F,0x40,0x40,0x40,0x3F],
  'V': [0x1F,0x20,0x40,0x20,0x1F], 'W': [0x7F,0x20,0x18,0x20,0x7F], 'X': [0x63,0x14,0x08,0x14,0x63],
  'Y': [0x03,0x04,0x78,0x04,0x03], 'Z': [0x61,0x51,0x49,0x45,0x43], '[': [0x00,0x00,0x7F,0x41,0x41],
  ']': [0x41,0x41,0x7F,0x00,0x00], '_': [0x40,0x40,0x40,0x40,0x40],
  'a': [0x20,0x54,0x54,0x54,0x78], 'b': [0x7F,0x48,0x44,0x44,0x38], 'c': [0x38,0x44,0x44,0x44,0x20],
  'd': [0x38,0x44,0x44,0x48,0x7F], 'e': [0x38,0x54,0x54,0x54,0x18], 'f': [0x08,0x7E,0x09,0x01,0x02],
  'g': [0x08,0x14,0x54,0x54,0x3C], 'h': [0x7F,0x08,0x04,0x04,0x78], 'i': [0x00,0x44,0x7D,0x40,0x00],
  'j': [0x20,0x40,0x44,0x3D,0x00], 'k': [0x00,0x7F,0x10,0x28,0x44], 'l': [0x00,0x41,0x7F,0x40,0x00],
  'm': [0x7C,0x04,0x18,0x04,0x78], 'n': [0x7C,0x08,0x04,0x04,0x78], 'o': [0x38,0x44,0x44,0x44,0x38],
  'p': [0x7C,0x14,0x14,0x14,0x08], 'q': [0x08,0x14,0x14,0x18,0x7C], 'r': [0x7C,0x08,0x04,0x04,0x08],
  's': [0x48,0x54,0x54,0x54,0x20], 't': [0x04,0x3F,0x44,0x40,0x20], 'u': [0x3C,0x40,0x40,0x20,0x7C],
  'v': [0x1C,0x20,0x40,0x20,0x1C], 'w': [0x3C,0x40,0x30,0x40,0x3C], 'x': [0x44,0x28,0x10,0x28,0x44],
  'y': [0x0C,0x50,0x50,0x50,0x3C], 'z': [0x44,0x64,0x54,0x4C,0x44], '°': [0x00,0x06,0x09,0x09,0x06],
};
const GLYPH_W = 6; // 5 px + 1 px gap
const GLYPH_H = 8;

// ── Screen descriptors per part ───────────────────────────────────────────
// mode: 'gfx' (pixel), 'char' (character cells), 'seg' (7-segment digits)
export const SCREENS = {
  'oled-ssd1306':  { mode: 'gfx',  w: 128,  h: 64,   color: false, api: 'Adafruit_GFX', obj: ['display', 'oled'] },
  'tft-28-spi':    { mode: 'gfx',  w: 240,  h: 320,  color: true,  api: 'Adafruit_GFX', obj: ['tft', 'display', 'screen'] },
  'eink-29':       { mode: 'gfx',  w: 296,  h: 128,  color: false, api: 'Adafruit_GFX', obj: ['display', 'epd'] },
  'dsi-5in-touch': { mode: 'gfx',  w: 720,  h: 1280, color: true,  api: 'Adafruit_GFX', obj: ['display', 'screen', 'lcd', 'tft'] },
  'dsi-6in-touch': { mode: 'gfx',  w: 1080, h: 2340, color: true,  api: 'Adafruit_GFX', obj: ['display', 'screen', 'lcd', 'tft'] },
  'lcd1602':       { mode: 'char', cols: 16, rows: 2, api: 'LiquidCrystal', obj: ['lcd'] },
  'seven-seg':     { mode: 'seg',  digits: 4, api: 'segment', obj: ['display', 'seg', 'sevseg'] },
  'max7219':       { mode: 'gfx',  w: 8,    h: 8,    color: false, api: 'LedControl', obj: ['lc', 'matrix', 'display'] },
};

export function screenSpec(partId) { return SCREENS[partId] || null; }
export function hasScreen(partId) { return Boolean(SCREENS[partId]); }

// ── Framebuffer ───────────────────────────────────────────────────────────
// RGBA bytes. Mono displays still use RGBA so one code path feeds a texture;
// they simply only ever hold black and one 'lit' colour.
export class Framebuffer {
  constructor(w, h, { color = true, lit = [255, 255, 255], bg = [0, 0, 0] } = {}) {
    this.w = w; this.h = h; this.color = color;
    this.lit = lit; this.bg = bg;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.fill(bg);
    this.cursor = [0, 0]; this.textSize = 1; this.textColor = lit; this.wrap = true;
    this.ops = 0;
  }
  fill(rgb) {
    const [r, g, b] = rgb;
    for (let i = 0; i < this.data.length; i += 4) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255; }
    this.ops++;
  }
  px(x, y, rgb) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const [r, g, b] = this.color ? rgb : (rgb === this.bg || (rgb[0] | rgb[1] | rgb[2]) === 0 ? this.bg : this.lit);
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
  }
  get(x, y) {
    const i = ((y | 0) * this.w + (x | 0)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  litCount() {
    let n = 0;
    for (let i = 0; i < this.data.length; i += 4) if (this.data[i] | this.data[i + 1] | this.data[i + 2]) n++;
    return n;
  }
  line(x0, y0, x1, y1, rgb) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 100000; guard++) {
      this.px(x0, y0, rgb);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    this.ops++;
  }
  rect(x, y, w, h, rgb, filled) {
    if (filled) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, rgb); }
    else { this.line(x, y, x + w - 1, y, rgb); this.line(x, y + h - 1, x + w - 1, y + h - 1, rgb); this.line(x, y, x, y + h - 1, rgb); this.line(x + w - 1, y, x + w - 1, y + h - 1, rgb); }
    this.ops++;
  }
  circle(cx, cy, r, rgb, filled) {
    r |= 0;
    if (filled) {
      for (let y = -r; y <= r; y++) { const half = Math.floor(Math.sqrt(r * r - y * y)); for (let x = -half; x <= half; x++) this.px(cx + x, cy + y, rgb); }
    } else {
      let x = r, y = 0, err = 1 - r;
      while (x >= y) {
        for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.px(cx + px, cy + py, rgb);
        y++; if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    }
    this.ops++;
  }
  glyph(ch, x, y, rgb, size) {
    const g = FONT[ch] || FONT['?'];
    for (let col = 0; col < 5; col++) {
      const bits = g[col];
      for (let row = 0; row < 7; row++) {
        if (bits & (1 << row)) {
          if (size === 1) this.px(x + col, y + row, rgb);
          else this.rect(x + col * size, y + row * size, size, size, rgb, true);
        }
      }
    }
  }
  print(text, { newline = false } = {}) {
    const s = String(text ?? '');
    const size = this.textSize;
    for (const ch of s) {
      if (ch === '\n') { this.cursor = [0, this.cursor[1] + GLYPH_H * size]; continue; }
      if (this.wrap && this.cursor[0] + GLYPH_W * size > this.w) this.cursor = [0, this.cursor[1] + GLYPH_H * size];
      this.glyph(ch, this.cursor[0], this.cursor[1], this.textColor, size);
      this.cursor[0] += GLYPH_W * size;
    }
    if (newline) this.cursor = [0, this.cursor[1] + GLYPH_H * size];
    this.ops++;
  }
}

// ── Colour parsing (GFX 565 constants, hex, names) ────────────────────────
const NAMED = {
  BLACK: [0, 0, 0], WHITE: [255, 255, 255], RED: [255, 0, 0], GREEN: [0, 255, 0], BLUE: [0, 0, 255],
  YELLOW: [255, 255, 0], CYAN: [0, 255, 255], MAGENTA: [255, 0, 255], ORANGE: [255, 165, 0],
  DARKGREY: [128, 128, 128], LIGHTGREY: [200, 200, 200], NAVY: [0, 0, 128], PURPLE: [128, 0, 128],
};
export function parseColor(tok, fb) {
  if (tok == null) return fb.lit;
  const t = String(tok).trim().replace(/^(ILI9341_|ST77XX_|ST7735_|SSD1306_|TFT_|EPD_|GxEPD_|EINK_)/, '').toUpperCase();
  if (NAMED[t]) return NAMED[t];
  if (/^0X[0-9A-F]{4}$/.test(t)) {          // RGB565
    const v = parseInt(t, 16);
    return [((v >> 11) & 0x1F) * 255 / 31 | 0, ((v >> 5) & 0x3F) * 255 / 63 | 0, (v & 0x1F) * 255 / 31 | 0];
  }
  if (/^0X[0-9A-F]{6}$/.test(t)) { const v = parseInt(t, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  if (/^\d+$/.test(t)) return Number(t) ? fb.lit : fb.bg;   // 1 / 0 on mono
  return fb.lit;
}

// ── The interpreter ───────────────────────────────────────────────────────
// Extract display calls in source order. `objs` are the receiver names the
// part is likely addressed by (display / tft / lcd …).
function extractCalls(code, objs) {
  const calls = [];
  const objRe = objs.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(${objRe})\\s*[.\\-]>?\\s*([A-Za-z_]\\w*)\\s*\\(([^;]*?)\\)\\s*;`, 'g');
  let m;
  while ((m = re.exec(code))) calls.push({ fn: m[2], args: splitArgs(m[3]), raw: m[0] });
  return calls;
}

function splitArgs(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// A printed argument: a string literal, a number, or a variable. Variables
// resolve from `values` (live sim readings) or render as [name] — honest.
function resolveText(arg, values) {
  if (arg == null) return '';
  const s = String(arg).trim();
  const lit = s.match(/^"(.*)"$/) || s.match(/^'(.*)'$/);
  if (lit) return lit[1].replace(/\\n/g, '\n');
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (s.startsWith('F(')) return resolveText(s.slice(2, -1), values);
  const name = s.replace(/\s*[,)].*$/, '').replace(/\(\)$/, '');
  if (values && name in values) {
    const v = values[name];
    return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : String(v);
  }
  // String(x) / String(x, 1) etc
  const wrapped = s.match(/^String\((\w+)/);
  if (wrapped && values && wrapped[1] in values) return resolveText(wrapped[1], values);
  return `[${name}]`;
}

// A numeric argument may be a literal, a variable with a live value, or a
// simple expression of those (map(temp,0,50,0,128), temp*2, width/2). Bars
// driven by sensor readings are the most common thing a display shows, so
// leaving variables as 0 would blank exactly the content that matters.
function makeNum(values) {
  const lookup = (name) => (values && name in values && Number.isFinite(Number(values[name])) ? Number(values[name]) : null);
  return (a, d = 0) => {
    if (a == null) return d;
    const s = String(a).trim();
    // hex and binary literals are everywhere in embedded code: 0xFF, 0b10101010
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    if (/^0[bB][01]+$/.test(s)) return parseInt(s.slice(2), 2);
    const lit = parseFloat(s);
    if (/^-?\d+(\.\d+)?$/.test(s)) return lit;
    const v = lookup(s);
    if (v != null) return v;
    // Arduino map(x, inMin, inMax, outMin, outMax)
    const m = s.match(/^map\s*\(\s*(\w+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
    if (m) {
      const x = lookup(m[1]); if (x == null) return d;
      const [inMin, inMax, outMin, outMax] = m.slice(2).map(Number);
      return inMax === inMin ? outMin : (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
    }
    // simple arithmetic over known names and literals only — nothing is eval'd
    if (/^[\w\s+\-*/().]+$/.test(s) && !/[;=]/.test(s)) {
      const expr = s.replace(/[A-Za-z_]\w*/g, (id) => { const v = lookup(id); return v == null ? 'NaN' : String(v); });
      if (!/NaN/.test(expr)) {
        try { const r = Function('"use strict"; return (' + expr + ')')(); if (Number.isFinite(r)) return r; } catch { /* fall through */ }
      }
    }
    return d;
  };
}

/**
 * Render what `partId` would show given `code`. `values` supplies live
 * variable readings from the simulation (e.g. { temp: 23.4 }).
 * Returns { fb, calls, unsupported[], truncated, note }.
 */
export function renderScreen(partId, code, values = {}) {
  const num = makeNum(values);
  const spec = SCREENS[partId];
  if (!spec) return { ok: false, reason: `${partId} has no screen model.` };

  if (spec.mode === 'char') return renderCharLcd(spec, code, values);
  if (spec.mode === 'seg') return renderSevenSeg(spec, code, values);

  const fb = new Framebuffer(spec.w, spec.h, { color: spec.color, lit: spec.color ? [255, 255, 255] : (partId === 'eink-29' ? [20, 20, 20] : [200, 230, 255]), bg: partId === 'eink-29' ? [235, 235, 230] : [0, 0, 0] });
  const calls = extractCalls(code || '', spec.obj);
  const unsupported = [];
  let truncated = false;
  const MAX = 400;

  for (let i = 0; i < calls.length; i++) {
    if (i >= MAX) { truncated = true; break; }
    const { fn, args } = calls[i];
    const a = args;
    switch (fn) {
      case 'begin': case 'init': case 'display': case 'setRotation': case 'invertDisplay': case 'setTextWrap':
      case 'clearDisplay': case 'clear': case 'fillScreen':
        if (fn === 'clearDisplay' || fn === 'clear') fb.fill(fb.bg);
        else if (fn === 'fillScreen') fb.fill(parseColor(a[0], fb));
        else if (fn === 'setTextWrap') fb.wrap = !/false|0/.test(a[0] || 'true');
        break;
      case 'setCursor': fb.cursor = [num(a[0]), num(a[1])]; break;
      case 'setTextSize': fb.textSize = Math.max(1, Math.min(8, num(a[0], 1) | 0)); break;
      case 'setTextColor': fb.textColor = parseColor(a[0], fb); break;
      case 'print': fb.print(resolveText(a[0], values)); break;
      case 'println': fb.print(resolveText(a[0], values), { newline: true }); break;
      case 'drawPixel': fb.px(num(a[0]), num(a[1]), parseColor(a[2], fb)); break;
      case 'drawLine': fb.line(num(a[0]), num(a[1]), num(a[2]), num(a[3]), parseColor(a[4], fb)); break;
      case 'drawFastHLine': fb.line(num(a[0]), num(a[1]), num(a[0]) + num(a[2]) - 1, num(a[1]), parseColor(a[3], fb)); break;
      case 'drawFastVLine': fb.line(num(a[0]), num(a[1]), num(a[0]), num(a[1]) + num(a[2]) - 1, parseColor(a[3], fb)); break;
      case 'drawRect': fb.rect(num(a[0]), num(a[1]), num(a[2]), num(a[3]), parseColor(a[4], fb), false); break;
      case 'fillRect': fb.rect(num(a[0]), num(a[1]), num(a[2]), num(a[3]), parseColor(a[4], fb), true); break;
      case 'drawRoundRect': fb.rect(num(a[0]), num(a[1]), num(a[2]), num(a[3]), parseColor(a[5], fb), false); break;
      case 'fillRoundRect': fb.rect(num(a[0]), num(a[1]), num(a[2]), num(a[3]), parseColor(a[5], fb), true); break;
      case 'drawCircle': fb.circle(num(a[0]), num(a[1]), num(a[2]), parseColor(a[3], fb), false); break;
      case 'fillCircle': fb.circle(num(a[0]), num(a[1]), num(a[2]), parseColor(a[3], fb), true); break;
      case 'drawTriangle': { const c = parseColor(a[6], fb); fb.line(num(a[0]), num(a[1]), num(a[2]), num(a[3]), c); fb.line(num(a[2]), num(a[3]), num(a[4]), num(a[5]), c); fb.line(num(a[4]), num(a[5]), num(a[0]), num(a[1]), c); break; }
      case 'setLed': fb.px(num(a[2]), num(a[1]), /true|1/.test(a[3] || '1') ? fb.lit : fb.bg); break;  // LedControl(addr,row,col,state)
      case 'setRow': { const bits = num(a[2]); for (let c = 0; c < 8; c++) if (bits & (0x80 >> c)) fb.px(c, num(a[1]), fb.lit); break; }
      default: unsupported.push(fn);
    }
  }
  const uniqUnsupported = [...new Set(unsupported)];
  return {
    ok: true, fb, spec, calls: calls.length, drawn: fb.ops, unsupported: uniqUnsupported, truncated,
    note: `Display simulation: ${calls.length} ${spec.api} call${calls.length === 1 ? '' : 's'} interpreted in source order. Control flow is not executed.` +
      (uniqUnsupported.length ? ` Not understood: ${uniqUnsupported.join(', ')}.` : ''),
  };
}

// Character LCD: a grid of cells, not pixels. Rendered to a framebuffer at
// 6×9 px per cell so it can share the texture path.
function renderCharLcd(spec, code, values) {
  const num = makeNum(values);
  const cells = Array.from({ length: spec.rows }, () => Array(spec.cols).fill(' '));
  let cur = [0, 0];
  const calls = extractCalls(code || '', spec.obj);
  const unsupported = [];
  for (const { fn, args } of calls) {
    if (fn === 'setCursor') cur = [num(args[0]) | 0, num(args[1]) | 0];
    else if (fn === 'clear') { for (const r of cells) r.fill(' '); cur = [0, 0]; }
    else if (fn === 'home') cur = [0, 0];
    else if (fn === 'print') {
      for (const ch of resolveText(args[0], values)) {
        if (cur[1] >= spec.rows) break;
        if (cur[0] < spec.cols) cells[cur[1]][cur[0]] = ch;
        cur[0]++;
      }
    } else if (!['begin', 'init', 'backlight', 'noBacklight', 'display', 'noDisplay', 'createChar', 'setBacklight'].includes(fn)) unsupported.push(fn);
  }
  const CW = 6, CH = 9;
  const fb = new Framebuffer(spec.cols * CW, spec.rows * CH, { color: false, lit: [20, 40, 20], bg: [120, 200, 80] });
  for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.cols; c++) fb.glyph(cells[r][c], c * CW, r * CH + 1, fb.lit, 1);
  return {
    ok: true, fb, spec, calls: calls.length, drawn: fb.ops, unsupported: [...new Set(unsupported)], truncated: false,
    text: cells.map((r) => r.join('')),
    note: `Display simulation: ${spec.cols}×${spec.rows} character LCD, ${calls.length} LiquidCrystal call${calls.length === 1 ? '' : 's'}.`,
  };
}

// 7-segment: find the number being shown.
function renderSevenSeg(spec, code, values) {
  const num = makeNum(values);
  const calls = extractCalls(code || '', spec.obj);
  let shown = null;
  for (const { fn, args } of calls) {
    if (/^(setNumber|showNumber|showNumberDec|display|print|setSegments)$/.test(fn)) shown = resolveText(args[0], values);
  }
  const text = (shown ?? '----').toString().slice(-spec.digits).padStart(spec.digits, ' ');
  const CW = 6, CH = 9;
  const fb = new Framebuffer(spec.digits * CW, CH, { color: false, lit: [255, 40, 40], bg: [0, 0, 0] });
  for (let i = 0; i < text.length; i++) fb.glyph(text[i], i * CW, 1, fb.lit, 1);
  return { ok: true, fb, spec, calls: calls.length, drawn: fb.ops, unsupported: [], truncated: false, text: [text], note: `Display simulation: ${spec.digits}-digit 7-segment showing "${text.trim()}".` };
}

// ── For the viewport ──────────────────────────────────────────────────────
// Turn a framebuffer into something a three.js texture can eat. Small
// displays are upscaled with nearest-neighbour so pixels stay square — a
// 128×64 OLED must look like one, not like a blurred photo.
export function framebufferToImageData(fb, scale = 1) {
  if (scale === 1) return { width: fb.w, height: fb.h, data: fb.data };
  const w = fb.w * scale, h = fb.h * scale;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) {
      const sx = (x / scale) | 0;
      const si = (sy * fb.w + sx) * 4, di = (y * w + x) * 4;
      out[di] = fb.data[si]; out[di + 1] = fb.data[si + 1]; out[di + 2] = fb.data[si + 2]; out[di + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// ASCII dump for tests and logs — '#' lit, '.' dark. Downsampled for big panels.
export function framebufferToAscii(fb, maxW = 64) {
  const step = Math.max(1, Math.ceil(fb.w / maxW));
  const rows = [];
  for (let y = 0; y < fb.h; y += step * 2) {
    let row = '';
    for (let x = 0; x < fb.w; x += step) {
      const [r, g, b] = fb.get(x, y);
      row += (r + g + b) > 60 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

// Initial values the firmware itself declares — `int temp = 25;`,
// `float pct = 0.7;`, `#define BRIGHTNESS 128`. These are the honest source
// for a static render: they are what the code says, not a guess.
export function extractDeclaredValues(code) {
  const out = {};
  if (!code) return out;
  const decl = /\b(?:int|long|float|double|byte|uint8_t|uint16_t|int16_t|uint32_t|unsigned\s+int|const\s+int|const\s+float|static\s+int)\s+([A-Za-z_]\w*)\s*=\s*(-?\d+(?:\.\d+)?)\s*[;,]/g;
  let m;
  while ((m = decl.exec(code))) out[m[1]] = Number(m[2]);
  const def = /#define\s+([A-Za-z_]\w*)\s+(-?\d+(?:\.\d+)?)\b/g;
  while ((m = def.exec(code))) out[m[1]] = Number(m[2]);
  const str = /\b(?:String|const\s+char\s*\*|char\s*\*)\s+([A-Za-z_]\w*)\s*=\s*"([^"]*)"/g;
  while ((m = str.exec(code))) out[m[1]] = m[2];
  return out;
}
