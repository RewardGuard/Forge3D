// Assembly constraint solver — point 10 of the spec.
//
// Constraints are first-class objects between bodies. Each body that is not
// fixed has 6 degrees of freedom (3 translation, 3 rotation). A constraint
// contributes residual equations; the solver moves the free bodies until
// every residual is zero, by Levenberg–Marquardt on a numeric Jacobian —
// systems here are a handful of bodies, so that is fast and robust.
//
// THE PART THAT MATTERS TO AN ENGINEER: after solving, the Jacobian's rank
// says how the system is constrained.
//   rank < free DOF          → UNDER-constrained: N degrees of freedom remain
//   rank < equations, F ≈ 0  → REDUNDANT: some constraints repeat others
//   F ≉ 0 at the minimum      → CONFLICTING: they cannot all hold; the ones
//                              carrying the residual are named, with numbers.
// A conflict is explained, never silently "solved" to a compromise.
//
// Frames: positions in mm, rotations as XYZ Euler in radians. Body axes come
// from its rotation; a face is one of ±X ±Y ±Z of the body's local frame.

import { useStore } from './store.js';
import { trueDimsMm } from './rounding.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;
const toMm = (u) => u / MM;
const toScene = (mm) => mm * MM;

export const CONSTRAINT_TYPES = {
  fixed:        { label: 'Fixed',         arity: 1, dof: 6, params: {},                    hint: 'Lock this body where it is.' },
  coincident:   { label: 'Coincident',    arity: 2, dof: 3, params: {},                    hint: 'Origins meet.' },
  distance:     { label: 'Distance',      arity: 2, dof: 1, params: { mm: 20 },           hint: 'Origins this far apart.' },
  parallel:     { label: 'Parallel',      arity: 2, dof: 2, params: { axis: 'y' },         hint: 'The chosen axes point the same way.' },
  perpendicular:{ label: 'Perpendicular', arity: 2, dof: 1, params: { axis: 'y' },         hint: 'The chosen axes are at 90°.' },
  angle:        { label: 'Angle',         arity: 2, dof: 1, params: { axis: 'y', deg: 45 }, hint: 'The chosen axes at this angle.' },
  concentric:   { label: 'Concentric',    arity: 2, dof: 4, params: { axis: 'y' },         hint: 'Axes align on one line (shafts in holes).' },
  mate:         { label: 'Mate faces',    arity: 2, dof: 3, params: { faceA: '+y', faceB: '-y', gap: 0 }, hint: 'A face of A sits on a face of B.' },
  alongAxis:    { label: 'Offset along',  arity: 2, dof: 1, params: { axis: 'y', mm: 0 },   hint: 'B is this far from A along a world axis.' },
};

export function newConstraint(type, a, b = null, params = {}) {
  const def = CONSTRAINT_TYPES[type];
  if (!def) throw new Error(`Unknown constraint "${type}"`);
  return { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), type, a, b, params: { ...def.params, ...params }, enabled: true };
}

export function describeConstraint(c, labelOf = (id) => id) {
  const p = c.params || {};
  const A = labelOf(c.a), B = c.b ? labelOf(c.b) : '';
  switch (c.type) {
    case 'fixed': return `${A} fixed`;
    case 'coincident': return `${A} ∘ ${B} coincident`;
    case 'distance': return `${A} ↔ ${B} = ${p.mm} mm`;
    case 'parallel': return `${A} ∥ ${B} (${p.axis})`;
    case 'perpendicular': return `${A} ⊥ ${B} (${p.axis})`;
    case 'angle': return `${A} ∠ ${B} = ${p.deg}° (${p.axis})`;
    case 'concentric': return `${A} ◎ ${B} (${p.axis})`;
    case 'mate': return `${A}[${p.faceA}] ▬ ${B}[${p.faceB}]${p.gap ? ` gap ${p.gap} mm` : ''}`;
    case 'alongAxis': return `${B} = ${A} + ${p.mm} mm on ${p.axis}`;
    default: return c.type;
  }
}

// ── Kinematics ────────────────────────────────────────────────────────────
function rotMat([x, y, z]) {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // R = Rz · Ry · Rx  (three.js XYZ order)
  return [
    [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
    [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
    [-sy, sx * cy, cx * cy],
  ];
}
const mulv = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const faceVec = (f) => { const s = f[0] === '-' ? -1 : 1; const a = AXIS[f[1]] || AXIS.y; return a.map((v) => v * s); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(...a);

/** A body's pose in mm/rad, plus its half-extents (for mates). */
function poseOf(mesh, x, idx) {
  if (idx != null) return { p: [x[idx], x[idx + 1], x[idx + 2]], r: [x[idx + 3], x[idx + 4], x[idx + 5]], half: trueDimsMm(mesh).map((d) => d / 2) };
  return { p: (mesh.position || [0, 0, 0]).map(toMm), r: mesh.rotation || [0, 0, 0], half: trueDimsMm(mesh).map((d) => d / 2) };
}

// Residual equations for one constraint. Each returns an array of numbers
// (mm for lengths, dimensionless for directions — the LM damping copes).
function residuals(c, PA, PB) {
  const p = c.params || {};
  const RA = rotMat(PA.r), RB = PB ? rotMat(PB.r) : null;
  const axA = mulv(RA, AXIS[p.axis] || AXIS.y), axB = RB ? mulv(RB, AXIS[p.axis] || AXIS.y) : null;
  switch (c.type) {
    case 'fixed': return [...sub(PA.p, c._p0), ...sub(PA.r, c._r0).map((v) => v * 50)];   // rad scaled to mm-ish
    case 'coincident': return sub(PA.p, PB.p);
    case 'distance': return [norm(sub(PA.p, PB.p)) - Number(p.mm)];
    case 'parallel': return cross(axA, axB).map((v) => v * 50);
    case 'perpendicular': return [dot(axA, axB) * 50];
    case 'angle': return [(dot(axA, axB) - Math.cos((Number(p.deg) * Math.PI) / 180)) * 50];
    case 'concentric': { const d = sub(PB.p, PA.p); return [...cross(axA, axB).map((v) => v * 50), ...cross(axA, d)]; }
    case 'mate': {
      const nA = mulv(RA, faceVec(p.faceA)), nB = mulv(RB, faceVec(p.faceB));
      const halfA = PA.half['xyz'.indexOf(p.faceA[1])], halfB = PB.half['xyz'.indexOf(p.faceB[1])];
      const fa = PA.p.map((v, i) => v + nA[i] * halfA), fb = PB.p.map((v, i) => v + nB[i] * halfB);
      // normals anti-parallel (2 eq via cross) + faces in the same plane with a gap (1 eq)
      const anti = cross(nA, nB.map((v) => -v)).map((v) => v * 50);
      return [...anti, dot(sub(fb, fa), nA) + Number(p.gap || 0)];
    }
    case 'alongAxis': return [dot(sub(PB.p, PA.p), AXIS[p.axis] || AXIS.y) - Number(p.mm)];
    default: return [];
  }
}

// ── Solver ────────────────────────────────────────────────────────────────
/**
 * Solve the enabled constraints over the bodies they reference.
 * Returns { ok, status, poses, iterations, residual, report } and never
 * writes to the store — the caller applies `poses` if it accepts them.
 */
// conflictTol: a residual under this (mm, or the scaled dimensionless
// equivalent) is convergence noise, not a conflict — 50 µm is far finer than
// any assembly tolerance and far coarser than LM's floor.
export function solveConstraints(constraints, meshes, { maxIter = 80, tol = 1e-4, conflictTol = 0.05 } = {}) {
  const byId = Object.fromEntries(meshes.map((m) => [m.id, m]));
  const active = constraints.filter((c) => c.enabled && byId[c.a] && (c.b == null || byId[c.b]));
  const fixedIds = new Set(active.filter((c) => c.type === 'fixed').map((c) => c.a));
  const bodyIds = [...new Set(active.flatMap((c) => [c.a, c.b].filter(Boolean)))];
  const freeIds = bodyIds.filter((id) => !fixedIds.has(id));
  const idx = Object.fromEntries(freeIds.map((id, i) => [id, i * 6]));
  const dofTotal = freeIds.length * 6;

  // fixed constraints remember the pose they lock to
  for (const c of active) if (c.type === 'fixed') { const P = poseOf(byId[c.a]); c._p0 = P.p; c._r0 = P.r; }

  let x = [];
  for (const id of freeIds) { const P = poseOf(byId[id]); x.push(...P.p, ...P.r); }

  const F = (xv) => {
    const out = []; const owner = [];
    for (const c of active) {
      if (c.type === 'fixed' && !(c.a in idx)) continue;    // a fixed body that is not a variable contributes nothing
      const PA = poseOf(byId[c.a], xv, idx[c.a]);
      const PB = c.b ? poseOf(byId[c.b], xv, idx[c.b]) : null;
      const r = residuals(c, PA, PB);
      for (const v of r) { out.push(v); owner.push(c.id); }
    }
    return { out, owner };
  };

  if (!active.length) return { ok: true, status: 'none', poses: {}, iterations: 0, residual: 0, report: { free: freeIds, dofTotal, rank: 0, equations: 0, remainingDof: dofTotal, conflicts: [], redundant: 0, message: 'No constraints.' } };
  if (!freeIds.length) {
    const { out } = F(x);
    const res = norm(out);
    return { ok: res < tol, status: res < tol ? 'satisfied' : 'conflicting', poses: {}, iterations: 0, residual: res,
      report: { free: [], dofTotal: 0, rank: 0, equations: out.length, remainingDof: 0, conflicts: res < tol ? [] : active.map((c) => c.id), redundant: 0, message: 'Every body is fixed; nothing can move.' } };
  }

  const jacobian = (xv) => {
    const base = F(xv).out;
    const J = base.map(() => new Array(xv.length).fill(0));
    for (let j = 0; j < xv.length; j++) {
      const h = j % 6 < 3 ? 1e-3 : 1e-5;
      const xp = xv.slice(); xp[j] += h; const fp = F(xp).out;
      const xm = xv.slice(); xm[j] -= h; const fm = F(xm).out;
      for (let i = 0; i < base.length; i++) J[i][j] = (fp[i] - fm[i]) / (2 * h);
    }
    return { J, base };
  };

  let lambda = 1e-2, iterations = 0, res = Infinity;
  for (; iterations < maxIter; iterations++) {
    const { J, base } = jacobian(x);
    res = norm(base);
    if (res < tol) break;
    // (JᵀJ + λ diag) δ = -Jᵀ F
    const n = x.length, m = base.length;
    const A = Array.from({ length: n }, () => new Array(n).fill(0)); const g = new Array(n).fill(0);
    for (let i = 0; i < m; i++) for (let a = 0; a < n; a++) { g[a] -= J[i][a] * base[i]; for (let b = 0; b < n; b++) A[a][b] += J[i][a] * J[i][b]; }
    for (let a = 0; a < n; a++) A[a][a] += lambda * (A[a][a] || 1);
    const delta = solveLinear(A, g);
    if (!delta) { lambda *= 10; continue; }
    const xn = x.map((v, i) => v + delta[i]);
    const rn = norm(F(xn).out);
    if (rn < res) { x = xn; lambda = Math.max(lambda / 3, 1e-9); } else lambda = Math.min(lambda * 10, 1e6);
  }

  const { J, base } = jacobian(x);
  res = norm(base);
  const { owner } = F(x);
  const rank = matrixRank(J, 1e-6);
  const equations = base.length;
  const remainingDof = Math.max(0, dofTotal - rank);
  const redundant = Math.max(0, equations - rank);

  // which constraints carry residual?
  const perC = {};
  for (let i = 0; i < base.length; i++) perC[owner[i]] = Math.max(perC[owner[i]] || 0, Math.abs(base[i]));
  const conflicts = Object.entries(perC).filter(([, v]) => v > conflictTol).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, residual: +v.toFixed(4) }));

  let status, message;
  if (conflicts.length) {
    status = 'conflicting';
    const names = conflicts.map((c) => describeConstraint(active.find((a) => a.id === c.id), (id) => byId[id]?.label || id));
    message = `These cannot all hold: ${names.join('; ')}. The solver stopped at the best compromise (residual ${res.toFixed(3)}) — remove or change one.`;
  } else if (remainingDof > 0) {
    status = 'under';
    message = `Solved, but ${remainingDof} degree${remainingDof === 1 ? '' : 's'} of freedom remain${remainingDof === 1 ? 's' : ''} across ${freeIds.length} free ${freeIds.length === 1 ? 'body' : 'bodies'}. The assembly can still move.${redundant ? ` ${redundant} constraint equation${redundant === 1 ? ' is' : 's are'} redundant.` : ''}`;
  } else if (redundant > 0) {
    status = 'over';
    message = `Fully constrained, with ${redundant} redundant equation${redundant === 1 ? '' : 's'} — some constraints repeat what others already enforce. Consistent, but removing the extras makes edits predictable.`;
  } else {
    status = 'exact';
    message = `Fully constrained: ${rank} equations lock all ${dofTotal} degrees of freedom exactly.`;
  }

  const poses = {};
  for (const id of freeIds) { const i = idx[id]; poses[id] = { position: [x[i], x[i + 1], x[i + 2]].map(toScene), rotation: [x[i + 3], x[i + 4], x[i + 5]] }; }
  return { ok: status !== 'conflicting', status, poses, iterations, residual: res, report: { free: freeIds, fixed: [...fixedIds], dofTotal, rank, equations, remainingDof, redundant, conflicts, message } };
}

// Gaussian elimination with partial pivoting.
function solveLinear(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function matrixRank(J, tol) {
  const M = J.map((r) => r.slice()); const rows = M.length, cols = M[0]?.length || 0;
  let rank = 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = rank; for (let r = rank + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < tol) continue;
    [M[rank], M[piv]] = [M[piv], M[rank]];
    for (let r = 0; r < rows; r++) { if (r === rank) continue; const f = M[r][c] / M[rank][c]; for (let k = c; k < cols; k++) M[r][k] -= f * M[rank][k]; }
    rank++;
  }
  return rank;
}

/** Solve the store's constraints and, if accepted, apply the poses. */
export function solveAndApply({ apply = true } = {}) {
  const s = useStore.getState();
  const r = solveConstraints(s.constraints || [], s.meshes || []);
  if (apply && r.ok && Object.keys(r.poses).length) {
    useStore.setState({ meshes: s.meshes.map((m) => (r.poses[m.id] ? { ...m, position: r.poses[m.id].position, rotation: r.poses[m.id].rotation } : m)) });
  }
  return r;
}
