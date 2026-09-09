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
import { kernel, filletEdges, chamferEdges, shell, exportSTEP, tessellate, topologyOf, edgesOf } from './kernel.js';
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
      const s = new oc.BRepPrimAPI_MakeCylinder_1(w / 2, h).Shape();
      // three's cylinder is centred on its axis; OCCT's sits on the XY plane.
      const tr = new oc.gp_Trsf_1();
      tr.SetTranslation_1(new oc.gp_Vec_4(0, 0, -h / 2));
      return new oc.BRepBuilderAPI_Transform_2(s, tr, true).Shape();
    }
    case 'sphere':
      return new oc.BRepPrimAPI_MakeSphere_1(w / 2).Shape();
    case 'cone':
      return new oc.BRepPrimAPI_MakeCone_1(w / 2, 0, h).Shape();
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
  let res;
  if (op === 'fillet') res = await filletEdges(shape, args.radiusMm, args.edgeIndices || null);
  else if (op === 'chamfer') res = await chamferEdges(shape, args.distanceMm, args.edgeIndices || null);
  else if (op === 'shell') res = await shell(shape, args.thicknessMm);
  else return { ok: false, reason: `Unknown kernel operation "${op}".` };

  if (!res.ok) return { ok: false, reason: res.reason, kernelError: res.kernelError, before };

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
    summary: `${before.faces} faces → ${after.faces}, ${baked.triangles} triangles`,
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
  const shape = await meshToShape(mesh);
  if (!shape) return { ok: false, reason: 'Could not build a solid.' };
  return exportSTEP(shape);
}

export { isRoundable };
