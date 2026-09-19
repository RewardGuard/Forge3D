// Measurement and inspection.
//
// Two tiers, and the result always says which one produced it:
//   EXACT     from the B-rep kernel — volume, surface area, centre of mass,
//             inertia tensor, minimum distance between solids, edge length and
//             radius. These are integrals over the true surfaces, not sums
//             over triangles.
//   ANALYTIC  for bodies the kernel cannot rebuild (imported meshes, baked
//             solids, tori): volume from the primitive model and a bounding
//             box. Inertia is NOT available there and the result says so
//             rather than inventing a tensor.
//
// Every value carries its unit in the key. Mass uses the body's material
// density; the material grade is quoted so "mass" is never a bare number.

import { useStore } from './store.js';
import { MATERIALS, partMaterialKey } from './materials.js';
import { estimateGeom } from './lifesim.js';
import { worldAABB } from './orchestraGeometry.js';
import { volumeOf, kernel, edgesOf } from './kernel.js';
import { meshToShape, kernelSupports, kernelMeasurable } from './kernelBridge.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;
const toMm = (u) => u / MM;
const r3 = (v) => +Number(v).toFixed(3);

function materialOf(mesh) {
  const key = mesh.kind === 'part' && mesh.partId ? partMaterialKey(mesh.partId) : (mesh.material || mesh.materialKey || 'pla');
  return { key, ...(MATERIALS[key] || MATERIALS.pla) };
}

/** An OCCT shape placed where the mesh is in the world, in mm. */
async function worldShape(mesh) {
  const oc = await kernel();
  // measure the body as modelled — with its fillets, chamfers and shell
  const { featuredShape } = await import('./features.js');
  const local = await featuredShape(mesh);
  if (!local) return null;
  const tr = new oc.gp_Trsf_1();
  const [rx, ry, rz] = mesh.rotation || [0, 0, 0];
  // three's Euler 'XYZ' is R = Rx·Ry·Rz — INTRINSIC X-Y-Z in OCCT's terms
  // (extrinsic XYZ would be Rz·Ry·Rx and mis-place every two-axis rotation)
  const q = new oc.gp_Quaternion_1();
  q.SetEulerAngles(oc.gp_EulerSequence.gp_Intrinsic_XYZ, rx, ry, rz);
  tr.SetRotation_2(q);
  const [px, py, pz] = (mesh.position || [0, 0, 0]).map(toMm);
  const t2 = new oc.gp_Trsf_1();
  t2.SetTranslation_1(new oc.gp_Vec_4(px, py, pz));
  tr.PreMultiply(t2);
  return new oc.BRepBuilderAPI_Transform_2(local, tr, true).Shape();
}

// ── Body properties ───────────────────────────────────────────────────────
export async function measureBody(mesh) {
  if (!mesh) return { ok: false, reason: 'No body.' };
  const mat = materialOf(mesh);
  const box = worldAABB(mesh);
  const bbox = box?.min && box?.max
    ? { size_mm: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map(toMm).map(r3),
        min_mm: [box.min.x, box.min.y, box.min.z].map(toMm).map(r3), max_mm: [box.max.x, box.max.y, box.max.z].map(toMm).map(r3) }
    : null;

  if (kernelMeasurable(mesh.kind)) {
    const oc = await kernel();
    const shape = await worldShape(mesh);
    const gv = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, gv, false, false, false);
    const gs = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(shape, gs, false, false);
    const vol = gv.Mass();                       // mm³ (unit density)
    const area = gs.Mass();                      // mm²
    const c = gv.CentreOfMass();
    const I = gv.MatrixOfInertia();              // mm⁵ at unit density → × ρ(g/mm³) = g·mm²
    const rho = mat.density / 1000;              // g/cm³ → g/mm³
    const massG = vol * rho;
    const tensor = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]].map(([i, j]) => I.Value(i, j) * rho);
    const principal = principalMoments(tensor);
    return {
      ok: true, source: 'kernel',
      body: mesh.label || mesh.id, kind: mesh.kind,
      material: { key: mat.key, name: mat.name, grade: mat.grade, density_g_cm3: mat.density },
      volume_mm3: r3(vol), volume_cm3: r3(vol / 1000),
      surfaceArea_mm2: r3(area), surfaceArea_cm2: r3(area / 100),
      mass_g: r3(massG),
      centreOfMass_mm: [c.X(), c.Y(), c.Z()].map(r3),
      inertia_g_mm2: {
        Ixx: r3(tensor[0]), Iyy: r3(tensor[4]), Izz: r3(tensor[8]),
        Ixy: r3(tensor[1]), Ixz: r3(tensor[2]), Iyz: r3(tensor[5]),
        about: 'centre of mass, world axes',
      },
      principalMoments_g_mm2: principal.map(r3),
      radiusOfGyration_mm: principal.map((p) => r3(Math.sqrt(Math.max(p, 0) / Math.max(massG, 1e-9)))),
      boundingBox: bbox,
      basis: `Exact B-rep integrals (OCCT GProp). Mass = volume × ${mat.density} g/cm³ (${mat.grade}). Solid body assumed — an FDM part at 20% infill weighs less.`,
    };
  }

  // analytic / mesh fallback
  const { volCm3, surfaceCm2 } = estimateGeom(mesh);
  const massG = volCm3 * mat.density;
  return {
    ok: true, source: 'analytic',
    body: mesh.label || mesh.id, kind: mesh.kind,
    material: { key: mat.key, name: mat.name, grade: mat.grade, density_g_cm3: mat.density },
    volume_mm3: r3(volCm3 * 1000), volume_cm3: r3(volCm3),
    surfaceArea_mm2: r3(surfaceCm2 * 100), surfaceArea_cm2: r3(surfaceCm2),
    mass_g: r3(massG),
    centreOfMass_mm: (mesh.position || [0, 0, 0]).map(toMm).map(r3),
    inertia_g_mm2: null,
    principalMoments_g_mm2: null,
    radiusOfGyration_mm: null,
    boundingBox: bbox,
    basis: `Primitive volume model (${mesh.kind} is not a kernel solid). Centre of mass is the body origin. Inertia is NOT computed for this kind — no tensor is invented.`,
    limitations: ['Volume is the primitive estimate, not an integral.', 'Inertia unavailable.'],
  };
}

// Eigenvalues of a symmetric 3×3 (Jacobi) → principal moments.
function principalMoments(t) {
  let a = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]];
  for (let iter = 0; iter < 50; iter++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
    if (max < 1e-9) break;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(tt * tt + 1), s = tt * c;
    const b = a.map((r) => r.slice());
    for (let k = 0; k < 3; k++) {
      b[k][p] = c * a[k][p] - s * a[k][q]; b[k][q] = s * a[k][p] + c * a[k][q];
    }
    const d = b.map((r) => r.slice());
    for (let k = 0; k < 3; k++) {
      d[p][k] = c * b[p][k] - s * b[q][k]; d[q][k] = s * b[p][k] + c * b[q][k];
    }
    a = d;
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => y - x);
}

// ── Between two bodies ────────────────────────────────────────────────────
export async function measureBetween(a, b) {
  if (!a || !b) return { ok: false, reason: 'Pick two bodies.' };
  const pa = (a.position || [0, 0, 0]).map(toMm), pb = (b.position || [0, 0, 0]).map(toMm);
  const centre = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
  const delta = pb.map((v, i) => r3(v - pa[i]));
  const out = {
    ok: true, from: a.label || a.id, to: b.label || b.id,
    centreDistance_mm: r3(centre), delta_mm: delta,
    angle_deg: angleBetween(a.rotation, b.rotation),
  };
  if (kernelMeasurable(a.kind) && kernelMeasurable(b.kind)) {
    try {
      const oc = await kernel();
      const sa = await worldShape(a), sb = await worldShape(b);
      const d = new oc.BRepExtrema_DistShapeShape_2(sa, sb, oc.Extrema_ExtFlag.Extrema_ExtFlag_MINMAX, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
      d.Perform();
      if (d.IsDone()) {
        const min = d.Value();
        out.minDistance_mm = r3(min);
        out.touching = min < 1e-3;
        // Distance 0 means the surfaces meet — either face-on-face contact or
        // one body sunk into the other. InnerSolution() does not separate the
        // two reliably; the volume the solids SHARE does (a boolean common).
        out.overlapping = false;
        out.sharedVolume_mm3 = 0;
        if (min < 1e-3) {
          try {
            const common = new oc.BRepAlgoAPI_Common_3(sa, sb);
            const v = await volumeOf(common.Shape());
            out.sharedVolume_mm3 = r3(v);
            out.overlapping = v > 1e-3;
          } catch { out.overlapping = d.InnerSolution && d.InnerSolution() ? true : false; }
        }
        if (d.NbSolution() > 0) {
          const p1 = d.PointOnShape1(1), p2 = d.PointOnShape2(1);
          out.closestPoints_mm = [[p1.X(), p1.Y(), p1.Z()].map(r3), [p2.X(), p2.Y(), p2.Z()].map(r3)];
        }
        out.source = 'kernel';
        out.basis = 'Minimum distance between the two solids\' surfaces (BRepExtrema), exact. Centre distance is between body origins.';
      }
    } catch (e) {
      out.source = 'analytic';
      out.basis = 'Centre-to-centre only; the kernel could not compute the surface distance: ' + String(e?.message || e).slice(0, 80);
    }
  } else {
    out.source = 'analytic';
    out.basis = `Centre-to-centre only — ${!kernelMeasurable(a.kind) ? a.kind : b.kind} is not a kernel solid, so surface distance is not available.`;
  }
  return out;
}

// Angle between the two bodies' local Z axes (their "up"), in degrees.
export function angleBetween(rotA = [0, 0, 0], rotB = [0, 0, 0]) {
  // third column of three's XYZ rotation matrix (R = Rx·Ry·Rz) = R·(0,0,1)
  const axis = ([x, y, z]) => {
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
    return [sy, -sx * cy, cx * cy];
  };
  const u = axis(rotA), v = axis(rotB);
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return r3((Math.acos(dot) * 180) / Math.PI);
}

// ── Edge ──────────────────────────────────────────────────────────────────
export async function measureEdge(mesh, edgeIndex) {
  if (!kernelSupports(mesh?.kind)) return { ok: false, reason: `${mesh?.kind} has no kernel edges.` };
  const oc = await kernel();
  const shape = await meshToShape(mesh);
  const edges = await edgesOf(shape);
  const e = edges.find((x) => x.index === edgeIndex);
  if (!e) return { ok: false, reason: `No edge ${edgeIndex}.` };
  const ad = new oc.BRepAdaptor_Curve_2(e.edge);
  const g = new oc.GProp_GProps_1();
  oc.BRepGProp.LinearProperties(e.edge, g, false, false);
  const type = ad.GetType().value;
  const out = { ok: true, edge: edgeIndex, length_mm: r3(g.Mass()), source: 'kernel' };
  if (type === oc.GeomAbs_CurveType.GeomAbs_Line.value) out.type = 'line';
  else if (type === oc.GeomAbs_CurveType.GeomAbs_Circle.value) {
    const c = ad.Circle();
    out.type = 'circle'; out.radius_mm = r3(c.Radius()); out.diameter_mm = r3(c.Radius() * 2);
    const ctr = c.Location(); out.centre_mm = [ctr.X(), ctr.Y(), ctr.Z()].map(r3);
  } else out.type = 'curve';
  return out;
}

// ── Whole scene ───────────────────────────────────────────────────────────
export async function measureScene() {
  const meshes = useStore.getState().meshes || [];
  const bodies = [];
  for (const m of meshes) bodies.push(await measureBody(m));
  const ok = bodies.filter((b) => b.ok);
  const mass = ok.reduce((a, b) => a + b.mass_g, 0);
  const vol = ok.reduce((a, b) => a + b.volume_mm3, 0);
  const com = [0, 0, 0];
  if (mass > 0) for (const b of ok) for (let i = 0; i < 3; i++) com[i] += b.centreOfMass_mm[i] * b.mass_g / mass;
  return {
    bodies: ok.length, exact: ok.filter((b) => b.source === 'kernel').length,
    totalMass_g: r3(mass), totalVolume_cm3: r3(vol / 1000), centreOfMass_mm: com.map(r3),
    perBody: bodies,
  };
}
