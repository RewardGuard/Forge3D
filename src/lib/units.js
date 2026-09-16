// Unit system for Forge3D.
//
// The model is stored in MILLIMETRES as float64, always. Units are a
// presentation and input concern — never a storage one — so a design authored
// in inches and a design authored in metres are the same model underneath and
// round-trip without drift.
//
// WHY THERE IS NO MAXIMUM SIZE
// Forge3D used to clamp every dimension to 400 mm. That was a UI-era artifact,
// not a geometric one. The real limit is float64 precision: 52 bits of
// mantissa, so a coordinate of magnitude X carries an absolute resolution of
// about X * 2^-52. At 1 km (1e6 mm) that is 0.2 nanometres — six orders of
// magnitude finer than any manufacturing process. The honest limit is
// therefore "the renderer's depth buffer", which we solve by adapting the
// camera to the scene (see viewportProfile), not by forbidding large parts.

export const UNITS = {
  mm:   { name: 'Millimetres', abbr: 'mm', toMm: 1,      decimals: 2 },
  cm:   { name: 'Centimetres', abbr: 'cm', toMm: 10,     decimals: 3 },
  m:    { name: 'Metres',      abbr: 'm',  toMm: 1000,   decimals: 4 },
  in:   { name: 'Inches',      abbr: 'in', toMm: 25.4,   decimals: 4 },
  ft:   { name: 'Feet',        abbr: 'ft', toMm: 304.8,  decimals: 5 },
  thou: { name: 'Thou (mil)',  abbr: 'thou', toMm: 0.0254, decimals: 1 },
  um:   { name: 'Micrometres', abbr: 'µm', toMm: 0.001,  decimals: 1 },
};

export const UNIT_KEYS = Object.keys(UNITS);
export const DEFAULT_UNIT = 'mm';

// float64 has 52 mantissa bits. This is the true resolution at a magnitude —
// the number that replaces the old arbitrary clamp.
export function resolutionMm(magnitudeMm) {
  const m = Math.abs(Number(magnitudeMm) || 0);
  return Math.max(m, 1) * Math.pow(2, -52);
}

// A custom unit is any {name, abbr, toMm}. Registering one makes it work
// everywhere the built-ins do.
const custom = new Map();
export function defineUnit(key, { name, abbr, toMm, decimals = 3 }) {
  if (!key || !Number.isFinite(toMm) || toMm <= 0) throw new Error(`defineUnit: bad definition for "${key}"`);
  custom.set(key, { name: name || key, abbr: abbr || key, toMm, decimals, custom: true });
  return unit(key);
}
export function unit(key) { return UNITS[key] || custom.get(key) || null; }
export function allUnits() { return { ...UNITS, ...Object.fromEntries(custom) }; }

export function toMm(value, from = DEFAULT_UNIT) {
  const u = unit(from);
  if (!u) throw new Error(`Unknown unit "${from}"`);
  const n = Number(value);
  return Number.isFinite(n) ? n * u.toMm : NaN;
}

export function fromMm(mm, to = DEFAULT_UNIT) {
  const u = unit(to);
  if (!u) throw new Error(`Unknown unit "${to}"`);
  const n = Number(mm);
  return Number.isFinite(n) ? n / u.toMm : NaN;
}

export function convert(value, from, to) { return fromMm(toMm(value, from), to); }

// Round to a unit's natural precision, or an explicit number of decimals.
export function format(mm, to = DEFAULT_UNIT, decimals) {
  const u = unit(to);
  if (!u) return String(mm);
  const v = fromMm(mm, to);
  if (!Number.isFinite(v)) return '—';
  const d = Number.isFinite(decimals) ? decimals : u.decimals;
  return `${v.toFixed(d)} ${u.abbr}`;
}

// Accepts "12", "12mm", "12 mm", "1.5in", '2"', "3'", "3' 6\"", "1/2 in",
// "1-1/2in". Returns millimetres, or NaN when it cannot be understood.
// `assume` is the unit for a bare number.
export function parse(text, assume = DEFAULT_UNIT) {
  if (typeof text === 'number') return Number.isFinite(text) ? toMm(text, assume) : NaN;
  const s = String(text ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!s) return NaN;

  // feet+inches: 3'6", 3' 6", 3'
  const fi = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*(?:"|in|inch(?:es)?)?)?$/);
  if (fi) {
    const sign = fi[1].startsWith('-') ? -1 : 1;
    const feet = Math.abs(parseFloat(fi[1]));
    const inches = fi[2] ? evalFraction(fi[2]) : 0;
    if (!Number.isFinite(inches)) return NaN;
    return sign * (feet * UNITS.ft.toMm + inches * UNITS.in.toMm);
  }

  const m = s.match(/^(-?[\d./\s-]+?)\s*([a-zµ"']*)$/);
  if (!m) return NaN;
  const nRaw = m[1].trim();
  const n = evalFraction(nRaw);
  if (!Number.isFinite(n)) return NaN;

  const suffix = m[2];
  if (!suffix) return toMm(n, assume);
  const alias = { '"': 'in', "'": 'ft', mm: 'mm', cm: 'cm', m: 'm', in: 'in', inch: 'in', inches: 'in',
                  ft: 'ft', feet: 'ft', foot: 'ft', thou: 'thou', mil: 'thou', mils: 'thou',
                  um: 'um', 'µm': 'um', micron: 'um', microns: 'um' };
  const key = alias[suffix];
  if (!key || !unit(key)) return NaN;
  return toMm(n, key);
}

// "1/2" → 0.5, "1-1/2" → 1.5, "2" → 2
function evalFraction(t) {
  const s = String(t).trim();
  let mm = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (mm) {
    const sign = mm[1].startsWith('-') ? -1 : 1;
    const den = parseFloat(mm[3]);
    if (!den) return NaN;
    return sign * (Math.abs(parseFloat(mm[1])) + parseFloat(mm[2]) / den);
  }
  mm = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (mm) {
    const den = parseFloat(mm[2]);
    return den ? parseFloat(mm[1]) / den : NaN;
  }
  const n = parseFloat(s);
  return /^-?\d*\.?\d+$/.test(s.replace(/\s/g, '')) ? n : NaN;
}

// Pick the unit a human would use for something this big.
export function autoUnit(mm) {
  const v = Math.abs(Number(mm) || 0);
  if (v === 0) return DEFAULT_UNIT;
  if (v < 0.1) return 'um';
  if (v < 10) return 'mm';
  if (v < 1000) return 'mm';
  return 'm';
}

// Scale-aware viewport settings. Replaces hard-coded camera/grid constants so
// a 2 mm lens and a 12 m gantry are both usable without z-fighting or a grid
// that is either invisible or a solid block.
//
// near/far keep a ratio of ~1e5, which is what a 24-bit depth buffer can hold
// without visible z-fighting; a wider span is what makes big scenes flicker.
export function viewportProfile(extentMm) {
  const e = Math.max(Number(extentMm) || 0, 0.001);
  const near = Math.max(e / 5000, 1e-4);
  const far = Math.max(e * 200, near * 1e5);
  const grid = niceStep(e / 10);
  return {
    extentMm: e,
    nearMm: near,
    farMm: far,
    gridStepMm: grid,
    gridMinorMm: grid / 10,
    snapMm: grid / 10,
    cameraDistanceMm: e * 2.2,
    displayUnit: autoUnit(e),
    // Below this, two vertices cannot be told apart at this scene size.
    mergeToleranceMm: Math.max(e * 1e-7, resolutionMm(e) * 16),
  };
}

// 1, 2, 5, 10, 20, 50, ... — the ladder engineers actually use for grids.
export function niceStep(v) {
  const x = Math.abs(Number(v) || 1);
  if (x === 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  const f = x / base;
  const step = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return step * base;
}

// Sanity, NOT a size cap. Rejects only what is geometrically meaningless or
// beyond float64's ability to represent a manufacturable feature.
export const MIN_FEATURE_MM = 1e-4;   // 0.1 µm — finer than any real process
export const MAX_COORD_MM = 1e9;      // 1000 km — past this float64 loses sub-µm

export function validateDimension(mm, label = 'dimension') {
  const n = Number(mm);
  if (!Number.isFinite(n)) return { ok: false, reason: `${label} is not a finite number` };
  if (n === 0) return { ok: false, reason: `${label} is zero` };
  if (Math.abs(n) < MIN_FEATURE_MM) {
    return { ok: false, reason: `${label} is ${n} mm — below the ${MIN_FEATURE_MM} mm minimum representable feature` };
  }
  if (Math.abs(n) > MAX_COORD_MM) {
    return { ok: false, reason: `${label} is ${n} mm — beyond ${MAX_COORD_MM} mm, where float64 can no longer hold sub-micron precision` };
  }
  return { ok: true };
}
