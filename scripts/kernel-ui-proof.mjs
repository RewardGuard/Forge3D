// Prove the path the Inspector buttons actually take:
// primitive mesh → OCCT solid → operation → baked mesh the renderer draws.
import assert from 'node:assert/strict';
import { runKernelOp, edgeCount, meshToSTEP, kernelSupports } from '../src/lib/kernelBridge.js';

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

console.log('');
if (fail) { console.log(`${C.r}${C.b}${fail} FAILED${C.x}, ${pass} passed\n`); process.exit(1); }
console.log(`${C.g}${C.b}${pass} passed, 0 failed${C.x} — the Inspector buttons drive a real kernel.\n`);
