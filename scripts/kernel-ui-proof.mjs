// Prove the path the Inspector buttons actually take:
// primitive mesh → OCCT solid → operation → baked mesh the renderer draws.
import assert from 'node:assert/strict';
import { runKernelOp, edgeCount, meshToSTEP, kernelSupports, meshEdgePolylines } from '../src/lib/kernelBridge.js';
import { measureBody, measureBetween, measureEdge, angleBetween } from '../src/lib/measure.js';
import { useStore } from '../src/lib/store.js';
import * as ASM from '../src/lib/assembly.js';
import { newFeature, regenerate, runRegenerate, describeFeature, featureSignature } from '../src/lib/features.js';
import { hasFeatureGeom } from '../src/lib/geometryFactory.js';

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

const asmScene = () => {
  useStore.setState({ assemblies: {}, explode: 0, meshes: [
    { id: 'base', kind: 'box', label: 'base plate', position: [0, 0, 0], scale: [1, 0.1, 1], material: 'aluminum' },
    { id: 'post', kind: 'cylinder', label: 'post', position: [0, 0.6, 0], scale: [0.2, 1, 0.2], material: 'steel' },
    { id: 'cap', kind: 'box', label: 'cap', position: [0, 1.15, 0], scale: [0.3, 0.1, 0.3], material: 'pla' },
    { id: 'far', kind: 'box', label: 'far part', position: [3, 0, 0], scale: 0.3, material: 'pla' },
  ] });
};

await check('ASSEMBLY: a subassembly owns bodies and nests under another', () => {
  asmScene();
  const st = useStore.getState();
  const mast = st.createAssembly('mast', ['post', 'cap']);
  const whole = st.createAssembly('whole', ['base']);
  useStore.getState().moveAssembly(mast, whole);
  const t = ASM.assemblyTree();
  assert.deepEqual(t.nodes[whole].children, [mast]);
  assert.deepEqual(ASM.meshesUnder(whole, t).sort(), ['base', 'cap', 'post']);
  assert.equal(t.nodes[mast].depth, 2);
  assert.ok(t.nodes[ASM.ROOT].meshes.includes('far'), 'unassigned bodies stay at root');
});

await check('ASSEMBLY: cycles are refused, dissolve keeps every body', () => {
  asmScene();
  const st = useStore.getState();
  const a = st.createAssembly('a', ['base']);
  const b = st.createAssembly('b', ['post'], a);
  useStore.getState().moveAssembly(a, b);            // a under b under a → refused
  assert.equal(useStore.getState().assemblies[a].parentId, null, 'cycle must be refused');
  useStore.getState().dissolveAssembly(b);
  assert.equal(useStore.getState().meshes.length, 4, 'dissolve deletes nothing');
  assert.equal(useStore.getState().meshes.find((m) => m.id === 'post').assemblyId, a, 'members move to the parent');
});

await check('ASSEMBLY: mass rolls up exactly and matches the sum of parts', async () => {
  asmScene();
  const st = useStore.getState();
  const id = st.createAssembly('stack', ['base', 'post', 'cap']);
  const r = await ASM.assemblyMass(id);
  assert.equal(r.components, 3); assert.equal(r.exact, 3);
  const parts = await Promise.all(['base', 'post', 'cap'].map((i) => measureBody(useStore.getState().meshes.find((m) => m.id === i))));
  const sum = parts.reduce((a, p) => a + p.mass_g, 0);
  assert.ok(Math.abs(r.mass_g - sum) < 0.01, `${r.mass_g} vs ${sum}`);
});

await check('ASSEMBLY: exploding moves the view, never the model', () => {
  asmScene();
  const before = JSON.stringify(useStore.getState().meshes.map((m) => m.position));
  const off = ASM.explodedOffsets(1);
  assert.ok(Object.keys(off).length === 4, 'every body gets an offset');
  assert.ok(Object.values(off).some((o) => Math.hypot(...o) > 0.1), 'offsets must be non-trivial');
  assert.equal(JSON.stringify(useStore.getState().meshes.map((m) => m.position)), before, 'positions untouched');
  assert.deepEqual(ASM.explodedOffsets(0), {}, 'factor 0 = assembled');
});

await check('ASSEMBLY: exact interference finds the pass-through, skips attached pairs', async () => {
  asmScene();
  // sink the post into the base so they genuinely overlap
  useStore.setState({ meshes: useStore.getState().meshes.map((m) => (m.id === 'post' ? { ...m, position: [0, 0.3, 0] } : m)) });
  const r = await ASM.interferenceReport({ clearanceMm: 0.5 });
  assert.ok(!r.ok);
  const hit = r.overlaps.find((o) => (o.a === 'base' && o.b === 'post') || (o.a === 'post' && o.b === 'base'));
  assert.ok(hit, JSON.stringify(r.overlaps));
  assert.equal(hit.method, 'exact');
  // declare it attached → expected to touch → skipped
  useStore.getState().attachMesh?.('post', 'base', false);
  useStore.setState({ meshes: useStore.getState().meshes.map((m) => (m.id === 'post' ? { ...m, attachedTo: 'base' } : m)) });
  const r2 = await ASM.interferenceReport({ clearanceMm: 0.5 });
  assert.ok(!r2.overlaps.some((o) => o.a === 'post' || o.b === 'post'), 'attached pair must be skipped');
});

await check('ASSEMBLY: BOM collapses identical bodies and prices only catalogue parts', async () => {
  asmScene();
  useStore.setState({ meshes: [...useStore.getState().meshes,
    { id: 'far2', kind: 'box', label: 'far part 2', position: [4, 0, 0], scale: 0.3, material: 'pla' },
    { id: 'p1', kind: 'part', partId: 'led-5mm', label: 'LED', position: [5, 0, 0], size: [0.06, 0.1, 0.06], mm: [5, 8, 5] },
  ] });
  const b = await ASM.assemblyBOM();
  const boxes = b.rows.find((r) => r.qty === 2 && /box/.test(r.description));
  assert.ok(boxes, 'two identical boxes must be one line ×2: ' + b.rows.map((r) => r.qty + ' ' + r.description).join(' | '));
  const led = b.rows.find((r) => r.partNumber === 'led-5mm');
  assert.ok(led && led.unitPrice > 0, 'catalogue part carries a price');
  assert.equal(boxes.unitPrice, null, 'a printed body has no price');
  assert.ok(b.totalMass_g > 0);
  const csv = ASM.bomToCsv(b);
  assert.ok(csv.split('\n').length === b.rows.length + 2, 'header + rows + total');
  assert.ok(/"TOTAL"/.test(csv));
});

const featBody = (features = []) => ({ id: 'fb', kind: 'box', label: 'block', scale: [60 / 83.33, 20 / 83.33, 40 / 83.33], position: [0, 0, 0], rotation: [0, 0, 0], material: 'pla', features });

await check('PARAMETRIC: a fillet feature regenerates real geometry and keeps the primitive', async () => {
  const m = featBody([newFeature('fillet', { radius_mm: 2 })]);
  const r = await regenerate(m);
  assert.ok(r.ok, r.steps.map((x) => x.reason).join());
  assert.equal(m.kind, 'box', 'the primitive is NOT replaced');
  assert.ok(r.geom.positions.length > 300);
  assert.equal(r.steps[0].faces, '6→26');
});

await check('PARAMETRIC: editing the radius changes the geometry', async () => {
  const a = await regenerate(featBody([newFeature('fillet', { radius_mm: 1 })]));
  const b = await regenerate(featBody([newFeature('fillet', { radius_mm: 5 })]));
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.geom.positions.length, b.geom.positions.length, 'different radius, different mesh');
});

await check('PARAMETRIC: resizing the base replays every feature', async () => {
  const feat = newFeature('fillet', { radius_mm: 2 });
  const small = await regenerate(featBody([feat]));
  const big = await regenerate({ ...featBody([feat]), scale: [120 / 83.33, 40 / 83.33, 80 / 83.33] });
  assert.ok(small.ok && big.ok);
  assert.ok(big.half[0] > small.half[0] * 1.9, 'the regenerated body must be twice as wide');
});

await check('PARAMETRIC: a suppressed feature is skipped, not deleted', async () => {
  const feat = { ...newFeature('fillet', { radius_mm: 2 }), enabled: false };
  const r = await regenerate(featBody([feat]));
  assert.ok(r.ok); assert.equal(r.steps[0].skipped, true);
  const before = await regenerate(featBody([]));
  assert.equal(r.geom.positions.length, before.geom.positions.length, 'suppressed = plain primitive');
});

await check('PARAMETRIC: an impossible feature fails BY NAME and keeps the last valid shape', async () => {
  const ok = newFeature('fillet', { radius_mm: 2 });
  const bad = newFeature('fillet', { radius_mm: 50 });
  const r = await regenerate(featBody([ok, bad]));
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, bad.id, 'must name the feature that broke');
  assert.equal(r.steps[0].ok, true, 'the earlier feature still applied');
  assert.ok(/exceeds|carry|geometry/i.test(r.steps[1].reason));
  assert.ok(r.geom.positions.length > 300, 'geometry from the valid prefix is returned, not nothing');
});

await check('PARAMETRIC: features chain — shell then fillet, and fillet then fillet', async () => {
  // Shell first, then round the (now thin) edges with a radius under the
  // wall thickness — the order real CAD uses.
  const r = await regenerate(featBody([newFeature('shell', { thickness_mm: 1.5, openFace: 0 }), newFeature('fillet', { radius_mm: 0.5 })]));
  assert.ok(r.ok, r.steps.map((x) => x.reason).join());
  assert.equal(r.steps[0].faces, '6→11'); assert.equal(r.steps[1].faces, '11→51');
  const two = await regenerate(featBody([newFeature('fillet', { radius_mm: 2, edgeIndices: [1, 3, 5, 7] }), newFeature('fillet', { radius_mm: 1, edgeIndices: [0, 2] })]));
  assert.ok(two.ok); assert.equal(two.steps[1].faces, '10→18');
});

await check('PARAMETRIC: fillet-then-shell is a known kernel limit and fails with a reason', async () => {
  // OCCT cannot offset through rational blend surfaces, so hollowing a
  // filleted body fails. That is the kernel's limit, not a silent skip: the
  // shell step reports it, the fillet stays, and reordering fixes it.
  const r = await regenerate(featBody([newFeature('fillet', { radius_mm: 2 }), newFeature('shell', { thickness_mm: 1.5, openFace: 0 })]));
  assert.equal(r.ok, false);
  assert.equal(r.steps[0].ok, true, 'the fillet still applies');
  assert.equal(r.steps[1].ok, false);
  assert.ok(/hollow/i.test(r.steps[1].reason));
  assert.ok(r.geom.positions.length > 300, 'the filleted body is still shown');
});

await check('PARAMETRIC: a fillet larger than a shelled wall is refused, correctly', async () => {
  const r = await regenerate(featBody([newFeature('shell', { thickness_mm: 1.5, openFace: 0 }), newFeature('fillet', { radius_mm: 2 })]));
  assert.equal(r.ok, false);
  assert.ok(/exceeds/i.test(r.steps[1].reason), 'a 2 mm fillet cannot live on a 1.5 mm wall');
});

await check('PARAMETRIC: a per-edge fillet feature respects the selection', async () => {
  const all = await regenerate(featBody([newFeature('fillet', { radius_mm: 2 })]));
  const four = await regenerate(featBody([newFeature('fillet', { radius_mm: 2, edgeIndices: [0, 1, 2, 3] })]));
  assert.ok(all.ok && four.ok);
  assert.ok(Number(four.steps[0].faces.split('→')[1]) < Number(all.steps[0].faces.split('→')[1]));
});

await check('PARAMETRIC: the store caches by signature and only regenerates on change', async () => {
  useStore.setState({ meshes: [featBody([newFeature('fillet', { radius_mm: 2 })])] });
  await runRegenerate('fb');
  const m1 = useStore.getState().meshes[0];
  assert.ok(hasFeatureGeom(m1), 'geometry cached on the mesh');
  assert.equal(m1.featureSig, featureSignature(m1));
  const g1 = m1.featureGeom;
  await runRegenerate('fb');                       // same signature → no work
  assert.strictEqual(useStore.getState().meshes[0].featureGeom, g1, 'unchanged body must not regenerate');
  useStore.getState().updateFeature('fb', m1.features[0].id, { radius_mm: 4 });
  await runRegenerate('fb');
  assert.notStrictEqual(useStore.getState().meshes[0].featureGeom, g1, 'changed radius must regenerate');
  useStore.getState().toggleFeature('fb', m1.features[0].id);
  await runRegenerate('fb');
  assert.equal(hasFeatureGeom(useStore.getState().meshes[0]), false, 'no active features → plain primitive again');
  useStore.setState({ meshes: [] });
});

await check('PARAMETRIC: describeFeature reads like a timeline entry', () => {
  assert.equal(describeFeature(newFeature('fillet', { radius_mm: 2.5 })), 'Fillet r=2.5 mm · all edges');
  assert.equal(describeFeature(newFeature('chamfer', { distance_mm: 1, edgeIndices: [0, 1] })), 'Chamfer 1 mm · 2 edges');
  assert.equal(describeFeature(newFeature('shell', { thickness_mm: 1.2, openFace: null })), 'Shell 1.2 mm wall · sealed');
});

console.log('');
if (fail) { console.log(`${C.r}${C.b}${fail} FAILED${C.x}, ${pass} passed\n`); process.exit(1); }
console.log(`${C.g}${C.b}${pass} passed, 0 failed${C.x} — the Inspector buttons drive a real kernel.\n`);
