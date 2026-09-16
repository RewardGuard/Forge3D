// Parametric feature history — point 5 of the spec.
//
// A body is its BASE primitive plus an ordered list of FEATURES. The
// geometry you see is the result of replaying that list through the kernel.
// Change a fillet radius, disable a chamfer, resize the base — and the body
// regenerates. Nothing is baked until you ask for it; the primitive is never
// lost.
//
// This is how every parametric CAD works, and it comes with the same honest
// limitation they all have: a feature that selects edges refers to the edges
// of the shape AT THAT STEP. If an earlier feature changes the topology, the
// indices can point at different edges (the "topological naming problem").
// Forge3D does not pretend to have solved it — a feature that no longer
// applies fails with its reason, and the last valid geometry is kept.
//
// Point 15 rule enforced here: regeneration never destroys a valid model. If
// feature N fails, features 1..N-1 are shown, N is flagged, and the body's
// previous geometry stays until the user fixes it.

import { useStore } from './store.js';
import { kernel, filletEdges, chamferEdges, shell, tessellate, topologyOf, validateRemoval, edgePolylines } from './kernel.js';
import { meshToShape, kernelSupports, shapeToBaked } from './kernelBridge.js';
import { trueDimsMm } from './rounding.js';

export const FEATURE_TYPES = {
  fillet:  { label: 'Fillet',  params: { radius_mm: 2, edgeIndices: null }, icon: '◠' },
  chamfer: { label: 'Chamfer', params: { distance_mm: 1, edgeIndices: null }, icon: '◺' },
  shell:   { label: 'Shell',   params: { thickness_mm: 1.5, openFace: 0 }, icon: '▢' },
};

export function newFeature(type, params = {}) {
  const def = FEATURE_TYPES[type];
  if (!def) throw new Error(`Unknown feature type "${type}"`);
  return { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, params: { ...def.params, ...params }, enabled: true };
}

/** One-line description for the timeline. */
export function describeFeature(f) {
  const p = f.params || {};
  const sel = p.edgeIndices?.length ? `${p.edgeIndices.length} edge${p.edgeIndices.length === 1 ? '' : 's'}` : 'all edges';
  if (f.type === 'fillet') return `Fillet r=${p.radius_mm} mm · ${sel}`;
  if (f.type === 'chamfer') return `Chamfer ${p.distance_mm} mm · ${sel}`;
  if (f.type === 'shell') return `Shell ${p.thickness_mm} mm wall${p.openFace == null ? ' · sealed' : ''}`;
  return f.type;
}

// Stable hash of what the geometry depends on, so we only regenerate on change.
export function featureSignature(mesh) {
  return JSON.stringify({ k: mesh.kind, s: mesh.scale, f: (mesh.features || []).map((f) => [f.type, f.enabled, f.params]) });
}

// Per-edge radius limit, mirrored from kernelBridge so a pre-check can name
// the offending edge before the kernel is asked.
function edgeLimit(mesh, edge) {
  const [w, h, d] = trueDimsMm(mesh);
  if (mesh.kind === 'cylinder' || mesh.kind === 'cone') return Math.min(w / 2, h / 2);
  if (mesh.kind === 'sphere') return 0;
  const [p0, p1] = edge.points; if (!p0 || !p1) return Math.min(w, h, d) / 2;
  const dx = Math.abs(p1[0] - p0[0]), dy = Math.abs(p1[1] - p0[1]), dz = Math.abs(p1[2] - p0[2]);
  if (dx >= dy && dx >= dz) return Math.min(h, d) / 2;
  if (dy >= dx && dy >= dz) return Math.min(w, d) / 2;
  return Math.min(w, h) / 2;
}

/**
 * Replay the feature list. Returns
 *   { ok, shape, geom, steps: [{ id, ok, reason, faces }], failedAt }
 * `steps` reports every feature so the timeline can mark the one that broke.
 */
export async function regenerate(mesh) {
  if (!kernelSupports(mesh?.kind)) return { ok: false, reason: `${mesh?.kind} is not a kernel solid — features need box, plane, cylinder, sphere or cone.` };
  let shape;
  try { shape = await meshToShape(mesh); }
  catch (e) { return { ok: false, reason: `Could not build the base solid: ${String(e?.message || e).slice(0, 100)}` }; }
  const steps = [];
  let failedAt = null;
  const features = (mesh.features || []);

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (!f.enabled) { steps.push({ id: f.id, ok: true, skipped: true }); continue; }
    const before = await topologyOf(shape);
    let res;
    try {
      if (f.type === 'fillet' || f.type === 'chamfer') {
        // pre-check radius against the CURRENT shape's edges (only exact for
        // the base primitive; later steps rely on the kernel + volume gate)
        const r = Number(f.type === 'fillet' ? f.params.radius_mm : f.params.distance_mm);
        if (i === 0 || features.slice(0, i).every((x) => !x.enabled)) {
          const polys = await edgePolylines(shape, 2);
          const chosen = f.params.edgeIndices ? polys.filter((e) => f.params.edgeIndices.includes(e.index)) : polys;
          if (!chosen.length) { res = { ok: false, reason: 'No edge matched the selection — the shape may have changed.' }; }
          else {
            const worst = chosen.reduce((a, e) => { const l = edgeLimit(mesh, e); return l < a.lim ? { lim: l, e } : a; }, { lim: Infinity, e: null });
            if (r >= worst.lim - 1e-6) res = { ok: false, reason: `${r} mm exceeds the ${worst.lim.toFixed(2)} mm this geometry can carry on edge ${worst.e.index}.`, maxMm: worst.lim };
          }
        }
        if (!res) res = f.type === 'fillet'
          ? await filletEdges(shape, r, f.params.edgeIndices || null)
          : await chamferEdges(shape, r, f.params.edgeIndices || null);
      } else if (f.type === 'shell') {
        res = await shell(shape, f.params.thickness_mm, f.params.openFace ?? 0);
      } else res = { ok: false, reason: `Unknown feature "${f.type}".` };

      if (res.ok) {
        const gate = await validateRemoval(shape, res.shape, f.type);
        if (!gate.valid) res = { ok: false, reason: gate.reason };
      }
    } catch (e) {
      res = { ok: false, reason: String(e?.message || e).slice(0, 140) };
    }

    if (res.ok) {
      shape = res.shape;
      const after = await topologyOf(shape);
      steps.push({ id: f.id, ok: true, faces: `${before.faces}→${after.faces}` });
    } else {
      steps.push({ id: f.id, ok: false, reason: res.reason, maxMm: res.maxMm });
      failedAt = f.id;
      break;   // point 15: stop here, keep what was valid
    }
  }

  const baked = await shapeToBaked(shape, { deflectionMm: 0.05 });
  return { ok: failedAt === null, shape, geom: baked.geom, half: baked.half, halfY: baked.halfY, triangles: baked.triangles, steps, failedAt };
}

/**
 * The body's FINAL solid — base plus every enabled feature that applies.
 * STEP export and measurement use this, so a filleted body exports and
 * weighs as filleted. Falls back to the base if a feature fails.
 */
export async function featuredShape(mesh) {
  if (!(mesh?.features || []).some((f) => f.enabled)) return meshToShape(mesh);
  const r = await regenerate(mesh);
  return r.shape || meshToShape(mesh);
}

// ── Store integration: debounced regeneration per body ────────────────────
const timers = new Map();
const inflight = new Map();

/** Schedule a regeneration; coalesces rapid edits (slider drags). */
export function scheduleRegenerate(meshId, delay = 120) {
  clearTimeout(timers.get(meshId));
  timers.set(meshId, setTimeout(() => runRegenerate(meshId), delay));
}

export async function runRegenerate(meshId) {
  const mesh = useStore.getState().meshes.find((m) => m.id === meshId);
  if (!mesh) return;
  const sig = featureSignature(mesh);
  if (mesh.featureSig === sig && mesh.featureGeom) return;      // nothing changed
  if (inflight.get(meshId) === sig) return;                       // already running this exact state
  inflight.set(meshId, sig);
  useStore.getState().patchMesh?.(meshId, { featureBusy: true });
  try {
    const r = await regenerate(mesh);
    const stillSame = useStore.getState().meshes.find((m) => m.id === meshId);
    if (!stillSame || featureSignature(stillSame) !== sig) return;   // edited again meanwhile — a newer run will land
    if (!(mesh.features || []).some((f) => f.enabled)) {
      // no active features → back to the plain primitive
      useStore.getState().patchMesh(meshId, { featureGeom: null, featureHalf: null, featureSig: sig, featureSteps: r.steps || [], featureError: null, featureBusy: false });
      return;
    }
    useStore.getState().patchMesh(meshId, {
      featureGeom: r.geom ? { positions: r.geom.positions, normals: r.geom.normals } : stillSame.featureGeom,
      featureHalf: r.half || stillSame.featureHalf,
      featureSig: sig,
      featureSteps: r.steps || [],
      featureError: r.ok ? null : (r.reason || r.steps?.find((s) => !s.ok)?.reason || 'A feature failed.'),
      featureBusy: false,
    });
  } catch (e) {
    useStore.getState().patchMesh(meshId, { featureError: String(e?.message || e).slice(0, 140), featureBusy: false });
  } finally {
    if (inflight.get(meshId) === sig) inflight.delete(meshId);
  }
}
