// Prove the path the Inspector buttons actually take:
// primitive mesh → OCCT solid → operation → baked mesh the renderer draws.
import assert from 'node:assert/strict';
import { runKernelOp, edgeCount, meshToSTEP, kernelSupports, meshEdgePolylines } from '../src/lib/kernelBridge.js';
import { measureBody, measureBetween, measureEdge, angleBetween } from '../src/lib/measure.js';

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ${C.g}✓${C.x} ${name}`); pass++; }
  catch (e) { console.log(`  ${C.r}✗${C.x} ${name}\n     ${C.d}${e.message}${C.x}`); fail++; }
};

const box = { id: 'b1', kind: 'box', label: 'shell', scale: [1.4, 0.4, 0.9], color: '#888', position: [0, 0, 0], rotation: [0, 0, 0] };

console.log(`\n${C.b}KERNEL → UI PATH${C.x}\n`);

await check('a primitive box exposes real edges', async () => {
  const n = await edgeCount(box);
  assert.ok(n >= 12, `expected at least 12 edges, got ${n}`);
});

await check('fillet produces a baked mesh the renderer can draw', async () => {
  const r = await runKernelOp(box, 'fillet', { radiusMm: 3 });
  assert.ok(r.ok, r.reason);
  assert.equal(r.mesh.kind, 'baked');
  assert.ok(r.mesh.geom.positions.length > 300, 'needs real triangles');
  assert.equal(r.mesh.geom.positions.length, r.mesh.geom.normals.length, 'normals must match positions');
  assert.ok(r.after.faces > r.before.faces, `faces ${r.before.faces} → ${r.after.faces}`);
  assert.ok(r.mesh.half.every((h) => h > 0), 'half extents must be positive');
  console.log(`     ${C.d}${r.summary}${C.x}`);
});

await check('chamfer works and differs from fillet', async () => {
  const f = await runKernelOp(box, 'fillet', { radiusMm: 3 });
  const c = await runKernelOp(box, 'chamfer', { distanceMm: 3 });
  assert.ok(c.ok, c.reason);
  assert.ok(c.mesh.geom.positions.length !== f.mesh.geom.positions.length, 'a chamfer is not a fillet');
});

await check('an impossible radius is REFUSED with a readable reason', async () => {
  const r = await runKernelOp(box, 'fillet', { radiusMm: 400 });
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 30, 'the user needs a real explanation');
  assert.ok(/radius|geometry|fit/i.test(r.reason));
  console.log(`     ${C.d}"${r.reason.slice(0, 90)}…"${C.x}`);
});

await check('hollowing a solid produces a real cavity', async () => {
  const r = await runKernelOp(box, 'shell', { thicknessMm: 1.5 });
  assert.ok(r.ok, r.reason);
  // A hollow box is 11 planar faces and needs only ~28 triangles. Asserting a
  // triangle count would measure the tessellator, not the operation; the face
  // count is what proves a cavity was actually created.
  assert.ok(r.after.faces > r.before.faces,
    `hollowing must add faces: ${r.before.faces} → ${r.after.faces}`);
  assert.ok(r.mesh.geom.positions.length >= 9, 'must produce drawable geometry');
  assert.equal(r.mesh.geom.positions.length, r.mesh.geom.normals.length);
  console.log(`     ${C.d}${r.summary}${C.x}`);
});

await check('an impossible wall thickness is refused', async () => {
  // Half the smallest dimension leaves no cavity.
  const r = await runKernelOp(box, 'shell', { thicknessMm: 40 });
  assert.equal(r.ok, false, 'a 40 mm wall in a 33 mm-thick body must fail');
  assert.ok(/wall|cavity|offset|hollow/i.test(r.reason), r.reason);
});

await check('unsupported bodies are refused, not crashed', async () => {
  for (const kind of ['torus', 'baked', 'meshy', 'stl', 'part']) {
    const r = await runKernelOp({ ...box, kind }, 'fillet', { radiusMm: 2 });
    assert.equal(r.ok, false, kind);
    assert.ok(r.reason.includes(kind) || /kernel/i.test(r.reason), `${kind}: ${r.reason}`);
  }
  assert.equal(kernelSupports('box'), true);
  assert.equal(kernelSupports('torus'), false);
});

await check('STEP export returns a real ISO-10303 file', async () => {
  const r = await meshToSTEP(box);
  assert.ok(r.ok, r.reason);
  assert.ok(r.text.startsWith('ISO-10303-21'));
  assert.ok(r.bytes > 1000, `only ${r.bytes} bytes`);
  console.log(`     ${C.d}${r.bytes.toLocaleString()} bytes${C.x}`);
});

await check('hostile input never throws', async () => {
  for (const [m, op, args] of [
    [null, 'fillet', {}], [box, 'nonsense', {}], [box, 'fillet', {}],
    [box, 'fillet', { radiusMm: -1 }], [box, 'fillet', { radiusMm: 0 }],
    [box, 'shell', { thicknessMm: 0 }], [{}, 'fillet', { radiusMm: 1 }],
  ]) {
    const r = await runKernelOp(m, op, args);
    assert.equal(typeof r.ok, 'boolean');
    if (!r.ok) assert.ok(r.reason && r.reason.length > 5);
  }
});

await check('edges are deduplicated: a box has 12, not 24', async () => {
  const e = await meshEdgePolylines(box);
  assert.equal(e.length, 12);
  assert.ok(e.every((x) => x.straight && x.points.length === 2));
  const cyl = await meshEdgePolylines({ ...box, kind: 'cylinder', scale: 1 });
  assert.equal(cyl.length, 3, '2 rims + 1 seam');
  assert.equal(cyl.filter((x) => !x.straight).length, 2);
});

await check('a fillet on SELECTED edges touches only those', async () => {
  const all = await runKernelOp(box, 'fillet', { radiusMm: 2 });
  const some = await runKernelOp(box, 'fillet', { radiusMm: 2, edgeIndices: [0, 1, 2, 3] });
  assert.ok(all.ok && some.ok, some.reason);
  assert.ok(some.after.faces < all.after.faces, `4 edges (${some.after.faces} faces) must add fewer faces than 12 (${all.after.faces})`);
  assert.ok(some.after.faces > some.before.faces, 'but it must still have added blend faces');
});

await check('PHONE PROFILE: big radius on the 4 vertical corners, which "all edges" refused', async () => {
  // A phone slab: 77 × 16.6 × 153 mm. A uniform 9 mm fillet is impossible —
  // it exceeds half the 16.6 mm thickness on the horizontal edges. The kernel
  // refused it in design-phone.mjs. Selecting only the 4 vertical corner
  // edges is exactly the operation a real phone body needs.
  const slab = { id: 'ph', kind: 'box', scale: [77 / 83.33, 16.6 / 83.33, 153 / 83.33], position: [0, 0, 0], rotation: [0, 0, 0], color: '#888' };
  const edges = await meshEdgePolylines(slab);
  // vertical = the edge runs along Y (the thickness axis)
  const vertical = edges.filter((e) => Math.abs(e.points[0][1] - e.points[1][1]) > Math.abs(e.points[0][0] - e.points[1][0]) && Math.abs(e.points[0][1] - e.points[1][1]) > Math.abs(e.points[0][2] - e.points[1][2]));
  assert.equal(vertical.length, 4, 'a box has exactly 4 edges along Y');
  const refusedAll = await runKernelOp(slab, 'fillet', { radiusMm: 9 });
  assert.equal(refusedAll.ok, false, 'uniform 9 mm must still be refused');
  const corners = await runKernelOp(slab, 'fillet', { radiusMm: 9, edgeIndices: vertical.map((e) => e.index) });
  assert.ok(corners.ok, corners.reason);
  console.log(`     ${C.d}all-edges r=9 → refused · 4 vertical corners r=9 → ${corners.summary}${C.x}`);
});

await check('an out-of-range edge index is ignored, not fatal', async () => {
  const r = await runKernelOp(box, 'fillet', { radiusMm: 2, edgeIndices: [999] });
  assert.equal(r.ok, false);
  assert.ok(/No edge matched/i.test(r.reason));
});

await check('MEASURE: kernel volume, area, mass and inertia match analytic values', async () => {
  const plate = { id: 'p', kind: 'box', label: 'plate', scale: [60 / 83.33, 20 / 83.33, 40 / 83.33], position: [0, 0, 0], rotation: [0, 0, 0], material: 'aluminum' };
  const r = await measureBody(plate);
  assert.equal(r.source, 'kernel');
  assert.ok(Math.abs(r.volume_cm3 - 48) < 0.05, `volume ${r.volume_cm3}`);
  assert.ok(Math.abs(r.surfaceArea_cm2 - 88) < 0.1, `area ${r.surfaceArea_cm2}`);
  assert.ok(Math.abs(r.mass_g - 48 * 2.7) < 0.2, `mass ${r.mass_g}`);
  const ixx = r.mass_g * (20 * 20 + 40 * 40) / 12;
  assert.ok(Math.abs(r.inertia_g_mm2.Ixx - ixx) / ixx < 0.002, `Ixx ${r.inertia_g_mm2.Ixx} vs ${ixx}`);
  assert.ok(r.principalMoments_g_mm2[0] >= r.principalMoments_g_mm2[2], 'principal moments sorted');
  assert.ok(/6061/.test(r.material.grade), 'mass must quote the grade');
});

await check('MEASURE: centre of mass follows the body\'s position and rotation', async () => {
  const b = { id: 'b', kind: 'box', scale: [0.5, 0.5, 0.5], position: [1, 0.25, -0.5], rotation: [0, Math.PI / 4, 0], material: 'pla' };
  const r = await measureBody(b);
  const U = 83.33;   // mm per scene unit
  assert.ok(Math.abs(r.centreOfMass_mm[0] - 1 * U) < 0.1 && Math.abs(r.centreOfMass_mm[2] + 0.5 * U) < 0.1, JSON.stringify(r.centreOfMass_mm));
});

await check('MEASURE: minimum surface distance is exact and detects touching', async () => {
  const a = { id: 'a', kind: 'box', scale: [60 / 83.33, 20 / 83.33, 40 / 83.33], position: [0, 0, 0], rotation: [0, 0, 0] };
  const pin = { id: 'c', kind: 'cylinder', scale: 0.12, position: [0.9, 0, 0], rotation: [0, 0, 0] };
  const d = await measureBetween(a, pin);
  assert.equal(d.source, 'kernel');
  assert.ok(Math.abs(d.minDistance_mm - 41) < 0.05, `min ${d.minDistance_mm} (75 − 30 − 4)`);
  assert.ok(Math.abs(d.centreDistance_mm - 75) < 0.05);
  const touch = await measureBetween(a, { ...pin, position: [(30 + 4) / 83.33, 0, 0] });   // 34 mm in scene units
  assert.ok(touch.touching, `should touch at 34 mm, got ${touch.minDistance_mm}`);
});

await check('MEASURE: a circular edge reports its radius, a straight one does not', async () => {
  const pin = { id: 'c', kind: 'cylinder', scale: 0.12, position: [0, 0, 0], rotation: [0, 0, 0] };
  const e = await measureEdge(pin, 0);
  assert.equal(e.type, 'circle');
  assert.ok(Math.abs(e.radius_mm - 4) < 0.01);
  assert.ok(Math.abs(e.length_mm - 2 * Math.PI * 4) < 0.01);
  const box = { id: 'b', kind: 'box', scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] };
  const s = await measureEdge(box, 0);
  assert.equal(s.type, 'line'); assert.equal(s.radius_mm, undefined);
});

await check('MEASURE: non-kernel bodies fall back honestly — no invented inertia', async () => {
  const r = await measureBody({ id: 't', kind: 'torus', scale: 1, position: [0, 0, 0], rotation: [0, 0, 0] });
  assert.equal(r.source, 'analytic');
  assert.equal(r.inertia_g_mm2, null, 'must not fabricate a tensor');
  assert.ok(/NOT computed/i.test(r.basis));
  assert.ok(r.volume_cm3 > 0);
});

await check('MEASURE: angle between rotated bodies', () => {
  assert.equal(angleBetween([0, 0, 0], [0, 0, 0]), 0);
  assert.ok(Math.abs(angleBetween([0, 0, 0], [Math.PI / 2, 0, 0]) - 90) < 0.01);
  assert.ok(Math.abs(angleBetween([0, 0, 0], [Math.PI, 0, 0]) - 180) < 0.01);
});

console.log('');
if (fail) { console.log(`${C.r}${C.b}${fail} FAILED${C.x}, ${pass} passed\n`); process.exit(1); }
console.log(`${C.g}${C.b}${pass} passed, 0 failed${C.x} — the Inspector buttons drive a real kernel.\n`);
