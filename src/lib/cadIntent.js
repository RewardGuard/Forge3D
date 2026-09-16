// Validated CAD operations — how Orchestra changes a model.
//
// Point 7 asks for a copilot that performs CAD operations rather than
// describing them. Point 19 asks that every change be inspectable, and
// acceptable/rejectable. Point 18 forbids faking capability. Those three
// together produce this shape:
//
//   plan(ctx, args)  ->  a PROPOSAL (a diff, nothing mutated yet)
//                        or a REFUSAL naming the missing capability
//   apply(proposal)  ->  snapshot, mutate, RE-MEASURE, return the real delta
//   revert(token)    ->  restore the snapshot
//
// Orchestra never writes to the store directly. It picks an operation and
// supplies arguments; the operation validates, and predictions are always
// checked against a fresh measurement after applying, so a claim like
// "18.4% lighter" is measured, not asserted.

import { useStore } from './store.js';
import { MATERIALS, hasStructuralData } from './materials.js';
import { buildModelContext, bodyMass } from './modelContext.js';
import { CAPABILITIES } from './engineeringReport.js';
import { isRoundable, validateCornerRadius, maxCornerRadiusMm, CORNER_STYLES, ROUNDABLE } from './rounding.js';

const PROTECTED_DEFAULT = ['mounting', 'electronic'];

function refuse(op, capabilityId, extra = {}) {
  const cap = CAPABILITIES[capabilityId] || {};
  return {
    ok: false, refused: true, op,
    capability: capabilityId,
    reason: cap.reason || 'This operation is not supported.',
    wouldNeed: cap.wouldNeed || null,
    alternatives: extra.alternatives || [],
    ...extra,
  };
}

function bad(op, reason, alternatives = []) {
  return { ok: false, refused: false, op, reason, alternatives };
}

// Which bodies may be touched, and which are off limits.
function partition(ctx, { preserve = PROTECTED_DEFAULT, only = null } = {}) {
  const preserveSet = new Set(preserve);
  const protectedIds = new Set();
  const editable = [];
  for (const b of ctx.bodies) {
    const isProtected = preserveSet.has(b.role) || preserveSet.has(b.id);
    if (isProtected) { protectedIds.add(b.id); continue; }
    if (only && !only.includes(b.id)) continue;
    editable.push(b);
  }
  return { editable, protectedIds: [...protectedIds] };
}

export const OPERATIONS = {
  // ── The flagship example from the spec ─────────────────────────────────
  // "Make this enclosure 20% lighter while maintaining the same mounting points."
  lighten: {
    id: 'lighten',
    label: 'Reduce mass',
    params: { targetPct: 'number (percent to remove)', preserve: 'string[] of roles or body ids', strategy: 'auto|material|scale' },
    plan(ctx, { targetPct, preserve = PROTECTED_DEFAULT, strategy = 'auto' } = {}) {
      const pct = Number(targetPct);
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
        return bad('lighten', `targetPct must be between 0 and 100 — got ${targetPct}.`);
      }
      if (!ctx.bodyCount) return bad('lighten', 'There is nothing in the model to lighten.');

      const { editable, protectedIds } = partition(ctx, { preserve });
      if (!editable.length) {
        return bad('lighten', `Every body is protected by preserve=[${preserve.join(', ')}], so there is nothing left to change.`,
          ['Relax the preserve list', 'Name specific bodies to modify']);
      }

      const totalMass = ctx.massProperties.totalMass_g;
      const targetMass = totalMass * (1 - pct / 100);
      const removeG = totalMass - targetMass;
      const editableMass = editable.reduce((a, b) => a + b.mass_g, 0);

      if (removeG > editableMass) {
        return bad('lighten',
          `Removing ${removeG.toFixed(1)} g needs more than the ${editableMass.toFixed(1)} g held by the editable bodies. ` +
          `The protected bodies (${protectedIds.join(', ') || 'none'}) hold the rest.`,
          [`Target at most ${((editableMass / totalMass) * 100).toFixed(1)}%`, 'Unprotect some bodies', 'Try a lower-density material instead']);
      }

      // STRATEGY A — swap material. Preserves every dimension, which is what
      // "keep the mounting points" usually means, so it is tried first.
      if (strategy === 'auto' || strategy === 'material') {
        const byBody = new Map(editable.map((b) => [b.id, b]));
        const currentKeys = [...new Set(editable.map((b) => b.material.key))];
        // Only consider materials we have full structural data for.
        // Only materials we hold full structural data for are candidates —
        // swapping to something we cannot characterise is not an engineering answer.
        const candidates = Object.keys(MATERIALS)
          .filter((k) => hasStructuralData(k) && !currentKeys.includes(k));
        let best = null;
        for (const k of candidates) {
          const after = editable.reduce((a, b) => a + b.volume_cm3 * MATERIALS[k].density, 0);
          const newTotal = totalMass - editableMass + after;
          const achieved = ((totalMass - newTotal) / totalMass) * 100;
          if (achieved >= pct) {
            const overshoot = achieved - pct;
            if (!best || overshoot < best.overshoot) best = { key: k, newTotal, achieved, overshoot };
          }
        }
        if (best) {
          const from = currentKeys.join('/');
          const stiffnessNote = compareStiffness(currentKeys, best.key);
          return {
            ok: true, op: 'lighten', strategy: 'material',
            changes: editable.map((b) => ({
              bodyId: b.id, label: b.label, field: 'material',
              from: b.material.key, to: best.key,
            })),
            preserved: protectedIds,
            predicted: {
              massBefore_g: +totalMass.toFixed(2),
              massAfter_g: +best.newTotal.toFixed(2),
              deltaPct: +(-best.achieved).toFixed(2),
            },
            explanation: {
              headline: `Switch ${editable.length} ${editable.length === 1 ? 'body' : 'bodies'} from ${from} to ${MATERIALS[best.key].name}`,
              bullets: [
                `Mass ${totalMass.toFixed(1)} g → ${best.newTotal.toFixed(1)} g (${best.achieved.toFixed(1)}% lighter)`,
                ...(best.overshoot > 2
                  ? [`You asked for ${pct}%. No available material lands near that — ${MATERIALS[best.key].name} is the closest that still meets it, overshooting by ${best.overshoot.toFixed(1)} points. Accept it, lower the target, or use strategy "scale".`]
                  : []),
                `Every dimension is unchanged — mounting positions and hole spacing are preserved exactly`,
                `Protected: ${protectedIds.length ? protectedIds.join(', ') : 'nothing needed protecting'}`,
                stiffnessNote,
              ],
              reason: 'Changing material reaches the mass target without touching geometry, so nothing that mates with another part moves.',
              caveats: [
                `${MATERIALS[best.key].grade} — handbook values, not certified lot data.`,
                'Stress and deflection were NOT re-checked: Forge3D has no FEA solver, so a stiffness change cannot be validated here.',
                'Cost was not considered — Forge3D holds no raw-material pricing, and a material swap can change part cost by an order of magnitude.',
              ],
            },
            reversible: true,
          };
        }
        if (strategy === 'material') {
          return bad('lighten', `No available material is light enough to remove ${pct}% while keeping the geometry.`,
            ['Use strategy "scale" to shrink non-protected bodies', 'Lower the target']);
        }
      }

      // STRATEGY B — shrink the editable bodies. Changes external dimensions,
      // and says so loudly.
      const newEditableMass = editableMass - removeG;
      const volRatio = newEditableMass / editableMass;
      const f = Math.cbrt(volRatio);

      const contained = protectedStillContained(ctx, editable, protectedIds, f);
      if (!contained.ok) {
        return bad('lighten',
          `Shrinking by ${((1 - f) * 100).toFixed(1)}% would leave protected ${contained.escaped.length === 1 ? 'body' : 'bodies'} ` +
          `outside the shrunken geometry: ${contained.escaped.map((e) => `${e.label} (${e.id}, ${e.axis}-axis)`).join(', ')}. ` +
          `The mass target is reachable arithmetically, but the result would not be a valid assembly.`,
          [
            `Target at most about ${(maxSafePct(ctx, editable, protectedIds) ?? 0).toFixed(0)}% with this strategy`,
            'Use strategy "material" to keep every dimension',
            'Unprotect the mounting bodies so they scale too',
          ]);
      }

      return {
        ok: true, op: 'lighten', strategy: 'scale',
        changes: editable.map((b) => ({
          bodyId: b.id, label: b.label, field: 'scale',
          from: b.scale, to: scaleBy(b.scale, f),
          sizeBefore_mm: b.boundingBox_mm,
          sizeAfter_mm: b.boundingBox_mm ? b.boundingBox_mm.map((v) => +(v * f).toFixed(2)) : null,
        })),
        preserved: protectedIds,
        predicted: {
          massBefore_g: +totalMass.toFixed(2),
          massAfter_g: +targetMass.toFixed(2),
          deltaPct: -pct,
        },
        explanation: {
          headline: `Shrink ${editable.length} non-protected ${editable.length === 1 ? 'body' : 'bodies'} by ${((1 - f) * 100).toFixed(1)}% linearly`,
          bullets: [
            `Mass ${totalMass.toFixed(1)} g → ${targetMass.toFixed(1)} g (${pct}% lighter)`,
            `Linear scale factor ${f.toFixed(4)} (volume scales with the cube)`,
            `Protected and untouched: ${protectedIds.length ? protectedIds.join(', ') : 'none'}`,
            'EXTERNAL DIMENSIONS CHANGE — anything mating with these bodies must be re-checked.',
          ],
          reason: 'No lighter material could reach the target, so mass is removed by reducing volume.',
          caveats: [
            'This shrinks bodies; it does not hollow them. Forge3D has no shell operation on primitives, which is what a real lightening pass would use.',
            'Wall thickness shrinks with everything else and may drop below the process minimum — re-run the manufacturing analysis.',
            'Stress and deflection were NOT evaluated.',
          ],
        },
        reversible: true,
      };
    },
  },

  set_material: {
    id: 'set_material',
    label: 'Change material',
    params: { bodyIds: 'string[]', material: 'material key' },
    plan(ctx, { bodyIds = [], material } = {}) {
      if (!MATERIALS[material]) {
        return bad('set_material', `Unknown material "${material}". Known: ${Object.keys(MATERIALS).join(', ')}.`);
      }
      const targets = ctx.bodies.filter((b) => bodyIds.includes(b.id));
      if (!targets.length) return bad('set_material', `No body matched ${JSON.stringify(bodyIds)}.`);
      const before = ctx.massProperties.totalMass_g;
      const after = before - targets.reduce((a, b) => a + b.mass_g, 0)
        + targets.reduce((a, b) => a + b.volume_cm3 * MATERIALS[material].density, 0);
      return {
        ok: true, op: 'set_material', strategy: 'material',
        changes: targets.map((b) => ({ bodyId: b.id, label: b.label, field: 'material', from: b.material.key, to: material })),
        preserved: [],
        predicted: { massBefore_g: +before.toFixed(2), massAfter_g: +after.toFixed(2), deltaPct: +(((after - before) / before) * 100).toFixed(2) },
        explanation: {
          headline: `Set ${targets.length} ${targets.length === 1 ? 'body' : 'bodies'} to ${MATERIALS[material].name}`,
          bullets: [
            `Mass ${before.toFixed(1)} g → ${after.toFixed(1)} g`,
            `Geometry unchanged`,
            compareStiffness([...new Set(targets.map((b) => b.material.key))], material),
          ],
          reason: 'Direct material assignment.',
          caveats: [`${MATERIALS[material].grade} — handbook values, not certified lot data.`],
        },
        reversible: true,
      };
    },
  },

  // ── Honest refusals ────────────────────────────────────────────────────
  // The spec's other two examples land here. Both are legitimate requests
  // that Forge3D genuinely cannot serve, so it says exactly why instead of
  // producing something that looks like an answer.
  // Real corner geometry on primitives. This USED to be a blanket refusal,
  // which was over-broad: a box with a corner radius is an exactly-defined
  // solid that exports correctly. The refusal now applies only to what
  // genuinely needs B-rep — arbitrary edge selection on arbitrary solids.
  round_corners: {
    id: 'round_corners',
    label: 'Round or chamfer corners',
    params: { radius_mm: 'number', style: 'round|chamfer', bodyIds: 'string[] (default: all roundable)', preserve: 'string[] of roles' },
    plan(ctx, { radius_mm, style = 'round', bodyIds = null, preserve = PROTECTED_DEFAULT } = {}) {
      const r = Number(radius_mm);
      if (!Number.isFinite(r) || r < 0) return bad('round_corners', `radius_mm must be a positive number — got ${radius_mm}.`);
      if (!CORNER_STYLES[style]) return bad('round_corners', `Unknown corner style "${style}". Use: ${Object.keys(CORNER_STYLES).join(' or ')}.`);

      const { editable, protectedIds } = partition(ctx, { preserve, only: bodyIds });
      const meshes = useStore.getState().meshes || [];
      const roundable = [];
      const skipped = [];
      for (const b of editable) {
        const mesh = meshes.find((m) => m.id === b.id);
        if (!mesh) continue;
        if (!isRoundable(mesh.kind)) { skipped.push({ id: b.id, label: b.label, why: `${mesh.kind} has no corner to round` }); continue; }
        const chk = validateCornerRadius(mesh, r);
        if (!chk.ok) { skipped.push({ id: b.id, label: b.label, why: chk.reason, maxRadiusMm: chk.maxRadiusMm }); continue; }
        roundable.push({ body: b, mesh, check: chk });
      }

      if (!roundable.length) {
        const worst = skipped.find((x) => Number.isFinite(x.maxRadiusMm));
        return bad('round_corners',
          skipped.length
            ? `No body can take a ${r} mm radius. ${skipped[0].why}`
            : 'There is nothing roundable in the selection.',
          [
            ...(worst ? [`Try ${worst.maxRadiusMm} mm — the largest this geometry allows`] : []),
            `Roundable primitives: ${Object.keys(ROUNDABLE).join(', ')}`,
          ]);
      }

      return {
        ok: true, op: 'round_corners', strategy: style,
        changes: roundable.map(({ body, mesh }) => ({
          bodyId: body.id, label: body.label, field: 'cornerRadius_mm',
          from: Number(mesh.cornerRadius_mm) || 0, to: r,
          style, maxRadiusMm: +maxCornerRadiusMm(mesh).toFixed(3),
        })),
        preserved: protectedIds,
        predicted: {
          massBefore_g: ctx.massProperties.totalMass_g,
          massAfter_g: ctx.massProperties.totalMass_g,
          deltaPct: 0,
        },
        explanation: {
          headline: `${style === 'chamfer' ? 'Chamfer' : 'Round'} ${roundable.length} ${roundable.length === 1 ? 'body' : 'bodies'} at ${r} mm`,
          bullets: [
            `${CORNER_STYLES[style].detail}`,
            `Applied to: ${roundable.map((x) => x.body.label).join(', ')}`,
            ...(protectedIds.length ? [`Protected and untouched: ${protectedIds.join(', ')}`] : []),
            ...skipped.map((x) => `SKIPPED ${x.label}: ${x.why}`),
            'The radius is baked into the geometry at true size, so it stays circular even on a stretched body.',
          ],
          reason: 'Corner radius is real geometry on these primitives — it tessellates and exports as a solid, not a shading effect.',
          caveats: [
            'Mass is reported unchanged: the material removed at the corners is below the resolution of the primitive volume model.',
            'This rounds ALL of a primitive\'s corners. Selecting individual edges needs a B-rep kernel Forge3D does not have.',
          ],
        },
        reversible: true,
      };
    },
  },

  // Still refused, but now only for what actually needs B-rep.
  fillet_edges: {
    id: 'fillet_edges',
    label: 'Fillet selected edges',
    params: { radius_mm: 'number', edges: 'selection' },
    plan(ctx, { radius_mm } = {}) {
      return refuse('fillet_edges', 'draft_angle', {
        reason: 'Filleting INDIVIDUAL selected edges needs edge and face topology, and Forge3D composes from primitives with no B-rep kernel — there are no edges to select.',
        wouldNeed: 'A boundary-representation kernel (edges, faces, loops) with a rolling-ball blend, plus tangency and continuity handling.',
        alternatives: [
          `Use round_corners to round every corner of a primitive at once${Number.isFinite(Number(radius_mm)) ? ` (radius ${radius_mm} mm)` : ''} — that IS real geometry`,
          'Model the blend explicitly as a separate primitive where it matters',
          'Export STL and fillet in a B-rep CAD package',
        ],
        note: 'Forge3D will not apply a cosmetic shader round and call it a fillet.',
      });
    },
  },

  optimize_under_load: {
    id: 'optimize_under_load',
    label: 'Stiffen under a load case',
    params: { load_N: 'number', maxDeflection_mm: 'number', keepFootprint: 'boolean' },
    plan(ctx, { load_N } = {}) {
      return refuse('optimize_under_load', 'stress', {
        reason: `Improving a part under ${load_N ? `${load_N} N` : 'a load'} requires knowing where it is overstressed. Forge3D has no FEA solver — there is no mesh, no stiffness matrix and no displacement field — so it cannot locate a weak region, and any "improvement" it proposed would be a guess dressed as analysis.`,
        wouldNeed: 'A tetrahedral mesher and a linear-elastic FEA solver, plus user-defined restraints and load cases. The material data needed (E, ν, yield) is already in place.',
        alternatives: [
          'Export STEP/STL to an FEA tool and bring the results back',
          'Increase section thickness manually and compare mass — Forge3D can measure that honestly',
          'Change to a stiffer material: set_material reports the modulus change',
        ],
      });
    },
  },
};


// After a scale-down, do the protected bodies still sit inside the envelope of
// the bodies being shrunk? A boss that ends up outside its shell is a broken
// design, however cleanly the mass arithmetic worked out.
function protectedStillContained(ctx, editable, protectedIds, f) {
  if (!protectedIds.length) return { ok: true, escaped: [] };
  const shrunk = editable.filter((b) => b.boundingBox_mm);
  if (!shrunk.length) return { ok: true, escaped: [] };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of shrunk) {
    for (let i = 0; i < 3; i++) {
      const half = (b.boundingBox_mm[i] * f) / 2;
      lo[i] = Math.min(lo[i], b.position_mm[i] - half);
      hi[i] = Math.max(hi[i], b.position_mm[i] + half);
    }
  }
  const escaped = [];
  for (const id of protectedIds) {
    const p = ctx.bodies.find((b) => b.id === id);
    if (!p || !p.boundingBox_mm) continue;
    for (let i = 0; i < 3; i++) {
      const half = p.boundingBox_mm[i] / 2;
      if (p.position_mm[i] - half < lo[i] - 1e-6 || p.position_mm[i] + half > hi[i] + 1e-6) {
        escaped.push({ id, label: p.label, axis: 'xyz'[i] });
        break;
      }
    }
  }
  return { ok: escaped.length === 0, escaped };
}


// The largest percentage this strategy can remove while the protected bodies
// stay contained. Used to give the user a number instead of a dead end.
function maxSafePct(ctx, editable, protectedIds) {
  const total = ctx.massProperties.totalMass_g;
  const editableMass = editable.reduce((a, b) => a + b.mass_g, 0);
  if (!total || !editableMass) return null;
  let lo = 0, hi = (editableMass / total) * 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const f = Math.cbrt((editableMass - total * (mid / 100)) / editableMass);
    if (Number.isFinite(f) && f > 0 && protectedStillContained(ctx, editable, protectedIds, f).ok) lo = mid;
    else hi = mid;
  }
  return lo;
}

function scaleBy(scale, f) {
  if (Array.isArray(scale)) return scale.map((v) => +(v * f).toFixed(6));
  return +((scale ?? 1) * f).toFixed(6);
}

function compareStiffness(fromKeys, toKey) {
  const from = fromKeys.map((k) => MATERIALS[k]?.youngsGPa).filter(Number.isFinite);
  const to = MATERIALS[toKey]?.youngsGPa;
  if (!from.length || !Number.isFinite(to)) return 'Stiffness comparison unavailable.';
  const avg = from.reduce((a, b) => a + b, 0) / from.length;
  const pct = ((to - avg) / avg) * 100;
  const dir = pct >= 0 ? 'stiffer' : 'less stiff';
  return `Young's modulus ${avg.toFixed(1)} → ${to.toFixed(1)} GPa (${Math.abs(pct).toFixed(0)}% ${dir}) — deflection under the same load changes inversely, but was NOT computed.`;
}

/** Plan an operation by id. Unknown ids refuse rather than throw. */
export function planOperation(opId, args = {}, ctx = null) {
  const op = OPERATIONS[opId];
  if (!op) return bad(opId, `Unknown operation "${opId}". Available: ${Object.keys(OPERATIONS).join(', ')}.`);
  const context = ctx || buildModelContext();
  try {
    return op.plan(context, args);
  } catch (e) {
    return bad(opId, `Operation failed to plan: ${String(e?.message || e)}`);
  }
}

// ── Apply / revert ────────────────────────────────────────────────────────
const snapshots = new Map();
let token = 0;

/**
 * Apply a proposal, then MEASURE the result. The returned `measured` block is
 * a fresh reading, never the prediction echoed back — if a prediction was
 * wrong, `predictionError` says so.
 */
export function applyProposal(proposal) {
  if (!proposal?.ok) return { applied: false, reason: proposal?.reason || 'Not an appliable proposal.' };
  const s = useStore.getState();
  const before = JSON.parse(JSON.stringify(s.meshes || []));
  const id = `chg${++token}`;
  snapshots.set(id, before);

  const byId = new Map(proposal.changes.map((c) => [c.bodyId, c]));
  const next = (s.meshes || []).map((m) => {
    const c = byId.get(m.id);
    if (!c) return m;
    if (c.field === 'material') return { ...m, material: c.to };
    if (c.field === 'scale') return { ...m, scale: c.to };
    if (c.field === 'cornerRadius_mm') return { ...m, cornerRadius_mm: c.to, cornerStyle: c.style || m.cornerStyle || 'round' };
    return m;
  });
  useStore.setState({ meshes: next });

  const after = buildModelContext();
  const measuredMass = after.massProperties.totalMass_g;
  const predicted = proposal.predicted?.massAfter_g;
  const err = Number.isFinite(predicted) && predicted !== 0
    ? +(((measuredMass - predicted) / predicted) * 100).toFixed(3)
    : null;

  return {
    applied: true,
    revertToken: id,
    changed: proposal.changes.length,
    measured: {
      massBefore_g: proposal.predicted?.massBefore_g ?? null,
      massAfter_g: measuredMass,
      deltaPct: proposal.predicted?.massBefore_g
        ? +(((measuredMass - proposal.predicted.massBefore_g) / proposal.predicted.massBefore_g) * 100).toFixed(2)
        : null,
      envelope_mm: after.massProperties.envelope_mm,
      centreOfMass_mm: after.massProperties.centreOfMass_mm,
    },
    predictionError_pct: err,
    // Any change invalidates prior analysis — the ladder must be re-run.
    invalidates: ['simulated', 'verified', 'manufacturing_analysis', 'manufacturing_ready'],
    note: 'Every analysis stage after "valid geometry" is now stale and must be re-run before this design can be called ready again.',
  };
}

export function revertProposal(revertToken) {
  const snap = snapshots.get(revertToken);
  if (!snap) return { reverted: false, reason: `Unknown revert token "${revertToken}".` };
  useStore.setState({ meshes: snap });
  snapshots.delete(revertToken);
  return { reverted: true, massNow_g: buildModelContext().massProperties.totalMass_g };
}

export function operationCatalog() {
  return Object.values(OPERATIONS).map((o) => ({ id: o.id, label: o.label, params: o.params }));
}
