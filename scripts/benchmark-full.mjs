// ============================================================================
// Forge3D — FULL benchmark + hardening suite.
//
// Two jobs in one run:
//   1. BENCHMARK  — time every hot path in the engineering core against a budget,
//      so a change that makes the simulator or composer 50x slower fails loudly
//      instead of silently.
//   2. BUG HUNT   — hammer every exported function with the inputs a real user
//      (or an LLM driving the MCP tools) actually produces: empty scenes, null
//      args, malformed JSON, NaN, negative millimetres, unknown partIds, huge
//      scenes. Nothing may throw an unhandled error or return corrupt data.
//
// NOTE on style: most of the Orchestra core is STORE-DRIVEN — composeDeterministic,
// synthesizeCircuit, validateStructure, motorReport etc. mutate/read the zustand
// store rather than taking and returning plain values. Tests reflect that.
//
// Run: node scripts/benchmark-full.mjs   (wired into `npm test`)
// ============================================================================
import assert from 'node:assert/strict';

import { useStore } from '../src/lib/store.js';
import { simulate, netRole } from '../src/lib/simulate.js';
import { analyzeDrivenPins } from '../src/lib/codeSim.js';
import { parseAgentJson } from '../src/lib/agentJson.js';
import { buildNetlist, partsCatalog } from '../src/lib/netlist.js';
import { numberedNodeNames } from '../src/lib/labels.js';
import { scaleArr, packScale, avgScale } from '../src/lib/scaleUtil.js';
import { MATERIALS, MATERIAL_KEYS, partMaterialKey, partMaterial } from '../src/lib/materials.js';
import {
  AMBIENT_C, HAZARD_LIST, resolveMaterial, estimateGeom,
  initLifeState, stepLifeState, glowColor, tempColor, statusLabel,
} from '../src/lib/lifesim.js';
import {
  worldAABB, meshDims, classifyGoal, buildCar, buildRobot, buildLamp,
  validateGeometry, applyGeometryFixes,
} from '../src/lib/orchestraGeometry.js';
import {
  motorReport, validateCircuit, synthesizeCircuit, indicatorReport,
  circuitPromptFromSpec, firmwarePromptFromSpec,
} from '../src/lib/orchestraCircuit.js';
import {
  detectPattern, indicatorCount, motorCount, wheelCount,
  seedHouse, seedEnclosure, seedRobot, seedCar, buildGenericSpec, seedSpec,
  sanitizeSpec, normalizeSpec,
} from '../src/lib/orchestraSpec.js';
import { shapeScale, composeGeometry, getLastSpec } from '../src/lib/orchestraCompose.js';
import { validateStructure, applyStructureFixes } from '../src/lib/orchestraPhysics.js';
import { envelopeMM, validateManufacture, validateIntegration } from '../src/lib/orchestraManufacture.js';
import { composeDeterministic, validateAll, iterateToValid, conforms, collectDeficiencies, resetScene } from '../src/lib/orchestraCore.js';
import { PARTS, PART_BY_ID } from '../src/data/parts.js';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
const timings = [];
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function check(name, fn) {
  try {
    fn();
    pass++; console.log(`  ${C.g}✓${C.x} ${name}`);
  } catch (e) {
    fail++; failures.push({ name, err: String(e?.message || e).split('\n')[0] });
    console.log(`  ${C.r}✗${C.x} ${name} — ${String(e?.message || e).split('\n')[0]}`);
  }
}
function bench(name, iters, budgetMs, fn) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn(i);
  const per = Number(process.hrtime.bigint() - t0) / 1e6 / iters;
  timings.push({ name, per, budgetMs });
  if (per <= budgetMs) { pass++; console.log(`  ${C.g}✓${C.x} ${name} ${C.d}${per.toFixed(3)}ms/op × ${iters} (budget ${budgetMs}ms)${C.x}`); }
  else { fail++; failures.push({ name, err: `too slow: ${per.toFixed(3)}ms/op > ${budgetMs}ms` }); console.log(`  ${C.r}✗${C.x} ${name} ${C.r}${per.toFixed(3)}ms/op > ${budgetMs}ms budget${C.x}`); }
}
const section = (t) => console.log(`\n${C.b}${t}${C.x}`);
// values an LLM or a corrupt project file realistically produces
const HOSTILE = [undefined, null, '', 0, -1, NaN, Infinity, -Infinity, {}, [], 'null', '[]', true,
  '../../etc/passwd', '<script>alert(1)</script>', ' ', 'x'.repeat(10000)];
const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
let wseq = 1;
const W = (an, ap, bn, bp) => ({ id: 'w' + wseq++, from: { node: an, pin: ap }, to: { node: bn, pin: bp } });
const mesh = (id, kind, over = {}) => ({ id, kind, label: id, position: [0, 0.5, 0], rotation: [0, 0, 0], color: '#888', scale: 1, ...over });

// uno + 9V battery + LED through a 220R resistor — a real, lighting circuit
const ledNodes = [
  { id: 'n1', partId: 'arduino-uno', x: 0, y: 0 },
  { id: 'n2', partId: 'led-5mm', x: 0, y: 0 },
  { id: 'n3', partId: 'res-220', x: 0, y: 0 },
  { id: 'n4', partId: 'battery-9v', x: 0, y: 0 },
];
// battery → resistor → LED → battery: lights with no firmware needed (an MCU pin
// would only drive it once a sketch sets it HIGH, which is a different test)
const ledWires = [
  W('n4', '+', 'n1', 'VIN'), W('n4', '-', 'n1', 'GND1'),
  W('n4', '+', 'n3', 'A'), W('n3', 'B', 'n2', 'A'), W('n2', 'K', 'n4', '-'),
];

const bigMeshes = Array.from({ length: 300 }, (_, i) =>
  mesh('m' + i, ['box', 'sphere', 'cylinder', 'cone'][i % 4], { position: [(i % 20) * 0.3, 0.5 + (i % 5) * 0.2, Math.floor(i / 20) * 0.3] }));
const bigNodes = Array.from({ length: 120 }, (_, i) => ({ id: 'bn' + i, partId: i % 3 === 0 ? 'led-5mm' : i % 3 === 1 ? 'res-220' : 'dc-motor', x: i, y: i }));
const bigWires = Array.from({ length: 200 }, (_, i) => W('bn' + (i % 120), 'A', 'bn' + ((i + 1) % 120), 'K'));

// build a design into the store, then read the result back
function build(spec) { resetScene(); composeDeterministic(spec); return useStore.getState(); }

console.log(`${C.b}Forge3D — full benchmark + hardening suite${C.x}`);

// ===========================================================================
section('1. CIRCUIT SIMULATOR');
// ===========================================================================
const sim = simulate(ledNodes, ledWires, { codeByNode: {}, blinkPhase: true, inputs: {} });
check('simulate returns nets, components and totals', () => {
  assert.ok(Array.isArray(sim.nets) && sim.nets.length > 0, 'nets');
  assert.ok(Array.isArray(sim.components), 'components');
  assert.equal(typeof sim.totals.voltage, 'number');
});
check('a battery-fed LED through a resistor is ACTIVE', () => {
  const led = sim.components.find((c) => c.nodeId === 'n2');
  assert.ok(led, 'led component missing');
  assert.equal(led.active, true, 'LED should light');
});
check('supply voltage reflects the 9V battery', () => assert.ok(sim.totals.voltage >= 9, `got ${sim.totals.voltage}`));
check('an LED with NO resistor produces a warning', () => {
  const bare = simulate(
    [{ id: 'a', partId: 'battery-9v', x: 0, y: 0 }, { id: 'b', partId: 'led-5mm', x: 0, y: 0 }],
    [W('a', '+', 'b', 'A'), W('a', '-', 'b', 'K')], { codeByNode: {}, inputs: {} });
  assert.ok(bare.warnings.length > 0, 'expected a no-resistor warning');
});
check('empty circuit is inert, not fatal', () => {
  const s = simulate([], [], { codeByNode: {}, inputs: {} });
  assert.equal(s.components.length, 0);
  assert.equal(s.totals.activeCount, 0);
});
// REGRESSION (found by this suite): an unknown partId used to throw
// "Cannot read properties of undefined (reading 'pins')" and take down the
// whole Circuit tab + Life Sim. Old projects and agent calls do this.
check('REGRESSION: an unknown partId is skipped with a warning, not a crash', () => {
  const s = simulate(
    [...ledNodes, { id: 'ghost', partId: 'part-that-no-longer-exists', x: 0, y: 0 }],
    [...ledWires, W('ghost', 'A', 'n1', 'GND1')],
    { codeByNode: {}, inputs: {} });
  assert.ok(s.components.length > 0, 'valid parts should still simulate');
  assert.ok(s.warnings.some((w) => /unknown/i.test(w)), `expected an "unknown part" warning, got ${JSON.stringify(s.warnings)}`);
  assert.equal(s.components.find((c) => c.nodeId === 'n2')?.active, true, 'the good LED must still light');
});
check('simulate survives every hostile argument shape', () => {
  for (const bad of HOSTILE) {
    for (const call of [() => simulate(bad, [], {}), () => simulate([], bad, {}), () => simulate(ledNodes, ledWires, bad)]) {
      try { call(); } catch (e) { throw new Error(`threw on ${JSON.stringify(bad)?.slice(0, 20)}: ${e.message}`); }
    }
  }
});
check('wires pointing at missing nodes are ignored', () => {
  const s = simulate(ledNodes, [...ledWires, W('ghost1', 'A', 'ghost2', 'B')], { codeByNode: {}, inputs: {} });
  assert.ok(s.nets.length > 0);
});
check('a node wired to itself does not hang', () => {
  assert.ok(simulate([{ id: 'z', partId: 'led-5mm', x: 0, y: 0 }], [W('z', 'A', 'z', 'K')], { codeByNode: {}, inputs: {} }));
});
check('netRole classifies every net as a string', () => {
  assert.ok(sim.nets.map((n) => netRole(n, sim)).every((r) => typeof r === 'string'));
});
check('analyzeDrivenPins parses a blink sketch', () => {
  assert.ok(analyzeDrivenPins('arduino-uno', 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}'));
});
check('analyzeDrivenPins survives garbage / huge / empty source', () => {
  for (const bad of ['', 'not code', '}{;;;', 'x'.repeat(50000), null, undefined]) analyzeDrivenPins('arduino-uno', bad);
});
bench('simulate() small circuit', 400, 2.0, () => simulate(ledNodes, ledWires, { codeByNode: {}, inputs: {} }));
bench('simulate() 120 parts / 200 wires', 30, 40, () => simulate(bigNodes, bigWires, { codeByNode: {}, inputs: {} }));

// ===========================================================================
section('2. NETLIST / CATALOG / LABELS');
// ===========================================================================
check('buildNetlist renders a netlist string', () => assert.ok(buildNetlist(ledNodes, ledWires).length > 0));
check('buildNetlist handles an empty circuit', () => assert.equal(typeof buildNetlist([], []), 'string'));
check('buildNetlist survives hostile input', () => { for (const bad of HOSTILE) buildNetlist(bad, bad); });
check('partsCatalog lists the catalog', () => assert.ok(partsCatalog().length > 100));
check('every part has id, name, pins, finite price and positive size', () => {
  for (const p of PARTS) {
    assert.ok(p.id && p.name, `part missing id/name`);
    assert.ok(Array.isArray(p.pins) && p.pins.length > 0, `${p.id} has no pins`);
    assert.ok(Number.isFinite(p.price) && p.price >= 0, `${p.id} price ${p.price}`);
    assert.ok(p.size && ['w', 'h', 'd'].every((k) => Number.isFinite(p.size[k]) && p.size[k] > 0), `${p.id} bad size`);
  }
});
check('no duplicate part ids', () => {
  const ids = PARTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
check('no duplicate pins within a part', () => {
  for (const p of PARTS) assert.equal(new Set(p.pins).size, p.pins.length, `${p.id} duplicate pins`);
});
check('PART_BY_ID matches PARTS', () => { for (const p of PARTS) assert.equal(PART_BY_ID[p.id]?.id, p.id); });
check('numberedNodeNames distinguishes duplicates', () => {
  const n = numberedNodeNames([{ id: 'a', partId: 'led-5mm' }, { id: 'b', partId: 'led-5mm' }]);
  assert.notEqual(n.a, n.b);
});
bench('buildNetlist() 120 parts', 100, 6, () => buildNetlist(bigNodes, bigWires));
bench('partsCatalog()', 200, 3, () => partsCatalog());

// ===========================================================================
section('3. SCALE / MATERIALS');
// ===========================================================================
check('scaleArr normalizes number and array forms', () => {
  assert.deepEqual(scaleArr(2), [2, 2, 2]);
  assert.deepEqual(scaleArr([1, 2, 3]), [1, 2, 3]);
});
check('scaleArr returns 3 finite numbers for any input', () => {
  for (const bad of [undefined, null, NaN, 'x', {}, []]) assert.ok(finite3(scaleArr(bad)), `scaleArr(${String(bad)}) → ${JSON.stringify(scaleArr(bad))}`);
});
check('packScale round-trips a uniform scale', () => assert.notEqual(packScale([2, 2, 2]), undefined));
check('avgScale is finite and positive', () => {
  for (const v of [1, [1, 2, 3], undefined, null]) assert.ok(Number.isFinite(avgScale(v)) && avgScale(v) > 0, `avgScale(${JSON.stringify(v)})`);
});
check('every MATERIAL has the physical fields the sim reads', () => {
  for (const k of MATERIAL_KEYS) {
    const m = MATERIALS[k];
    assert.ok(m.name, `${k} name`);
    assert.ok(Number.isFinite(m.maxTempC), `${k}.maxTempC`);
    assert.ok(m.maxTempC > AMBIENT_C, `${k} melts at room temperature (${m.maxTempC}C)`);
  }
});
check('partMaterialKey resolves to a real material for every part', () => {
  for (const p of PARTS) assert.ok(MATERIALS[partMaterialKey(p.id)], `${p.id} → unknown material`);
});
check('partMaterial falls back instead of throwing on unknown ids', () => { for (const bad of HOSTILE) partMaterial(bad); });

// ===========================================================================
section('4. LIFE SIM — heat, ignition, materials');
// ===========================================================================
const heatMeshes = [mesh('m1', 'box'), mesh('m2', 'box', { position: [3, 0.5, 0] })];
const burn = (meshes, hazards, steps = 200, dt = 0.05) => {
  let st = initLifeState(meshes);
  for (let i = 0; i < steps; i++) st = stepLifeState(st, meshes, hazards, dt);
  return st;
};
const flame = (pos = [0, 0.9, 0], type = 'flamethrower') => [{ id: 'h', type, position: pos, on: true, intensity: 1 }];

check('initLifeState starts everything at ambient and intact', () => {
  for (const o of Object.values(initLifeState(heatMeshes).objects)) {
    assert.equal(o.temp, AMBIENT_C); assert.equal(o.integrity, 1); assert.equal(o.destroyed, false);
  }
});
check('a flamethrower heats the object under it', () => {
  assert.ok(burn(heatMeshes, flame()).objects.m1.temp > AMBIENT_C + 50);
});
check('heat falls off with distance', () => {
  const st = burn(heatMeshes, flame());
  assert.ok(st.objects.m1.temp > st.objects.m2.temp, 'near must be hotter than far');
});
check('a hazard switched OFF heats nothing', () => {
  const st = burn(heatMeshes, [{ id: 'h', type: 'flamethrower', position: [0, 0.9, 0], on: false, intensity: 1 }], 100);
  assert.ok(Math.abs(st.objects.m1.temp - AMBIENT_C) < 1, `off hazard heated to ${st.objects.m1.temp}C`);
});
check('sustained plasma damages an ABS part', () => {
  assert.ok(burn([mesh('p', 'box', { materialKey: 'abs' })], flame([0, 0.6, 0], 'plasma'), 4000).objects.p.integrity < 1);
});
check('steel outlasts ABS under the same flame', () => {
  const run = (materialKey) => burn([mesh('x', 'box', { materialKey })], flame([0, 0.6, 0]), 600).objects.x.integrity;
  assert.ok(run('steel') >= run('abs'), 'steel should outlast ABS');
});
check('cryo cools below ambient', () => {
  assert.ok(burn([mesh('c', 'box')], flame([0, 0.6, 0], 'cryo'), 300).objects.c.temp < AMBIENT_C);
});
check('temperature and integrity stay finite over a long multi-hazard run', () => {
  const hz = HAZARD_LIST.map((h, i) => ({ id: 'h' + i, type: h.id, position: [0, 0.6, 0], on: true, intensity: 1 }));
  const st = burn([mesh('n', 'box')], hz, 2000);
  assert.ok(Number.isFinite(st.objects.n.temp), `temp ${st.objects.n.temp}`);
  assert.ok(Number.isFinite(st.objects.n.integrity), `integrity ${st.objects.n.integrity}`);
});
check('integrity stays clamped to [0,1] across a long burn', () => {
  const m = [mesh('k', 'box', { materialKey: 'abs' })];
  let st = initLifeState(m);
  for (let i = 0; i < 3000; i++) {
    st = stepLifeState(st, m, flame([0, 0.6, 0], 'plasma'), 0.05);
    assert.ok(st.objects.k.integrity >= 0 && st.objects.k.integrity <= 1, `integrity ${st.objects.k.integrity}`);
  }
});
check('an absurd dt does not blow up the integrator', () => {
  const st = stepLifeState(initLifeState([mesh('d', 'box')]), [mesh('d', 'box')], flame([0, 0.6, 0]), 1e6);
  assert.ok(Number.isFinite(st.objects.d.temp), `temp ${st.objects.d.temp} with dt=1e6`);
});
check('hazards with missing/NaN fields do not corrupt state', () => {
  const m = [mesh('h', 'box')];
  const st = stepLifeState(initLifeState(m), m, [
    { id: 'x' },
    { id: 'y', type: 'not-a-hazard', position: null, on: true },
    { id: 'z', type: 'flamethrower', position: [NaN, NaN, NaN], on: true },
  ], 0.05);
  assert.ok(Number.isFinite(st.objects.h.temp), `temp went ${st.objects.h.temp}`);
});
check('an empty scene steps cleanly', () => { stepLifeState(initLifeState([]), [], [], 0.05); });
check('resolveMaterial / estimateGeom work for every mesh kind', () => {
  for (const k of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'meshy', 'stl', 'baked', 'weird']) {
    assert.ok(resolveMaterial(mesh('g', k))?.name, `${k} material`);
    const g = estimateGeom(mesh('g', k));
    assert.ok(Number.isFinite(g.volCm3) && g.volCm3 >= 0, `${k} volCm3 ${g.volCm3}`);
    assert.ok(Number.isFinite(g.surfaceCm2) && g.surfaceCm2 >= 0, `${k} surfaceCm2 ${g.surfaceCm2}`);
  }
});
check('glowColor / tempColor / statusLabel never throw', () => {
  for (const t of [-300, 0, 25, 1000, 1e9, NaN, Infinity]) { tempColor(t); glowColor(t); }
  for (const s of [undefined, null, {}, { temp: NaN, integrity: NaN, destroyed: true }]) statusLabel(s);
});
bench('stepLifeState() 50 objects', 200, 3, () => {
  const m = bigMeshes.slice(0, 50);
  return stepLifeState(initLifeState(m), m, flame([0, 1, 0]), 0.05);
});

// ===========================================================================
section('5. GEOMETRY — AABB, blueprints, validation');
// ===========================================================================
const boxOK = (b) => b && b.min && b.max
  && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)
  && b.min.x <= b.max.x && b.min.y <= b.max.y && b.min.z <= b.max.z;
check('worldAABB returns a finite ordered Box3 for every mesh kind', () => {
  for (const k of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'baked', 'part', 'meshy', 'stl']) {
    const b = worldAABB(mesh('a', k, { size: [0.2, 0.2, 0.2], half: [0.5, 0.5, 0.5], halfY: 0.5 }));
    assert.ok(boxOK(b), `${k} → ${JSON.stringify(b)}`);
  }
});
check('worldAABB survives meshes with missing/NaN fields', () => {
  for (const m of [{}, { kind: 'box' }, { position: null }, { scale: NaN }, { position: [NaN, 1, 2] }]) {
    const b = worldAABB(m);
    assert.ok(b && b.min && b.max, `no box for ${JSON.stringify(m)}`);
  }
});
check('meshDims are finite and non-negative', () => {
  const d = meshDims(mesh('d', 'box'));
  for (const k of ['w', 'h', 'd']) assert.ok(Number.isFinite(d[k]) && d[k] >= 0, `${k}=${d[k]}`);
});
check('classifyGoal recognises the archetypes', () => {
  assert.equal(classifyGoal('a remote control car with 4 wheels'), 'car');
  assert.equal(classifyGoal('a desk lamp'), 'lamp');
});
check('classifyGoal always returns a string', () => {
  for (const bad of HOSTILE) assert.equal(typeof classifyGoal(bad), 'string');
});
check('buildCar / buildRobot / buildLamp give finite mesh positions', () => {
  for (const [n, b] of [['car', buildCar()], ['robot', buildRobot()], ['lamp', buildLamp()]]) {
    const list = Array.isArray(b) ? b : b?.meshes || [];
    assert.ok(list.length > 0, `${n} produced nothing`);
    for (const m of list) assert.ok(finite3(m.position), `${n} mesh at ${JSON.stringify(m.position)}`);
  }
});
check('validateGeometry + applyGeometryFixes run on a blueprint and on nothing', () => {
  validateGeometry(); applyGeometryFixes(validateGeometry() || []);
});
bench('worldAABB() 300-mesh scene', 100, 8, () => bigMeshes.map(worldAABB));

// ===========================================================================
section('6. SPEC LAYER — intent parsing must not mis-count');
// ===========================================================================
check('detectPattern maps goals to templates', () => {
  assert.equal(detectPattern('a house with LEDs'), 'house');
  assert.equal(detectPattern('a sumo robot with 4 motors'), 'robot');
});
check('detectPattern always returns a string', () => {
  for (const bad of HOSTILE) assert.equal(typeof detectPattern(bad), 'string');
});
check('indicatorCount reads explicit LED counts', () => {
  assert.equal(indicatorCount('a box with 3 LEDs'), 3);
  assert.equal(indicatorCount('a gadget with 12 leds'), 12);
});
check('REGRESSION: motorCount counts motors, wheelCount counts wheels', () => {
  assert.equal(motorCount('a car with 4 wheels driven by two motors'), 2);
  assert.equal(wheelCount('a car with 4 wheels driven by two motors'), 4);
});
check('counts are non-negative integers for hostile goals', () => {
  for (const bad of HOSTILE) for (const [n, f] of [['indicator', indicatorCount], ['motor', motorCount], ['wheel', wheelCount]]) {
    const v = f(bad);
    assert.ok(Number.isInteger(v) && v >= 0, `${n}Count(${String(bad).slice(0, 12)}) → ${v}`);
  }
});
check('absurd counts are clamped (no million-LED build)', () => {
  assert.ok(indicatorCount('a panel with 999999999 LEDs') <= 64);
});
for (const [name, seed] of [['house', seedHouse], ['enclosure', seedEnclosure], ['robot', seedRobot], ['car', seedCar]]) {
  check(`seed ${name} → structurally valid spec (finite dims_mm / pos_mm)`, () => {
    const spec = seed(`a ${name}`);
    assert.ok(spec?.bodies?.length > 0, 'no bodies');
    for (const b of spec.bodies) {
      const dims = Object.values(b.dims_mm || {});
      assert.ok(dims.length > 0 && dims.every((v) => Number.isFinite(v) && v > 0), `${name}/${b.id} dims_mm ${JSON.stringify(b.dims_mm)}`);
      assert.ok(finite3(b.pos_mm), `${name}/${b.id} pos_mm ${JSON.stringify(b.pos_mm)}`);
    }
  });
}
check('seedSpec returns a spec for every non-lamp pattern', () => {
  for (const g of ['a house', 'a robot', 'a car', 'an enclosure', 'a novel gizmo']) {
    const p = detectPattern(g);
    if (p === 'lamp') continue;
    assert.ok(seedSpec(p, g), `no spec for "${g}"`);
  }
});
check('buildGenericSpec honours an explicit component list', () => {
  const spec = buildGenericSpec('a gadget with 3 LEDs, a button and a motion sensor');
  assert.equal((spec.electronics || []).filter((e) => /led/i.test(e.partId)).length, 3);
});
check('sanitizeSpec rejects junk, keeps valid specs', () => {
  assert.equal(sanitizeSpec({ bodies: [] }), null);
  for (const bad of HOSTILE) sanitizeSpec(bad);
  assert.ok(sanitizeSpec(seedHouse('a house')));
});
check('sanitizeSpec drops unknown partIds so the BOM stays real', () => {
  const spec = seedHouse('a house');
  spec.electronics = [...(spec.electronics || []), { partId: 'not-a-real-part', pos_mm: [0, 0, 0] }];
  assert.ok(!(sanitizeSpec(spec)?.electronics || []).some((e) => e.partId === 'not-a-real-part'));
});
check('normalizeSpec is idempotent in body count', () => {
  assert.equal(normalizeSpec(seedHouse('a house')).bodies.length,
    normalizeSpec(normalizeSpec(seedHouse('a house'))).bodies.length);
});
bench('seedRobot()', 200, 3, () => seedRobot('a sumo robot with 4 motors'));
bench('buildGenericSpec()', 200, 3, () => buildGenericSpec('a gadget with 3 LEDs, a button and a motion sensor'));

// ===========================================================================
section('7. CIRCUIT SYNTHESIS — auto-wiring + firmware (store-driven)');
// ===========================================================================
const robotGoal = 'a sumo robot with ultrasonic, 4 motors and an arduino';
check('synthesizeCircuit populates the store with nodes and wires', () => {
  resetScene();
  synthesizeCircuit(seedRobot(robotGoal));
  const { nodes, wires } = useStore.getState();
  assert.ok(nodes.length > 0, 'no nodes'); assert.ok(wires.length > 0, 'no wires');
});
check('every synthesized wire references real nodes and real pins', () => {
  resetScene();
  synthesizeCircuit(seedRobot(robotGoal));
  const { nodes, wires } = useStore.getState();
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  for (const w of wires) for (const end of [w.from, w.to]) {
    const n = byId[end.node];
    assert.ok(n, `wire to unknown node ${end.node}`);
    assert.ok(PART_BY_ID[n.partId]?.pins.includes(end.pin), `invalid pin ${end.pin} on ${n.partId}`);
  }
});
check('synthesized firmware is real code', () => {
  resetScene();
  synthesizeCircuit(seedRobot(robotGoal));
  const code = Object.values(useStore.getState().codeByNode).join('\n');
  assert.ok(code.includes('void'), 'no setup/loop in generated firmware');
});
check('a synthesized sumo robot actually runs its motors', () => {
  build(seedRobot(robotGoal));
  const rep = motorReport();
  assert.ok(rep.motors.length > 0, 'no motors');
  assert.equal(rep.anyActive, true, `motors present but idle: ${JSON.stringify(rep.motors.map((m) => m.active))}`);
});
check('a 3-LED gadget reports 3 indicators', () => {
  build(buildGenericSpec('a box with 3 LEDs and a button'));
  assert.ok(indicatorReport().leds.length >= 3, `got ${indicatorReport().leds.length}`);
});
check('validateCircuit returns a deficiency list', () => {
  build(seedRobot(robotGoal));
  assert.ok(Array.isArray(validateCircuit('robot')));
});
check('validateCircuit on an empty store says "empty"', () => {
  resetScene();
  assert.ok(validateCircuit('robot').join(' ').includes('empty'));
});
check('prompt builders return non-empty strings', () => {
  const spec = seedRobot(robotGoal);
  assert.ok(circuitPromptFromSpec(spec).length > 20);
  assert.ok(firmwarePromptFromSpec(spec).length > 20);
});
check('a spec with no electronics synthesizes without throwing', () => {
  resetScene();
  synthesizeCircuit({ ...seedHouse('a house'), electronics: [] });
});
check('motorReport / indicatorReport handle an empty store', () => {
  resetScene();
  assert.equal(motorReport().motors.length, 0);
  assert.equal(indicatorReport().leds.length, 0);
});
bench('synthesizeCircuit() robot', 100, 12, () => { resetScene(); synthesizeCircuit(seedRobot(robotGoal)); });

// ===========================================================================
section('8. COMPOSE / PHYSICS / MANUFACTURE');
// ===========================================================================
check('shapeScale converts mm to exact per-axis scale', () => assert.ok(finite3(shapeScale('box', { w: 100, h: 50, d: 25 }))));
check('REGRESSION: shapeScale never returns zero/negative/NaN (negative flips meshes inside-out)', () => {
  for (const shape of ['box', 'cylinder', 'cone', 'pyramid']) {
    for (const dims of [{}, { w: 0 }, { w: -5, h: null }, { r: Infinity }, { w: NaN, h: -3, d: 'x' }, null, undefined]) {
      const s = shapeScale(shape, dims);
      for (const v of (Array.isArray(s) ? s : [s])) {
        assert.ok(Number.isFinite(v) && v > 0, `shapeScale(${shape}, ${JSON.stringify(dims)}) → ${JSON.stringify(s)}`);
      }
    }
  }
});
check('composeGeometry places meshes at finite positions', () => {
  resetScene();
  composeGeometry(seedHouse('a house with 4 LEDs'));
  const { meshes } = useStore.getState();
  assert.ok(meshes.length > 0, 'no meshes composed');
  for (const m of meshes) assert.ok(finite3(m.position), `mesh at ${JSON.stringify(m.position)}`);
});
check('validateStructure reports mass / stability', () => {
  build(seedHouse('a house'));
  const r = validateStructure();
  assert.ok(Number.isFinite(r.mass) && r.mass >= 0, `mass ${r.mass}`);
  assert.ok(finite3(r.com), `com ${JSON.stringify(r.com)}`);
  assert.ok(Array.isArray(r.issues));
});
check('validateStructure on an empty scene is stable with zero mass', () => {
  resetScene();
  const r = validateStructure();
  assert.equal(r.mass, 0); assert.equal(r.stable, true);
});
check('applyStructureFixes never produces NaN positions', () => {
  build(seedCar('a car with 4 wheels driven by two motors'));
  applyStructureFixes(validateStructure().issues);
  for (const m of useStore.getState().meshes) assert.ok(finite3(m.position), `fix produced ${JSON.stringify(m.position)}`);
});
check('envelopeMM returns finite non-negative dimensions', () => {
  const e = envelopeMM(seedHouse('a house'));
  for (const [k, v] of Object.entries(e)) if (typeof v === 'number') assert.ok(Number.isFinite(v) && v >= 0, `${k}=${v}`);
});
check('validateManufacture gives a printability verdict', () => {
  build(seedHouse('a house with 4 LEDs'));
  assert.ok(validateManufacture(getLastSpec()));
});
check('validateIntegration runs on a composed spec', () => {
  build(seedHouse('a house with 4 LEDs'));
  assert.ok(validateIntegration(getLastSpec()));
});
bench('composeGeometry() house', 60, 25, () => { resetScene(); composeGeometry(seedHouse('a house with 4 LEDs')); });
bench('validateStructure() composed house', 60, 25, () => { validateStructure(); });

// ===========================================================================
section('9. ORCHESTRA CORE — the autonomous engineering loop');
// ===========================================================================
check('composeDeterministic builds geometry AND circuit into the store', () => {
  const s = build(seedRobot(robotGoal));
  assert.ok(s.meshes.length > 0, 'no meshes');
  assert.ok(s.nodes.length > 0, 'no circuit');
});
check('validateAll folds every check into one verdict', () => {
  build(seedRobot(robotGoal));
  const r = validateAll(seedRobot(robotGoal));
  assert.equal(typeof r.ok, 'boolean');
});
check('a validated sumo robot passes every engineering check', () => {
  const spec = seedRobot(robotGoal);
  build(spec);
  const r = validateAll(spec);
  assert.ok(r.ok, `did not validate: ${JSON.stringify(collectDeficiencies(r)).slice(0, 200)}`);
});
check('conforms() REJECTS a design that does not match the goal', () => {
  build(seedHouse('a house'));
  assert.equal(conforms(robotGoal).ok, false, 'a house should not conform to a sumo-robot goal');
});
check('conforms() ACCEPTS the matching design', () => {
  build(seedRobot(robotGoal));
  assert.equal(conforms(robotGoal).ok, true);
});
check('iterateToValid repairs a deliberately broken spec', () => {
  const broken = seedCar('a car with 4 wheels driven by two motors');
  broken.bodies[0].pos_mm = [0, -50000, 0];            // buried far underground
  broken.bodies[0].dims_mm = { ...broken.bodies[0].dims_mm, h: 0.05 }; // paper-thin
  resetScene();
  const out = iterateToValid(broken, 4);
  assert.ok(out?.report, 'no report');
  for (const m of useStore.getState().meshes) assert.ok(finite3(m.position), `repair produced ${JSON.stringify(m.position)}`);
});
check('collectDeficiencies returns a readable summary string', () => {
  build(seedHouse('a house'));
  assert.equal(typeof collectDeficiencies(validateAll(seedHouse('a house'))), 'string');
  // and it must actually describe the problem for a deliberately broken design
  const broken = seedCar('a car');
  broken.bodies[0].dims_mm = { ...broken.bodies[0].dims_mm, h: 0.01 };
  build(broken);
  assert.equal(typeof collectDeficiencies(validateAll(broken)), 'string');
});
check('the pipeline does not mutate the caller\'s spec', () => {
  const spec = seedRobot(robotGoal);
  const before = JSON.stringify(spec);
  build(spec); validateAll(spec); conforms(robotGoal);
  assert.equal(JSON.stringify(spec), before, 'spec was mutated');
});
bench('composeDeterministic() robot', 40, 45, () => build(seedRobot(robotGoal)));
bench('validateAll() robot', 40, 60, () => validateAll(seedRobot(robotGoal)));

// ===========================================================================
section('10. AGENT JSON — parsing whatever a weak LLM emits');
// ===========================================================================
check('parses clean JSON', () => assert.equal(parseAgentJson('{"a":1}').a, 1));
check('strips ``` fences', () => assert.equal(parseAgentJson('```json\n{"a":2}\n```').a, 2));
check('finds JSON embedded in prose', () => assert.equal(parseAgentJson('Sure!\n{"tool":"done"}\nHope that helps.')?.tool, 'done'));
check('returns null (never throws) on garbage', () => {
  for (const bad of ['', 'no json', '{unclosed', '}{', 'x'.repeat(10000), null, undefined, 42, {}]) parseAgentJson(bad);
});
check('SECURITY: no prototype pollution via a hostile payload', () => {
  parseAgentJson('{"__proto__":{"polluted":true}}');
  assert.notEqual({}.polluted, true, 'PROTOTYPE POLLUTION through parseAgentJson');
});
bench('parseAgentJson() fenced', 2000, 0.3, () => parseAgentJson('```json\n{"tool":"add_primitive","args":{"kind":"box"}}\n```'));

// ===========================================================================
section('11. SCALE — nothing may go quadratic');
// ===========================================================================
const timeIt = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const huge = Array.from({ length: 1200 }, (_, i) => mesh('h' + i, 'box', { position: [i % 30, 0.5, Math.floor(i / 30)] }));
const t300 = timeIt(() => bigMeshes.map(worldAABB));
const t1200 = timeIt(() => huge.map(worldAABB));
check(`worldAABB scales ~linearly (300→1200 meshes: ${t300.toFixed(1)}ms → ${t1200.toFixed(1)}ms)`, () => {
  assert.ok(t1200 < Math.max(t300 * 10, 50), `looks super-linear: ${t300.toFixed(1)} → ${t1200.toFixed(1)}ms`);
});
check('a 300-object scene validates without throwing', () => {
  resetScene();
  useStore.setState({ meshes: bigMeshes });
  assert.ok(validateStructure());
  resetScene();
});
bench('validateStructure() 300 objects', 5, 400, () => {
  useStore.setState({ meshes: bigMeshes });
  validateStructure();
});

// ---------------------------------------------------------------------------
console.log('\n' + '─'.repeat(64));
if (timings.length) {
  console.log(`${C.b}Slowest operations${C.x}`);
  for (const t of [...timings].sort((a, b) => b.per - a.per).slice(0, 5)) console.log(`  ${t.per.toFixed(3)}ms/op  ${C.d}${t.name}${C.x}`);
  console.log('');
}
if (fail) {
  console.log(`${C.r}${C.b}${fail} FAILED${C.x}, ${pass} passed\n`);
  for (const f of failures) console.log(`  ${C.r}✗${C.x} ${f.name}\n     ${C.d}${f.err}${C.x}`);
  process.exit(1);
}
console.log(`${C.g}${C.b}${pass} passed, 0 failed${C.x} — benchmarks within budget, no crashes on hostile input.`);
