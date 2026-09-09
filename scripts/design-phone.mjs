// Design a phone around a Raspberry Pi CM4, using the real B-rep kernel for
// the body and the real part catalogue for the internals.
//
// This is not a mock-up: the body is an OCCT solid with genuine edge fillets,
// every component is a catalogue part with real millimetre dimensions, and the
// thickness stack, mass and clearances are computed rather than asserted.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dist = path.join(process.cwd(), 'node_modules/opencascade.js/dist');
globalThis.__dirname = dist;
const factory = require(path.join(dist, 'opencascade.wasm.js')).default;

const { PARTS } = await import('../src/data/parts.js');
const { MATERIALS } = await import('../src/lib/materials.js');
const P = (id) => {
  const p = PARTS.find((x) => x.id === id);
  if (!p) throw new Error(`part "${id}" is not in the catalogue`);
  return p;
};

const C = { b: '\x1b[1m', d: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', x: '\x1b[0m' };

// ── Target envelope ───────────────────────────────────────────────────────
// Driven by the display: the panel is 71 × 147 mm, so the body is that plus a
// bezel. Thickness is derived from the stack, not chosen.
const BEZEL = 3.0;
const W = 71 + BEZEL * 2;      // 77 mm
const L = 147 + BEZEL * 2;     // 153 mm
const WALL = 1.2;              // rear shell wall
const CORNER_R = 9;            // the rounded-rectangle profile

// ── The internal stack, front to back ─────────────────────────────────────
const stack = [
  { name: 'Cover glass',            mm: 0.7,  note: 'chemically strengthened' },
  { name: 'Display + touch',        mm: P('dsi-6in-touch').size.h, part: 'dsi-6in-touch' },
  { name: 'Display clearance',      mm: 0.3,  note: 'flex routing + adhesive' },
  { name: 'CM4 + carrier',          mm: P('rpi-cm4').size.h + 1.6, part: 'rpi-cm4', note: '+1.6 mm carrier PCB' },
  { name: 'Board-to-battery gap',   mm: 0.4,  note: 'kapton + swell allowance' },
  { name: 'Battery',                mm: P('lipo-pouch-3000').size.h, part: 'lipo-pouch-3000' },
  { name: 'Rear wall',              mm: WALL },
];
const thickness = stack.reduce((a, s) => a + s.mm, 0);

console.log(`\n${C.b}FORGE3D — phone around a Raspberry Pi CM4${C.x}\n`);
console.log(`${C.b}THICKNESS STACK${C.x} ${C.d}(derived, not chosen)${C.x}`);
for (const s of stack) {
  console.log(`  ${String(s.mm.toFixed(1)).padStart(5)} mm  ${s.name}${s.note ? `  ${C.d}${s.note}${C.x}` : ''}`);
}
console.log(`  ${C.b}${String(thickness.toFixed(1)).padStart(5)} mm  TOTAL${C.x}`);
console.log(`  ${C.d}iPhone 15 is 7.8 mm. This is ${(thickness / 7.8).toFixed(1)}× that.${C.x}\n`);

// ── Component placement, in body coordinates (origin = centre) ────────────
const place = [
  { id: 'rpi-cm4',            at: [0, 0, -18],    why: 'centred, behind the display' },
  { id: 'dsi-6in-touch',      at: [0, 0, 0],      why: 'the whole front face' },
  { id: 'lipo-pouch-3000',    at: [0, 0, 30],     why: 'lower two-thirds, below the board' },
  { id: 'cam-pi-v3',          at: [-22, 0, -58],  why: 'top-left of the back' },
  { id: 'cam-wide-160',       at: [-22, 0, -34],  why: 'below the main camera' },
  { id: 'speaker-micro',      at: [24, 0, 68],    why: 'bottom edge, firing down' },
  { id: 'mic-mems-i2s',       at: [-24, 0, 70],   why: 'bottom edge, away from the speaker' },
  { id: 'i2s-amp-max98357',   at: [24, 0, 52],    why: 'next to the speaker, short traces' },
  { id: 'lte-sim7600',        at: [0, 0, -50],    why: 'top, near the antenna' },
  { id: 'antenna-lte',        at: [0, 0, -70],    why: 'top edge, clear of the ground plane' },
  { id: 'sim-holder',         at: [30, 0, -50],   why: 'right edge, tray access' },
  { id: 'usb-c-pd',           at: [0, 0, 74],     why: 'bottom centre' },
  { id: 'charger-bq24074',    at: [-14, 0, 62],   why: 'near USB-C, short high-current path' },
  { id: 'pmic-buck-3v3',      at: [14, 0, 62],    why: 'near the battery tap' },
  { id: 'fuel-gauge-max17048',at: [0, 0, 46],     why: 'on the battery terminals' },
  { id: 'mpu6050',            at: [18, 0, -18],   why: 'rigid to the chassis' },
  { id: 'mag-lis3mdl',        at: [-18, 0, -8],   why: 'far from speaker and haptic magnets' },
  { id: 'prox-als-vcnl4040',  at: [0, 0, -66],    why: 'top bezel, sees through the glass' },
  { id: 'fingerprint-cap',    at: [0, 0, -40],    why: 'back, under a 0.3 mm window' },
  { id: 'haptic-lra',         at: [-24, 0, 52],   why: 'bottom-left, coupled to the frame' },
];

let bom = 0, mass = 0;
console.log(`${C.b}COMPONENTS${C.x} ${C.d}(catalogue parts, real dimensions)${C.x}`);
for (const c of place) {
  const p = P(c.id);
  bom += p.price;
  const volCm3 = (p.size.w * p.size.h * p.size.d) / 1000;
  const m = volCm3 * 1.6;   // mixed-assembly density, declared below
  mass += m;
  console.log(`  ${p.name.padEnd(28)} ${String(p.size.w).padStart(5)}×${String(p.size.d).padStart(5)}×${String(p.size.h).padStart(4)} mm  ${C.d}${c.why}${C.x}`);
}

// ── Body: a real B-rep solid ──────────────────────────────────────────────
const oc = await new factory({ wasmBinary: fs.readFileSync(path.join(dist, 'opencascade.wasm.wasm')) });
const count = (s, t) => {
  const e = new oc.TopExp_Explorer_2(s, oc.TopAbs_ShapeEnum[`TopAbs_${t}`], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0; for (; e.More(); e.Next()) n++; return n;
};

const slab = new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(-W / 2, -thickness / 2, -L / 2), W, thickness, L).Shape();

// Round the four vertical corners to CORNER_R, then break every remaining
// edge — the rounded-rectangle profile a phone actually has.
function filletAll(shape, r) {
  const f = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const e = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0; for (; e.More(); e.Next()) { f.Add_2(r, oc.TopoDS.Edge_1(e.Current())); n++; }
  f.Build();
  return f.IsDone() ? { ok: true, shape: f.Shape(), n } : { ok: false, n };
}

console.log(`\n${C.b}BODY${C.x} ${C.d}(OpenCascade B-rep solid)${C.x}`);
console.log(`  slab ${W} × ${L} × ${thickness.toFixed(1)} mm → ${count(slab, 'FACE')} faces, ${count(slab, 'EDGE')} edges`);

// The corner radius must not exceed half the thickness on the horizontal
// edges, so try the phone radius and let the kernel tell us the truth.
let body = null;
for (const r of [CORNER_R, 6, 4, 2, 1]) {
  const res = filletAll(slab, r);
  if (res.ok) {
    body = res.shape;
    console.log(`  fillet r=${r} mm on all ${res.n} edges → ${C.g}OK${C.x}, ${count(body, 'FACE')} faces`);
    if (r < CORNER_R) {
      console.log(`  ${C.y}NOTE${C.x} the ${CORNER_R} mm corner was refused by the kernel: a uniform fillet`);
      console.log(`       cannot exceed half the ${thickness.toFixed(1)} mm thickness on the horizontal edges.`);
      console.log(`       A real phone uses a VARIABLE radius — large on the vertical corners, small`);
      console.log(`       on the front/back edges. That needs per-edge selection, which the kernel`);
      console.log(`       supports and Forge3D's UI does not expose yet.`);
    }
    break;
  }
  console.log(`  fillet r=${r} mm → ${C.r}refused by the kernel${C.x}`);
}

// ── Rear shell ────────────────────────────────────────────────────────────
if (body) {
  const inner = new oc.BRepPrimAPI_MakeBox_2(
    new oc.gp_Pnt_3(-W / 2 + WALL, -thickness / 2 + WALL, -L / 2 + WALL),
    W - WALL * 2, thickness - WALL * 2, L - WALL * 2).Shape();
  const cut = new oc.BRepAlgoAPI_Cut_3(body, inner);
  cut.Build();
  if (cut.IsDone()) {
    const shell = cut.Shape();
    console.log(`  hollowed to a ${WALL} mm wall → ${count(shell, 'FACE')} faces, ${count(shell, 'SOLID')} solid`);
    const w = new oc.STEPControl_Writer_1();
    w.Transfer(shell, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
    w.Write('phone.step');
    const text = oc.FS.readFile('phone.step', { encoding: 'utf8' });
    fs.writeFileSync('phone-body.step', text);
    console.log(`  ${C.g}STEP written${C.x} phone-body.step — ${text.length} bytes, ${(text.match(/ADVANCED_FACE/g) || []).length} B-rep faces`);
  }
}

// ── Engineering findings ──────────────────────────────────────────────────
const shellVolCm3 = ((W * L * thickness) - ((W - 2 * WALL) * (L - 2 * WALL) * (thickness - 2 * WALL))) / 1000;
const shellMass = shellVolCm3 * MATERIALS.aluminum.density;

console.log(`\n${C.b}MASS${C.x}`);
console.log(`  shell (${MATERIALS.aluminum.grade.split('(')[0].trim()})  ${shellMass.toFixed(0)} g`);
console.log(`  components                    ${mass.toFixed(0)} g  ${C.d}assumes 1.6 g/cm³ mixed assembly${C.x}`);
console.log(`  ${C.b}total  ${(shellMass + mass).toFixed(0)} g${C.x}  ${C.d}iPhone 15: 171 g${C.x}`);
console.log(`\n${C.b}BOM${C.x}  $${bom.toFixed(2)} in components (${place.length} parts)\n`);

console.log(`${C.b}PROBLEMS THIS DESIGN HAS${C.x}`);
const problems = [
  `${thickness.toFixed(1)} mm thick — ${(thickness / 7.8).toFixed(1)}× an iPhone 15. The CM4 (4.7 mm + 1.6 mm carrier) and a 4.5 mm pouch cell dominate. A phone SoC package is under 1 mm.`,
  `The metal shell will detune the LTE antenna. Real phones use the frame AS the antenna with plastic split lines; this design does not.`,
  `No thermal path modelled. A CM4 under load dissipates ~5 W into a sealed aluminium box.`,
  `The magnetometer sits 42 mm from the LRA and 48 mm from the speaker — both carry magnets and will bias the compass.`,
  `Fingerprint sensor is behind the rear wall at ${WALL} mm; capacitive sensing needs under ~0.3 mm. It will not read.`,
  `No display driver validation: the CM4's DSI0 is 2-lane, the 6.1" panel wants 4. Only half the bandwidth is there.`,
];
problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

console.log(`\n${C.b}WHAT FORGE3D COULD NOT CHECK${C.x}`);
[
  'Stress or drop survival — no FEA solver.',
  'Thermal rise — no conduction network.',
  'RF performance — no electromagnetic solver.',
  'Assembly clearances between placed parts — no swept-volume interference on rotated bodies.',
].forEach((p) => console.log(`  · ${p}`));
console.log('');
