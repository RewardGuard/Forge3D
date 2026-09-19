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
  // A Raspberry Pi drives its screen from Python, not Adafruit_GFX: pygame
  // is what the code generator writes for it, so read that dialect too.
  if (spec.mode === 'gfx' && /\bimport\s+pygame\b|\bfrom\s+pygame\b/.test(code || '')) return renderPygame(spec, code, values);

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

// ── pygame (Raspberry Pi) ─────────────────────────────────────────────────
// A Raspberry Pi program draws through pygame, and real programs draw through
// helper functions with parameters, loops over icon lists and centred text
// rects. A line-by-line regex read of that shows a black screen, so this is a
// small Python evaluator: module-level values, def/return, calls with
// arguments, arithmetic (// and int()), tuples/lists, for-loops over lists,
// range() and enumerate(), if/elif/else on evaluable conditions, `while`
// bodies run ONCE (the first frame), f-strings, font.render + get_rect(center=)
// + blit. Anything else is skipped and named in `unsupported`.
// split "a, (b, c), d" at top-level commas
function pyArgs(str) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of String(str)) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const PY_MAX_STEPS = 4000;
const PY_MAX_DEPTH = 6;

function pyLines(code) {
  // logical lines with their indentation; joins lines that continue inside brackets
  const out = [];
  let buf = '', depth = 0, indent = 0;
  for (const raw of String(code || '').split('\n')) {
    const noComment = raw.replace(/#(?=(?:[^"']*["'][^"']*["'])*[^"']*$).*$/, '');
    if (!buf) { const m = noComment.match(/^(\s*)/); indent = m[1].replace(/\t/g, '    ').length; }
    buf += (buf ? ' ' : '') + noComment.trim();
    for (const ch of noComment) { if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; }
    if (depth > 0) continue;
    if (buf) out.push({ indent, text: buf });
    buf = ''; depth = 0;
  }
  if (buf) out.push({ indent, text: buf });
  return out;
}

// Python expression → JS. Tuples become arrays, `//` floor-divides, int()/len()/
// abs()/min()/max()/round() map to helpers, f-strings become templates.
function pyExprToJs(expr) {
  let e = String(expr).trim();
  // f-strings
  e = e.replace(/\bf(["'])((?:\\.|(?!\1).)*)\1/g, (_, q, body) => '`' + body.replace(/`/g, '\\`').replace(/\{([^{}]+)\}/g, (__, inner) => '${' + pyExprToJs(inner.replace(/:[^}]*$/, '')) + '}') + '`');
  e = e.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
  e = e.replace(/\bnot\s+/g, '!').replace(/\band\b/g, '&&').replace(/\bor\b/g, '||');
  e = e.replace(/\bint\(/g, '__int(').replace(/\bfloat\(/g, 'Number(').replace(/\blen\(/g, '__len(').replace(/\bstr\(/g, 'String(')
       .replace(/\babs\(/g, 'Math.abs(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(').replace(/\bround\(/g, 'Math.round(')
       .replace(/\bmath\.(pi|sin|cos|floor|ceil|sqrt|atan2|hypot)\b/g, (m, f) => (f === 'pi' ? 'Math.PI' : 'Math.' + f));
  e = e.replace(/\/\//g, '/__FLOOR__');
  // tuples: a parenthesised top-level comma list not preceded by an identifier is an array
  e = tuplesToArrays(e);
  // a // b  →  Math.floor(a / b): handled by post-processing marker
  e = e.replace(/\/__FLOOR__/g, '/');
  return e;
}
function tuplesToArrays(e) {
  const chars = e.split('');
  const stack = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '(') {
      const prev = e.slice(0, i).replace(/\s+$/, '');
      const isCall = /[A-Za-z0-9_\]\)]$/.test(prev);
      stack.push({ i, isCall, comma: false, depth: 0 });
    } else if (c === ',' && stack.length && stack[stack.length - 1].depth === 0) {
      stack[stack.length - 1].comma = true;
    } else if (c === '[' || c === '{') { if (stack.length) stack[stack.length - 1].depth++; }
    else if (c === ']' || c === '}') { if (stack.length) stack[stack.length - 1].depth--; }
    else if (c === ')') {
      const o = stack.pop();
      if (o && !o.isCall && o.comma) { chars[o.i] = '['; chars[i] = ']'; }
    }
  }
  return chars.join('');
}
function pyEval(expr, scope) {
  // a clock program formats the time; the simulator shows a sample instant
  const stubbed = String(expr)
    .replace(/(?:datetime\.)?datetime\.now\(\)\.strftime\(\s*(["'][^"']*["'])\s*\)/g, '__strftime($1)')
    .replace(/\btime\.strftime\(\s*(["'][^"']*["'])[^)]*\)/g, '__strftime($1)')
    .replace(/(?:datetime\.)?datetime\.now\(\)\.(hour|minute|second|year|month|day)\b/g, (_, f) => ({ hour: 12, minute: 30, second: 0, year: 2026, month: 9, day: 19 })[f])
    .replace(/\btime\.time\(\)/g, '0');
  const js = pyExprToJs(stubbed);
  const names = Object.keys(scope).filter((k) => /^[A-Za-z_]\w*$/.test(k));
  const vals = names.map((k) => scope[k]);
  const helpers = {
    __int: (v) => Math.trunc(Number(v)), __len: (v) => (v == null ? 0 : (v.length ?? 0)),
    __strftime: (f) => String(f).replace(/%H/g, '12').replace(/%I/g, '12').replace(/%M/g, '30').replace(/%S/g, '00').replace(/%p/g, 'PM').replace(/%Y/g, '2026').replace(/%m/g, '09').replace(/%d/g, '19').replace(/%A/g, 'Saturday').replace(/%a/g, 'Sat').replace(/%B/g, 'September').replace(/%b/g, 'Sep'),
  };
  const hasFloor = /\/\s*\S/.test(js) && /\/\//.test(String(expr));
  try {
    const fn = new Function('__h', ...names, `const {__int, __len, __strftime} = __h; return (${js});`);
    let v = fn(helpers, ...vals);
    if (hasFloor && typeof v === 'number') v = Math.floor(v); // a // b on the whole expression is the common case
    return { ok: true, value: v };
  } catch (err) { return { ok: false, error: String(err?.message || err) }; }
}
function pyColorVal(v, fb) {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === 'number')) return [v[0], v[1], v[2]];
  if (typeof v === 'string') return NAMED[v.toUpperCase()] || fb.lit;
  return fb.lit;
}

function renderPygame(spec, code, values) {
  const fb = new Framebuffer(spec.w, spec.h, { color: spec.color, lit: [255, 255, 255], bg: [0, 0, 0] });
  const lines = pyLines(code);
  const defs = {};       // name -> { params, body: [lines] }
  const unsupported = new Set();
  let calls = 0, steps = 0, truncated = false;

  // collect defs (body = following lines with deeper indentation)
  const top = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.text.match(/^def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*:\s*$/);
    if (m) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > l.indent) body.push(lines[j++]);
      defs[m[1]] = { params: m[2].split(',').map((p) => p.trim().replace(/=.*$/, '').replace(/^\*+/, '')).filter(Boolean), defaults: m[2].split(',').map((p) => (p.includes('=') ? p.split('=').slice(1).join('=').trim() : null)), body };
      i = j - 1;
    } else top.push(l);
  }

  const module = { ...values, pygame: 'pygame' };
  const fonts = {};   // object id -> px size
  let fontSeq = 0;

  // blocks: a header line + the lines indented deeper than it
  const takeBlock = (arr, idx) => { const b = []; let j = idx + 1; while (j < arr.length && arr[j].indent > arr[idx].indent) b.push(arr[j++]); return { body: b, next: j }; };

  const drawCall = (fnName, argsSrc, scope) => {
    const argv = pyArgs(argsSrc).map((a) => ({ src: a, v: pyEval(a, scope) }));
    const val = (i, d) => (argv[i]?.v.ok ? argv[i].v.value : d);
    switch (fnName) {
      case 'pygame.draw.rect': { const r = val(2); if (!Array.isArray(r)) return false; const [x, y, w, h] = r; const width = val(3, 0); fb.rect(x, y, w, h, pyColorVal(val(1), fb), !width); calls++; return true; }
      case 'pygame.draw.circle': { const c = val(2); if (!Array.isArray(c)) return false; const width = val(4, 0); fb.circle(c[0], c[1], val(3, 1), pyColorVal(val(1), fb), !width); calls++; return true; }
      case 'pygame.draw.line': { const a = val(2), b = val(3); if (!Array.isArray(a) || !Array.isArray(b)) return false; fb.line(a[0], a[1], b[0], b[1], pyColorVal(val(1), fb)); calls++; return true; }
      case 'pygame.draw.ellipse': { const r = val(2); if (!Array.isArray(r)) return false; const [x, y, w, h] = r; fb.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2, pyColorVal(val(1), fb), !val(3, 0)); calls++; return true; }
      case 'pygame.draw.polygon': { const pts = val(2); if (!Array.isArray(pts)) return false; const c = pyColorVal(val(1), fb); for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; fb.line(a[0], a[1], b[0], b[1], c); } calls++; return true; }
      default: return false;
    }
  };

  const labelText = (label, x, y) => {
    fb.cursor = [Math.round(x), Math.round(y)]; fb.textSize = label.size; fb.textColor = label.color; fb.wrap = false;
    fb.print(label.text); calls++;
  };
  const labelW = (label) => String(label.text).length * GLYPH_W * label.size;
  const labelH = (label) => GLYPH_H * label.size;

  function exec(block, scope, depth) {
    for (let i = 0; i < block.length; i++) {
      if (++steps > PY_MAX_STEPS) { truncated = true; return { ret: undefined, stop: true }; }
      const t = block[i].text;
      let m;
      if (/^(import|from|global|nonlocal|pass|break|continue)\b/.test(t) || /^(pygame\.display\.(flip|update|set_caption)|pygame\.init|pygame\.quit|clock\.tick|time\.sleep|mixer\.init)\(/.test(t)) continue;
      if ((m = t.match(/^return\b\s*(.*)$/))) { const v = m[1] ? pyEval(m[1], scope) : { ok: true, value: undefined }; return { ret: v.ok ? v.value : undefined, stop: true }; }
      // compound statements
      if ((m = t.match(/^(while|if|elif|else|for|try|except|finally|with)\b(.*?):?$/))) {
        const { body, next } = takeBlock(block, i);
        const kw = m[1];
        if (kw === 'while' || kw === 'try' || kw === 'with') { const r = exec(body, scope, depth); if (r.stop) return r; }
        else if (kw === 'if' || kw === 'elif' || kw === 'else') {
          // walk the if/elif/else chain
          let taken = false, j = i;
          while (j < block.length) {
            const hm = block[j].text.match(/^(if|elif|else)\b\s*(.*?):$/);
            if (!hm || (j !== i && hm[1] === 'if')) break;
            const { body: b2, next: n2 } = takeBlock(block, j);
            if (!taken) {
              let cond = hm[1] === 'else';
              if (!cond) { const v = pyEval(hm[2], scope); cond = v.ok ? Boolean(v.value) : /__name__/.test(hm[2]); }
              if (cond) { taken = true; const r = exec(b2, scope, depth); if (r.stop) return r; }
            }
            j = n2;
          }
          i = j - 1; continue;
        }
        else if (kw === 'for') {
          const fm = m[2].match(/^\s*(.+?)\s+in\s+(.+)$/);
          if (fm) {
            let iter = null;
            const rm = fm[2].match(/^range\((.*)\)$/);
            if (rm) { const a = pyArgs(rm[1]).map((x) => pyEval(x, scope)); if (a.every((x) => x.ok)) { const [s0, e0, st] = a.length === 1 ? [0, a[0].value, 1] : [a[0].value, a[1].value, a[2]?.value ?? 1]; iter = []; for (let k = s0; st > 0 ? k < e0 : k > e0; k += st) iter.push(k); } }
            else {
              const em = fm[2].match(/^enumerate\((.*)\)$/);
              let inner = em ? em[1] : fm[2];
              const zm = inner.match(/^zip\((.*)\)$/);
              let src;
              if (/^pygame\.event\.get\(\)$/.test(inner)) inner = '[]';   // no events on the first frame
              if (zm) { const parts = pyArgs(zm[1]).map((x) => pyEval(x, scope)); src = parts.every((x) => x.ok && Array.isArray(x.value)) ? { ok: true, value: parts[0].value.map((_, k) => parts.map((pp) => pp.value[k])) } : { ok: false }; }
              else src = pyEval(inner, scope);
              if (src.ok && Array.isArray(src.value)) iter = em ? src.value.map((v, k) => [k, v]) : src.value;
            }
            if (iter) {
              const targets = fm[1].replace(/^\(|\)$/g, '');
              for (const item of iter.slice(0, 64)) {
                const local = { ...scope };
                bindTargets(targets, item, local);
                const r = exec(body, local, depth); if (r.stop) return r;
                Object.assign(scope, pick(local, Object.keys(scope)));
              }
            } else unsupported.add('for ' + fm[2].slice(0, 30));
          }
        }
        // except/finally bodies are skipped
        i = next - 1; continue;
      }
      // assignment (single or tuple targets), including augmented
      if ((m = t.match(/^([A-Za-z_][\w.\[\]]*(?:\s*,\s*[A-Za-z_][\w.\[\]]*)*)\s*(\+=|-=|\*=|\/=|=)\s*(?!=)(.+)$/))) {
        const targets = m[1], op = m[2], rhs = m[3];
        // font / render / rect helpers first
        let fm;
        if ((fm = rhs.match(/^pygame\.font\.(?:Font|SysFont)\(\s*[^,]+,\s*(.+?)\s*(?:,.*)?\)$/))) { const v = pyEval(fm[1], scope); scope[targets] = { __font: true, px: v.ok ? Number(v.value) || 36 : 36 }; continue; }
        if ((fm = rhs.match(/^([A-Za-z_]\w*)\.render\((.*)\)$/))) {
          const a = pyArgs(fm[2]); const font = scope[fm[1]]; const tv = pyEval(a[0], scope); const cv = pyEval(a[2] ?? 'null', scope);
          const px = font?.__font ? font.px : 36;
          scope[targets] = { __label: true, text: tv.ok ? String(tv.value) : String(a[0]).replace(/^["']|["']$/g, ''), color: pyColorVal(cv.ok ? cv.value : null, fb), size: Math.max(1, Math.round((px * 0.75) / GLYPH_H)) };
          continue;
        }
        if ((fm = rhs.match(/^([A-Za-z_]\w*)\.get_rect\((.*)\)$/))) {
          const lab = scope[fm[1]]; if (!lab?.__label) { unsupported.add('get_rect'); continue; }
          const w = labelW(lab), h = labelH(lab); const rect = { __rect: true, x: 0, y: 0, w, h };
          for (const kv of pyArgs(fm[2])) { const km = kv.match(/^(\w+)\s*=\s*(.+)$/); if (!km) continue; const v = pyEval(km[2], scope); if (!v.ok) continue; const val = v.value;
            if (km[1] === 'center' && Array.isArray(val)) { rect.x = val[0] - w / 2; rect.y = val[1] - h / 2; }
            else if (km[1] === 'topleft' && Array.isArray(val)) { rect.x = val[0]; rect.y = val[1]; }
            else if (km[1] === 'midtop' && Array.isArray(val)) { rect.x = val[0] - w / 2; rect.y = val[1]; }
            else if (km[1] === 'midbottom' && Array.isArray(val)) { rect.x = val[0] - w / 2; rect.y = val[1] - h; }
            else if (km[1] === 'topright' && Array.isArray(val)) { rect.x = val[0] - w; rect.y = val[1]; }
            else if (km[1] === 'centerx') rect.x = val - w / 2; else if (km[1] === 'centery') rect.y = val - h / 2;
            else if (km[1] === 'x' || km[1] === 'left') rect.x = val; else if (km[1] === 'y' || km[1] === 'top') rect.y = val; else if (km[1] === 'right') rect.x = val - w; else if (km[1] === 'bottom') rect.y = val - h; }
          scope[targets] = rect; continue;
        }
        if ((fm = rhs.match(/^pygame\.Rect\((.*)\)$/))) { const a = pyArgs(fm[1]).map((x) => pyEval(x, scope)); if (a.every((x) => x.ok)) { const f = a.length === 1 ? a[0].value : a.map((x) => x.value); scope[targets] = Array.isArray(f) ? f : [0, 0, 0, 0]; } continue; }
        if (/^pygame\.display\.set_mode\(/.test(rhs) || /^pygame\.time\.Clock\(/.test(rhs) || /^pygame\.event\./.test(rhs) || /^\w+\.get_pressed\(/.test(rhs)) { scope[targets] = targets === 'screen' ? 'screen' : null; continue; }
        // a call to a user function on the right-hand side
        const cm = rhs.match(/^([A-Za-z_]\w*)\((.*)\)$/);
        if (cm && defs[cm[1]]) { const r = callDef(cm[1], cm[2], scope, depth); if (op === '=') assign(targets, r, scope); continue; }
        const v = pyEval(rhs, scope);
        if (!v.ok) { if (/draw|render|blit|fill/.test(rhs)) unsupported.add(rhs.slice(0, 40)); continue; }
        if (op === '=') assign(targets, v.value, scope);
        else { const cur = pyEval(targets, scope); if (cur.ok && typeof cur.value === 'number') scope[targets] = op === '+=' ? cur.value + v.value : op === '-=' ? cur.value - v.value : op === '*=' ? cur.value * v.value : cur.value / v.value; }
        continue;
      }
      // expression statements: draw calls, fill, blit, user calls
      if ((m = t.match(/^(pygame\.draw\.\w+)\((.*)\)$/))) { if (!drawCall(m[1], m[2], scope)) unsupported.add(m[1].replace('pygame.draw.', 'draw.')); continue; }
      if ((m = t.match(/^([A-Za-z_]\w*)\.fill\((.*)\)$/))) { const a = pyArgs(m[2]); const v = pyEval(a[0], scope); fb.fill(pyColorVal(v.ok ? v.value : null, fb)); calls++; continue; }
      if ((m = t.match(/^([A-Za-z_]\w*)\.blit\((.*)\)$/))) {
        const a = pyArgs(m[2]); const lab = scope[a[0]] ?? pyEval(a[0], scope).value;
        if (!lab?.__label) { unsupported.add('blit'); continue; }
        const posv = scope[a[1]]?.__rect ? scope[a[1]] : pyEval(a[1], scope).value;
        if (Array.isArray(posv)) labelText(lab, posv[0], posv[1]);
        else if (posv?.__rect) labelText(lab, posv.x, posv.y);
        continue;
      }
      if ((m = t.match(/^([A-Za-z_]\w*)\((.*)\)$/)) && defs[m[1]]) { callDef(m[1], m[2], scope, depth); continue; }
      if (/\b(draw|blit|render|fill)\b/.test(t)) unsupported.add(t.slice(0, 40));
    }
    return { ret: undefined, stop: false };
  }
  function pick(obj, keys) { return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]])); }
  function assign(targets, value, scope) {
    if (targets.includes(',')) { bindTargets(targets, value, scope); return; }
    const im = targets.match(/^([A-Za-z_]\w*)\[(.+)\]$/);
    if (im) { const idx = pyEval(im[2], scope); if (idx.ok && scope[im[1]] != null) scope[im[1]][idx.value] = value; return; }
    scope[targets] = value;
  }
  function bindTargets(targets, item, scope) {
    const names = pyArgs(targets.replace(/^\(|\)$/g, ''));
    if (names.length === 1) { scope[names[0]] = item; return; }
    names.forEach((n, k) => { const clean = n.replace(/^\(|\)$/g, ''); if (clean.includes(',')) bindTargets(clean, item?.[k], scope); else scope[clean] = item?.[k]; });
  }
  function callDef(name, argsSrc, scope, depth) {
    if (depth >= PY_MAX_DEPTH) return undefined;
    const d = defs[name];
    const local = { ...module };
    const argv = pyArgs(argsSrc);
    d.params.forEach((p, k) => {
      const src = argv[k];
      if (src == null) { if (d.defaults[k] != null) { const dv = pyEval(d.defaults[k], scope); local[p] = dv.ok ? dv.value : null; } return; }
      const kv = src.match(/^(\w+)\s*=\s*(.+)$/);
      if (kv) { const v = pyEval(kv[2], scope); local[kv[1]] = v.ok ? v.value : (scope[kv[2]] ?? null); return; }
      local[p] = scope[src] !== undefined ? scope[src] : (pyEval(src, scope).ok ? pyEval(src, scope).value : null);
    });
    const r = exec(d.body, local, depth + 1);
    // module-level names assigned inside (global) flow back
    for (const k of Object.keys(local)) if (k in module && !d.params.includes(k)) module[k] = local[k];
    return r.ret;
  }

  exec(top, module, 0);
  let via = '';
  if (calls === 0) {
    // Nothing reached the screen on the first pass (drawing happens on an
    // event or a timer). Show what the screen-drawing function paints, since
    // that is the first thing a user sees — and say so.
    const cand = Object.keys(defs).find((n) => /^(draw|render|paint|update|refresh)_?(home|main|ui|screen|display|all)?/.test(n) && defs[n].params.length === 0)
      || Object.keys(defs).find((n) => /^(draw|render|paint)/.test(n) && defs[n].params.length === 0);
    if (cand) { steps = 0; callDef(cand, '', module, 0); via = ` Nothing is drawn before the first event — showing ${cand}(), the screen the program paints when one arrives.`; }
  }
  const uniqUnsupported = [...unsupported];
  return {
    ok: true, fb, spec, calls, drawn: fb.ops, unsupported: uniqUnsupported, truncated,
    note: `Display simulation: ${calls} pygame draw call${calls === 1 ? '' : 's'} evaluated (functions, loops and the first pass of the main loop; no timing, no input).${via}` +
      (uniqUnsupported.length ? ` Not understood: ${uniqUnsupported.slice(0, 6).join(', ')}.` : ''),
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
