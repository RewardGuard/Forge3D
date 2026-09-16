// Real corner rounding on primitives.
//
// WHY THIS IS NOT THE FILLET THAT WAS REFUSED
// cadIntent still refuses `fillet_edges`, and that refusal stands: blending an
// ARBITRARY selected edge on an ARBITRARY solid needs B-rep topology Forge3D
// does not have. But a box with a corner radius is a different animal — it is
// an exactly-defined solid (the Minkowski sum of a box and a sphere), it
// tessellates correctly, and it exports to STL as real geometry. Refusing that
// too was over-broad. This module does the honest subset.
//
// THE SCALE TRAP
// Forge3D renders primitives as a unit shape with a scale applied afterwards.
// Rounding a unit cube and THEN scaling it [1.4, 0.4, 0.9] gives an ELLIPTICAL
// corner — 2 mm across one axis and 0.6 mm across another. That is not a
// radius, and shipping it would be exactly the kind of "looks round enough"
// that this codebase is trying to stop. So a rounded primitive bakes its true
// dimensions into the geometry and renders at scale 1, which keeps the radius
// genuinely circular on every axis.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;              // scene units per mm
export const toSceneUnits = (mm) => mm * MM;
export const toMm = (u) => u / MM;

// How a corner is broken. Both are real geometry, not shading.
export const CORNER_STYLES = {
  round: {
    id: 'round', label: 'Round (fillet)',
    detail: 'A constant-radius arc across the corner. Standard fillet.',
    segments: 6,
  },
  chamfer: {
    id: 'chamfer', label: 'Chamfer',
    detail: 'A single flat facet across the corner, at 45°.',
    segments: 1,   // one segment across the blend IS a chamfer
  },
};

export const CORNER_STYLE_KEYS = Object.keys(CORNER_STYLES);

// Base (unscaled) size of each primitive kind, in scene units.
const BASE_SIZE = {
  box: [1, 1, 1], plane: [1, 0.02, 1],
  cylinder: [0.8, 1, 0.8], cone: [1, 1, 1], pyramid: [1.2, 1, 1.2],
  sphere: [1, 1, 1], capsule: [0.6, 1.2, 0.6],
  torus: [1.12, 0.32, 1.12], torusknot: [0.92, 0.92, 0.92],
  tetrahedron: [1.2, 1.2, 1.2], icosahedron: [1.2, 1.2, 1.2],
};

function scaleTriple(scale) {
  if (Array.isArray(scale)) return [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
  const s = scale ?? 1;
  return [s, s, s];
}

/** True outside dimensions of a primitive in mm, scale included. */
export function trueDimsMm(mesh) {
  if (mesh.kind === 'part' && Array.isArray(mesh.size)) return mesh.size.map(toMm);
  const base = BASE_SIZE[mesh.kind] || [1, 1, 1];
  const s = scaleTriple(mesh.scale);
  return base.map((b, i) => toMm(Math.abs(b * s[i])));
}

/** Which kinds can carry a corner radius, and on which edges. */
export const ROUNDABLE = {
  box: 'all 12 edges',
  plane: 'all 12 edges',
  cylinder: 'the two rim edges',
};

export function isRoundable(kind) { return Object.hasOwn(ROUNDABLE, kind); }

/**
 * The largest radius this body can physically carry. A corner radius cannot
 * exceed half the smallest dimension — past that the arcs from opposite faces
 * would have to pass through each other.
 */
export function maxCornerRadiusMm(mesh) {
  const dims = trueDimsMm(mesh);
  if (mesh.kind === 'cylinder') {
    // rim radius is bounded by both the wall radius and half the height
    return Math.min(dims[0] / 2, dims[1] / 2);
  }
  return Math.min(...dims) / 2;
}

/**
 * Validate a requested radius. Failure explains itself with numbers — this is
 * the "Fillet failed: radius 12 mm exceeds the available local geometry"
 * behaviour the spec asked for, never silent broken geometry.
 */
export function validateCornerRadius(mesh, radiusMm) {
  const r = Number(radiusMm);
  if (!isRoundable(mesh.kind)) {
    return {
      ok: false,
      reason: `${mesh.kind} cannot carry a corner radius. Roundable primitives: ${Object.keys(ROUNDABLE).join(', ')}.`,
    };
  }
  if (!Number.isFinite(r) || r < 0) return { ok: false, reason: `Radius must be a positive number — got ${radiusMm}.` };
  if (r === 0) return { ok: true, radiusMm: 0, note: 'Zero radius — sharp corners.' };

  const max = maxCornerRadiusMm(mesh);
  const dims = trueDimsMm(mesh);
  if (r > max) {
    return {
      ok: false,
      reason: `Radius ${r} mm exceeds the available local geometry. `
        + `This body is ${dims.map((d) => d.toFixed(1)).join(' × ')} mm, so its smallest dimension `
        + `allows at most ${max.toFixed(2)} mm before opposite corner arcs would intersect.`,
      maxRadiusMm: +max.toFixed(3),
    };
  }
  // A radius close to the limit leaves almost no flat face — legal, worth saying.
  const flatFraction = 1 - (2 * r) / Math.min(...dims);
  return {
    ok: true, radiusMm: r, maxRadiusMm: +max.toFixed(3),
    ...(flatFraction < 0.1
      ? { note: `At ${r} mm the smallest face is ${(flatFraction * 100).toFixed(0)}% flat — this is nearly a full round.` }
      : {}),
  };
}

/** A box with real rounded (or chamfered) edges, built at true size. */
export function roundedBoxGeometry(mesh) {
  const [w, h, d] = trueDimsMm(mesh).map(toSceneUnits);
  const style = CORNER_STYLES[mesh.cornerStyle] || CORNER_STYLES.round;
  const rMm = Math.min(Number(mesh.cornerRadius_mm) || 0, maxCornerRadiusMm(mesh));
  const r = toSceneUnits(rMm);
  const seg = Number(mesh.cornerSegments) || style.segments;
  // RoundedBoxGeometry refuses a radius of exactly half the smallest side;
  // pull back by a hair so the limit case still builds.
  const safe = Math.min(r, Math.min(w, h, d) / 2 - 1e-6);
  return new RoundedBoxGeometry(w, h, d, Math.max(1, seg), Math.max(safe, 1e-6));
}

/**
 * A cylinder whose two rim edges are broken by a real arc (or chamfer),
 * as a surface of revolution. Exact, not an approximation of one.
 */
export function roundedCylinderGeometry(mesh) {
  const [dia, height] = trueDimsMm(mesh).map(toSceneUnits);
  const R = dia / 2;
  const H = height;
  const style = CORNER_STYLES[mesh.cornerStyle] || CORNER_STYLES.round;
  const rMm = Math.min(Number(mesh.cornerRadius_mm) || 0, maxCornerRadiusMm(mesh));
  const r = Math.min(toSceneUnits(rMm), R - 1e-6, H / 2 - 1e-6);
  const radial = Math.max(8, Number(mesh.segments) || 48);

  if (!(r > 1e-6)) return new THREE.CylinderGeometry(R, R, H, radial);

  const arcSteps = style.id === 'chamfer' ? 1 : Math.max(2, style.segments);
  const pts = [];
  pts.push(new THREE.Vector2(0, -H / 2));
  pts.push(new THREE.Vector2(R - r, -H / 2));
  for (let i = 0; i <= arcSteps; i++) {              // bottom rim
    const a = -Math.PI / 2 + (i / arcSteps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - r + r * Math.cos(a), -H / 2 + r + r * Math.sin(a)));
  }
  for (let i = 0; i <= arcSteps; i++) {              // top rim
    const a = (i / arcSteps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - r + r * Math.cos(a), H / 2 - r + r * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, H / 2));
  return new THREE.LatheGeometry(pts, radial);
}

/** True when this mesh's geometry already carries its scale. */
export function hasBakedScale(mesh) {
  return Boolean(Number(mesh?.cornerRadius_mm) > 0 && isRoundable(mesh?.kind));
}
