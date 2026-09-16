// Bridge between Forge3D's primitive meshes and the OCCT B-rep kernel.
//
// The app models with primitives; the kernel models with solids. A kernel
// operation therefore: builds an OCCT solid at the body's TRUE millimetre
// size, runs the operation, tessellates the result, and hands back a `baked`
// mesh — a kind the renderer, the group merger and the exporters already
// understand. Nothing downstream needs to know a kernel was involved.
//
// The conversion is one-way on purpose. Once a body has been filleted it is a
// baked solid, not a parametric primitive, and pretending otherwise would be
// the sort of quiet lie this codebase keeps removing. The Inspector says so,
// and undo restores the primitive.

import * as THREE from 'three';
import { kernel, filletEdges, chamferEdges, shell, exportSTEP, tessellate, topologyOf, edgesOf, validateRemoval } from './kernel.js';
import { trueDimsMm, isRoundable } from './rounding.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;          // scene units per mm
const toScene = (mm) => mm * MM;

/** Build an OCCT solid matching a primitive's real dimensions. */
export async function meshToShape(mesh) {
  const oc = await kernel();
  const [w, h, d] = trueDimsMm(mesh);
  switch (mesh.kind) {
    case 'box':
    case 'plane':
      return new oc.BRepPrimAPI_MakeBox_2(new oc.gp_Pnt_3(-w / 2, -h / 2, -d / 2), w, h, d).Shape();
    case 'cylinder': {
      // three.js cylinders run along Y, centred. OCCT's default runs along Z
      // from the origin — an earlier version built it that way and every
      // measurement against a cylinder was silently 90° off (a post sunk into
      // a base plate read as 14 mm clear). Build on an explicit Y axis, with
      // the base at -h/2 so it is centred like three's.
      const ax = new oc.gp_Ax2_3(new oc.gp_Pnt_3(0, -h / 2, 0), new oc.gp_Dir_4(0, 1, 0));
      return new oc.BRepPrimAPI_MakeCylinder_3(ax, w / 2, h).Shape();
    }
    case 'sphere':
      return new oc.BRepPrimAPI_MakeSphere_1(w / 2).Shape();
    case 'cone': {
      // same axis convention: apex up along +Y, base at -h/2
      const ax = new oc.gp_Ax2_3(new oc.gp_Pnt_3(0, -h / 2, 0), new oc.gp_Dir_4(0, 1, 0));
      return new oc.BRepPrimAPI_MakeCone_3(ax, w / 2, 0, h).Shape();
    }
    default:
      return null;
  }
}

export function kernelSupports(kind) {
  return ['box', 'plane', 'cylinder', 'sphere', 'cone'].includes(kind);
}

/** Tessellate an OCCT solid into the `baked` mesh shape the app already uses. */
export async function shapeToBaked(shape, { deflectionMm = 0.05, label, color, materialKey } = {}) {
  const { positions, normals, triangles } = await tessellate(shape, deflectionMm);

  // mm → scene units, and recentre on the centroid so the mesh behaves like
  // every other object when moved.
  const p = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) p[i] = toScene(positions[i]);

  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 3) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
  const centre = box.getCenter(new THREE.Vector3());
  for (let i = 0; i < p.length; i += 3) { p[i] -= centre.x; p[i + 1] -= centre.y; p[i + 2] -= centre.z; }
  const size = box.getSize(new THREE.Vector3());

  return {
    kind: 'baked',
    label, color, materialKey,
    geom: { positions: Array.from(p), normals: Array.from(normals) },
    half: [size.x / 2, size.y / 2, size.z / 2],
    halfY: size.y / 2,
    position: [centre.x, centre.y, centre.z],
    rotation: [0, 0, 0],
    scale: 1,
    fromKernel: true,
    triangles,
  };
}

// ── Per-edge radius limit ─────────────────────────────────────────────────
// OCCT's fillet builder reports IsDone() for radii that produce
// self-intersecting geometry — on a 16.6 mm slab it "succeeds" up to r=15 and
// crashes its own validator at r≥8.3. So the limit is enforced HERE, before
// the kernel is called, from the body's geometry:
//   box edge along axis A → r < half the smaller of the other two dimensions
//     (the two fillets on opposite edges of a face must not meet)
//   cylinder rim → r < min(radius, height/2)
function edgeRadiusLimitMm(mesh, edgePolylinesMm) {
  const [w, h, d] = trueDimsMm(mesh);
  if (mesh.kind === 'cylinder') return () => Math.min(w / 2, h / 2);
  if (mesh.kind === 'sphere') return () => 0;
  if (mesh.kind === 'cone') return () => Math.min(w / 2, h / 2);
  // box / plane: classify each edge by its axis
  return (edge) => {
    const [p0, p1] = edge.points;
    if (!p0 || !p1) return Math.min(w, h, d) / 2;
    const dx = Math.abs(p1[0] - p0[0]), dy = Math.abs(p1[1] - p0[1]), dz = Math.abs(p1[2] - p0[2]);
    if (dx >= dy && dx >= dz) return Math.min(h, d) / 2;   // along X
    if (dy >= dx && dy >= dz) return Math.min(w, d) / 2;   // along Y
    return Math.min(w, h) / 2;                             // along Z
  };
}

/**
 * Run a kernel operation on one mesh and return a replacement mesh.
 * Never throws: a kernel refusal comes back as { ok:false, reason }, which is
 * what the Inspector renders.
 */
export async function runKernelOp(mesh, op, args = {}) {
  if (!mesh) return { ok: false, reason: 'No body selected.' };
  if (!kernelSupports(mesh.kind)) {
    return {
      ok: false,
      reason: `The kernel cannot rebuild a "${mesh.kind}" body. Supported: box, plane, cylinder, sphere, cone.`
        + (mesh.kind === 'baked' ? ' This body is already a baked solid — kernel ops chain from the primitive, so undo first.' : ''),
    };
  }
  let shape;
  try {
    shape = await meshToShape(mesh);
  } catch (e) {
    return { ok: false, reason: `Could not build a solid from this body: ${String(e?.message || e).slice(0, 120)}` };
  }
  if (!shape) return { ok: false, reason: `No kernel primitive matches "${mesh.kind}".` };

  const before = await topologyOf(shape);

  // Refuse radii the geometry cannot carry BEFORE asking the kernel.
  if (op === 'fillet' || op === 'chamfer') {
    const r = Number(op === 'fillet' ? args.radiusMm : args.distanceMm);
    const { edgePolylines } = await import('./kernel.js');
    const polys = await edgePolylines(shape, 2);
    const limitOf = edgeRadiusLimitMm(mesh, polys);
    const chosen = args.edgeIndices ? polys.filter((e) => args.edgeIndices.includes(e.index)) : polys;
    if (!chosen.length) return { ok: false, reason: 'No edge matched the selection.', before };
    const worst = chosen.reduce((acc, e) => { const lim = limitOf(e); return lim < acc.lim ? { lim, e } : acc; }, { lim: Infinity, e: null });
    if (r >= worst.lim - 1e-6) {
      const dims = trueDimsMm(mesh).map((v) => v.toFixed(1)).join(' × ');
      return {
        ok: false, before,
        reason: `Radius ${r} mm exceeds the available local geometry on edge ${worst.e.index}. `
          + `This body is ${dims} mm; the fillets on opposite edges of its thinnest face would meet at ${worst.lim.toFixed(2)} mm. `
          + (args.edgeIndices ? 'Reduce the radius, or drop that edge from the selection.' : 'Reduce the radius, or pick only the edges that can carry it.'),
        maxRadiusMm: +worst.lim.toFixed(3),
      };
    }
  }

  let res;
  if (op === 'fillet') res = await filletEdges(shape, args.radiusMm, args.edgeIndices || null);
  else if (op === 'chamfer') res = await chamferEdges(shape, args.distanceMm, args.edgeIndices || null);
  else if (op === 'shell') res = await shell(shape, args.thicknessMm);
  else return { ok: false, reason: `Unknown kernel operation "${op}".` };

  if (!res.ok) return { ok: false, reason: res.reason, kernelError: res.kernelError, before };

  // IsDone() is not validity. A fillet/chamfer/shell can only remove
  // material; if the result grew, the kernel handed back self-intersecting
  // geometry and we refuse it here.
  const check = await validateRemoval(shape, res.shape, op);
  if (!check.valid) return { ok: false, reason: check.reason, before, invalidResult: true, volumeBefore: check.volumeBefore, volumeAfter: check.volumeAfter };

  const after = await topologyOf(res.shape);
  const baked = await shapeToBaked(res.shape, {
    deflectionMm: args.deflectionMm ?? 0.05,
    label: `${mesh.label || mesh.id} (${op})`,
    color: mesh.color,
    materialKey: mesh.materialKey || mesh.material,
  });
  return {
    ok: true,
    mesh: baked,
    shape: res.shape,
    before, after,
    summary: `${before.faces} faces → ${after.faces}, ${baked.triangles} triangles, ${(check.removedMm3 / 1000).toFixed(2)} cm³ removed`,
    volumeBefore_mm3: check.volumeBefore, volumeAfter_mm3: check.volumeAfter,
  };
}

/** How many edges this body has, so the UI can offer a real selection. */
export async function edgeCount(mesh) {
  if (!kernelSupports(mesh?.kind)) return 0;
  const shape = await meshToShape(mesh);
  if (!shape) return 0;
  return (await edgesOf(shape)).length;
}

/** STEP text for one mesh, straight from the kernel. */
export async function meshToSTEP(mesh) {
  if (!kernelSupports(mesh?.kind)) {
    return { ok: false, reason: `STEP export needs a kernel solid. "${mesh?.kind}" bodies export as STL instead.` };
  }
  // export the FEATURED solid, so fillets and shells reach the STEP file
  const { featuredShape } = await import('./features.js');
  const shape = await featuredShape(mesh);
  if (!shape) return { ok: false, reason: 'Could not build a solid.' };
  return exportSTEP(shape);
}

export { isRoundable };

/**
 * Edges of a primitive as polylines in SCENE units, in the mesh's local frame
 * (so they can be drawn inside the mesh's own group and follow its transform).
 */
export async function meshEdgePolylines(mesh) {
  if (!kernelSupports(mesh?.kind)) return [];
  const shape = await meshToShape(mesh);
  if (!shape) return [];
  const { edgePolylines } = await import('./kernel.js');
  const edges = await edgePolylines(shape);
  return edges.map((e) => ({ ...e, points: e.points.map(([x, y, z]) => [toScene(x), toScene(y), toScene(z)]) }));
}
