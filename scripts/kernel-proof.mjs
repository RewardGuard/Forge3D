// Proof that the B-rep kernel does what Forge3D previously had to refuse.
// Runs in Node against the same WASM the app loads. `npm run test:kernel`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const dist = path.join(process.cwd(), 'node_modules/opencascade.js/dist');
// The emscripten glue references __dirname, which does not exist in ESM scope.
globalThis.__dirname = dist;
const factory = require(path.join(dist, 'opencascade.wasm.js')).default;

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); pass++; }
  catch (e) { console.log(`  \x1b[31m✗\x1b[0m ${name}\n     ${e.message}`); fail++; }
};

const t0 = Date.now();
const oc = await new factory({ wasmBinary: fs.readFileSync(path.join(dist, 'opencascade.wasm.wasm')) });
console.log(`\n\x1b[1mB-REP KERNEL\x1b[0m — OpenCascade loaded in ${Date.now() - t0} ms\n`);

const count = (s, t) => {
  const e = new oc.TopExp_Explorer_2(s, oc.TopAbs_ShapeEnum[`TopAbs_${t}`], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0; for (; e.More(); e.Next()) n++; return n;
};
const box = new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(0, 0, 0), 60, 40, 20).Shape();

const mkFillet = (r) => {
  const f = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const e = new oc.TopExp_Explorer_2(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; e.More(); e.Next()) f.Add_2(r, oc.TopoDS.Edge_1(e.Current()));
  f.Build();
  return f;
};

check('a solid carries addressable topology', () => {
  if (count(box, 'FACE') !== 6) throw new Error(`expected 6 faces, got ${count(box, 'FACE')}`);
  if (count(box, 'EDGE') < 12) throw new Error(`expected at least 12 edges, got ${count(box, 'EDGE')}`);
});

check('a real fillet turns edges into surfaces', () => {
  const f = mkFillet(5);
  if (!f.IsDone()) throw new Error('kernel did not build the fillet');
  const faces = count(f.Shape(), 'FACE');
  if (faces <= 6) throw new Error(`fillet added no faces (${faces})`);
});

check('an impossible radius is REFUSED, not approximated', () => {
  let refused = false;
  try { refused = !mkFillet(30).IsDone(); } catch { refused = true; }
  if (!refused) throw new Error('kernel accepted a 30 mm fillet on a 20 mm-tall box');
});

check('STEP export produces a real ISO-10303 file with B-rep faces', () => {
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(mkFillet(5).Shape(), oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  w.Write('proof.step');
  const text = oc.FS.readFile('proof.step', { encoding: 'utf8' });
  if (!text.startsWith('ISO-10303-21')) throw new Error('not a STEP file');
  const faces = (text.match(/ADVANCED_FACE/g) || []).length;
  const cyl = (text.match(/CYLINDRICAL_SURFACE/g) || []).length;
  if (faces < 20) throw new Error(`expected filleted faces, got ${faces}`);
  if (cyl < 12) throw new Error(`expected 12 cylindrical blend surfaces, got ${cyl}`);
  console.log(`     ${text.length} bytes · ${faces} ADVANCED_FACE · ${cyl} CYLINDRICAL_SURFACE`);
});

check('tessellation yields triangles three.js can draw', () => {
  const shape = mkFillet(5).Shape();
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
  let tris = 0;
  const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    const loc = new oc.TopLoc_Location_1();
    const tri = oc.BRep_Tool.Triangulation(oc.TopoDS.Face_1(ex.Current()), loc);
    if (!tri.IsNull()) tris += tri.get().NbTriangles();
  }
  if (tris < 100) throw new Error(`expected a real mesh, got ${tris} triangles`);
  console.log(`     ${tris} triangles at 0.1 mm chord tolerance`);
});

console.log('');
if (fail) { console.log(`\x1b[31m\x1b[1m${fail} FAILED\x1b[0m, ${pass} passed\n`); process.exit(1); }
console.log(`\x1b[32m\x1b[1m${pass} passed, 0 failed\x1b[0m — the kernel does what primitives could not.\n`);
