// Engineering readiness — the staged model that replaces a single boolean "ok".
//
// THE PROBLEM THIS EXISTS TO FIX
// Forge3D used to finish a simulation and present the design as manufacturable.
// Those are different engineering stages separated by analysis nobody had run.
// A passing simulation says "the parts did not fall over in a rigid-body
// animation". It says nothing about stress, tolerance, draft, or whether a
// tool can physically reach the pocket you drew.
//
// The ladder is strict: a stage cannot pass unless every stage before it did.
// MANUFACTURING_READY is never reached by simulating.
//
// Every stage reports the METHOD used and its LIMITATIONS. Where Forge3D has
// no solver, the stage is NOT_SUPPORTED with an explanation of what would be
// required — it never invents a number to fill the gap.

import { MATERIALS, hasStructuralData, strengthLimit } from './materials.js';

export const STAGE = {
  DESIGNED: 'designed',
  VALID_GEOMETRY: 'valid_geometry',
  SIMULATED: 'simulated',
  VERIFIED: 'verified',
  MANUFACTURING_ANALYSIS: 'manufacturing_analysis',
  MANUFACTURING_READY: 'manufacturing_ready',
};

export const STAGE_ORDER = [
  STAGE.DESIGNED, STAGE.VALID_GEOMETRY, STAGE.SIMULATED,
  STAGE.VERIFIED, STAGE.MANUFACTURING_ANALYSIS, STAGE.MANUFACTURING_READY,
];

export const STAGE_LABEL = {
  [STAGE.DESIGNED]: 'Designed',
  [STAGE.VALID_GEOMETRY]: 'Valid geometry',
  [STAGE.SIMULATED]: 'Simulated',
  [STAGE.VERIFIED]: 'Verified',
  [STAGE.MANUFACTURING_ANALYSIS]: 'Manufacturing analysis',
  [STAGE.MANUFACTURING_READY]: 'Manufacturing ready',
};

export const STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
  NOT_RUN: 'not_run',
  NOT_SUPPORTED: 'not_supported',
  PARTIAL: 'partial',
};

// ── What Forge3D can and cannot actually compute ──────────────────────────
// This table is the honesty backbone. Anything claiming an engineering result
// must cite an entry here, and anything absent from it cannot be claimed.
export const CAPABILITIES = {
  mass_properties: {
    supported: true, confidence: 'high',
    method: 'Analytic volume of each primitive × material density; centre of mass from the weighted body centroids.',
    limitations: [
      'Assumes solid bodies at 100% infill — an FDM part at 20% infill weighs far less.',
      'Ignores fillets, chamfers and internal voids not modelled as explicit cutouts.',
    ],
  },
  static_stability: {
    supported: true, confidence: 'medium',
    method: 'Rigid-body statics: centre of mass projected onto the convex hull of the support polygon.',
    limitations: [
      'Static only — says nothing about tipping under acceleration, vibration or impact.',
      'Assumes a rigid, level, high-friction surface.',
    ],
  },
  interference: {
    supported: true, confidence: 'high',
    method: 'Axis-aligned bounding-box overlap between bodies, excluding declared assembly contacts.',
    limitations: [
      'AABB is conservative: rotated or concave parts can report a clash where the real solids miss.',
      'Does not sweep moving parts through their full range of travel.',
    ],
  },
  wall_thickness: {
    supported: true, confidence: 'medium',
    method: 'Minimum primitive dimension per body compared against the process minimum.',
    limitations: [
      'Measures the smallest overall dimension, not a true medial-axis thickness field.',
      'A thin web inside an otherwise thick body will not be detected.',
    ],
  },
  build_volume: {
    supported: true, confidence: 'high',
    method: 'Overall bounding box compared against the machine envelope.',
    limitations: ['Does not attempt automatic orientation or part splitting.'],
  },
  thermal_transient: {
    supported: 'visual_only', confidence: 'none',
    method: 'Lumped-capacitance animation with a deliberately compressed time constant so heating is watchable.',
    limitations: [
      'NOT an engineering thermal result. The mass term is scaled by a sublinear exponent to keep sub-gram and kilo-scale parts on one timescale.',
      'No conduction network, no convection coefficient, no radiation.',
      'Use it to see which part gets hot first, never to size a heatsink.',
    ],
  },
  rigid_body_dynamics: {
    supported: 'visual_only', confidence: 'low',
    method: 'Rapier discrete rigid-body solver with approximated collision shapes.',
    limitations: [
      'Game-grade solver: contact softness, penetration recovery and restitution are tuned for stability, not measurement.',
      'Collision shapes are primitive approximations of the real geometry.',
      'Do not read forces, torques or reaction loads off it as engineering values.',
    ],
  },
  stress: {
    supported: false,
    reason: 'Forge3D has no FEA solver. There is no mesh discretisation, no stiffness assembly and no linear system being solved.',
    wouldNeed: 'A tetrahedral mesher plus a linear-elastic FEA solver, with boundary conditions and load cases the user defines.',
  },
  deformation: {
    supported: false,
    reason: 'Deflection requires the same FEA machinery as stress. Nothing in Forge3D computes displacement under load.',
    wouldNeed: 'The FEA solver above; deflection is a direct output once it exists.',
  },
  safety_factor: {
    supported: false,
    reason: 'A safety factor is peak stress divided by an allowable stress. Without a stress solver the numerator does not exist.',
    wouldNeed: 'Stress analysis, plus an explicit load case — a safety factor with no stated load is meaningless.',
  },
  fatigue: {
    supported: false,
    reason: 'No cyclic loading model and no S-N data in the material table.',
    wouldNeed: 'Stress analysis, S-N curves per material, and a duty cycle.',
  },
  modal: {
    supported: false,
    reason: 'No eigenvalue solver; natural frequencies are not computed.',
    wouldNeed: 'Mass and stiffness matrices from an FEA discretisation.',
  },
  draft_angle: {
    supported: false,
    reason: 'Draft analysis needs per-face normals relative to a pull direction. Forge3D composes from primitives and does not yet carry a face-level topology model.',
    wouldNeed: 'A B-rep or indexed-mesh topology layer exposing face normals.',
  },
  overhang: {
    supported: false,
    reason: 'Overhang detection needs face normals against the build direction — the same missing topology layer as draft.',
    wouldNeed: 'Face-level normals plus a chosen print orientation.',
  },
  machining_access: {
    supported: false,
    reason: 'Tool-reach analysis needs a tool model swept against the solid; Forge3D has no toolpath or accessibility engine.',
    wouldNeed: 'Solid modelling with tool sweep and collision against fixtures.',
  },
  tolerance_stackup: {
    supported: false,
    reason: 'No tolerances are carried on features — dimensions are nominal values with no limits attached.',
    wouldNeed: 'A GD&T model on features, plus an assembly constraint graph to accumulate along.',
  },
  thread_fit: {
    supported: false,
    reason: 'Threads are not modelled as features, so fit classes cannot be checked.',
    wouldNeed: 'Parametric thread features with a standards table (ISO 262 / ASME B1.1).',
  },
};

export function capability(id) { return CAPABILITIES[id] || null; }

export function unsupportedCapabilities() {
  return Object.entries(CAPABILITIES)
    .filter(([, c]) => c.supported === false)
    .map(([id, c]) => ({ id, ...c }));
}

// ── Manufacturing processes ───────────────────────────────────────────────
// Limits are typical shop values. `checks` lists which capability each rule
// needs, so a process reports honestly when a rule cannot be evaluated.
export const PROCESSES = {
  fdm: {
    name: 'FDM 3D printing',
    minWallMm: 1.2, envelopeMm: [220, 220, 250],
    maxOverhangDeg: 45,
    notes: 'Layer adhesion makes Z the weak axis — see printAnisotropy on the material.',
    checks: ['wall_thickness', 'build_volume', 'overhang'],
  },
  sla: {
    name: 'SLA / MSLA resin',
    minWallMm: 0.6, envelopeMm: [143, 89, 175],
    notes: 'Needs drain holes for hollow volumes and supports on down-facing area.',
    checks: ['wall_thickness', 'build_volume'],
  },
  cnc3: {
    name: 'CNC machining (3-axis)',
    minWallMm: 0.8, envelopeMm: [400, 300, 150],
    minInternalRadiusMm: 1.5,
    notes: 'Internal vertical corners cannot be sharper than the cutter radius.',
    checks: ['wall_thickness', 'build_volume', 'machining_access'],
  },
  laser: {
    name: 'Laser cutting',
    minWallMm: 0.5, envelopeMm: [600, 400, 20],
    notes: 'Flat stock only — 2.5D profiles cut from sheet.',
    checks: ['wall_thickness', 'build_volume'],
  },
  injection: {
    name: 'Injection moulding',
    minWallMm: 0.8, envelopeMm: [300, 300, 300],
    minDraftDeg: 1.0,
    notes: 'Uniform wall thickness matters more than absolute thickness — sinks follow thick sections.',
    checks: ['wall_thickness', 'build_volume', 'draft_angle'],
  },
  sheet: {
    name: 'Sheet metal',
    minWallMm: 0.5, envelopeMm: [1000, 500, 200],
    notes: 'Bend radius should be at least material thickness; flanges need a minimum length.',
    checks: ['wall_thickness', 'build_volume'],
  },
  pcb: {
    name: 'PCB fabrication',
    minWallMm: 0.6, envelopeMm: [400, 500, 3.2],
    notes: 'Standard 2-layer FR-4; trace/space and drill rules are not modelled here.',
    checks: ['build_volume'],
  },
};

export function processIds() { return Object.keys(PROCESSES); }

// ── Stage construction ────────────────────────────────────────────────────
function stage(id, status, { reasons = [], method = null, confidence = null, limitations = [], data = null } = {}) {
  return { stage: id, label: STAGE_LABEL[id], status, reasons, method, confidence, limitations, data };
}

/**
 * Build the readiness ladder.
 *
 * Every input is optional — a missing input yields NOT_RUN, never a guess.
 *   spec           the design spec
 *   geometry       { ok, issues[] }        from geometry validation
 *   simulation     { ran, ok, issues[] }   from the visual sim
 *   structure      { ok, stable, grounded, massG, issues[] } from statics
 *   manufacture    { printable, issues[], warnings[], envelopeMm } from DFM
 *   process        a key of PROCESSES
 */
export function evaluateReadiness({ spec, geometry, simulation, structure, manufacture, process = 'fdm' } = {}) {
  const stages = [];
  const proc = PROCESSES[process] || PROCESSES.fdm;

  // 1. DESIGNED
  const bodyCount = spec?.bodies?.length || 0;
  stages.push(bodyCount > 0
    ? stage(STAGE.DESIGNED, STATUS.PASS, {
        reasons: [`${bodyCount} ${bodyCount === 1 ? 'body' : 'bodies'} defined`],
        method: 'Spec contains at least one body with dimensions.',
        data: { bodyCount, normalizationIssues: spec?.normalizationIssues || [] },
      })
    : stage(STAGE.DESIGNED, STATUS.FAIL, { reasons: ['The design has no bodies.'] }));

  // 2. VALID GEOMETRY
  if (!geometry) {
    stages.push(stage(STAGE.VALID_GEOMETRY, STATUS.NOT_RUN, { reasons: ['Geometry validation has not been run.'] }));
  } else {
    const issues = geometry.issues || [];
    stages.push(stage(STAGE.VALID_GEOMETRY, geometry.ok && !issues.length ? STATUS.PASS : STATUS.FAIL, {
      reasons: issues.length ? issues.map(String) : ['No invalid topology detected.'],
      method: 'Primitive dimension validity, finite coordinates and body overlap.',
      confidence: 'medium',
      limitations: [
        'Forge3D composes from primitives, so classic B-rep faults (non-manifold edges, zero-area faces) cannot arise — and equally cannot be checked on imported meshes.',
      ],
    }));
  }

  // 3. SIMULATED — explicitly labelled as visual
  if (!simulation?.ran) {
    stages.push(stage(STAGE.SIMULATED, STATUS.NOT_RUN, { reasons: ['The simulation has not been run.'] }));
  } else {
    const cap = CAPABILITIES.rigid_body_dynamics;
    stages.push(stage(STAGE.SIMULATED, simulation.ok ? STATUS.PASS : STATUS.FAIL, {
      reasons: simulation.ok
        ? ['The design behaved as expected in the visual simulation.']
        : (simulation.issues || ['The simulation reported problems.']).map(String),
      method: cap.method,
      confidence: cap.confidence,
      limitations: ['This is VISUAL PHYSICS, not engineering simulation.', ...cap.limitations],
    }));
  }

  // 4. VERIFIED — partial by construction: statics yes, stress no
  if (!structure) {
    stages.push(stage(STAGE.VERIFIED, STATUS.NOT_RUN, { reasons: ['Structural checks have not been run.'] }));
  } else {
    const issues = structure.issues || [];
    const staticsOk = Boolean(structure.ok) && !issues.length;
    const missing = ['stress', 'deformation', 'safety_factor'].map((id) => ({ id, ...CAPABILITIES[id] }));
    stages.push(stage(STAGE.VERIFIED, staticsOk ? STATUS.PARTIAL : STATUS.FAIL, {
      reasons: [
        ...(staticsOk ? ['Static stability and interference checks passed.'] : issues.map(String)),
        'Stress, deflection and safety factor were NOT evaluated — Forge3D has no FEA solver.',
      ],
      method: `${CAPABILITIES.static_stability.method} ${CAPABILITIES.mass_properties.method}`,
      confidence: CAPABILITIES.static_stability.confidence,
      limitations: [...CAPABILITIES.static_stability.limitations, ...CAPABILITIES.mass_properties.limitations],
      data: { massG: structure.massG ?? null, missingAnalyses: missing },
    }));
  }

  // 5. MANUFACTURING ANALYSIS — per process, honest about unevaluated rules
  if (!manufacture) {
    stages.push(stage(STAGE.MANUFACTURING_ANALYSIS, STATUS.NOT_RUN, {
      reasons: [`Design-for-manufacture analysis has not been run for ${proc.name}.`],
    }));
  } else {
    const issues = manufacture.issues || [];
    const evaluated = proc.checks.filter((c) => CAPABILITIES[c]?.supported === true);
    const skipped = proc.checks
      .filter((c) => CAPABILITIES[c]?.supported !== true)
      .map((c) => ({ id: c, ...CAPABILITIES[c] }));
    const ok = issues.length === 0;
    stages.push(stage(STAGE.MANUFACTURING_ANALYSIS, ok ? (skipped.length ? STATUS.PARTIAL : STATUS.PASS) : STATUS.FAIL, {
      reasons: [
        ...(ok ? [`No ${proc.name} rule violations among the checks Forge3D can evaluate.`] : issues.map(String)),
        ...(manufacture.warnings || []).map(String),
        ...skipped.map((s) => `${s.id.replace(/_/g, ' ')} was NOT checked — ${s.reason}`),
      ],
      method: `${proc.name}: ${evaluated.map((c) => c.replace(/_/g, ' ')).join(', ') || 'no evaluable rules'}. Min wall ${proc.minWallMm} mm, envelope ${proc.envelopeMm.join('×')} mm.`,
      confidence: skipped.length ? 'low' : 'medium',
      limitations: [
        ...(proc.notes ? [proc.notes] : []),
        ...evaluated.flatMap((c) => CAPABILITIES[c]?.limitations || []),
      ],
      data: { process, evaluated, skipped },
    }));
  }

  // 6. MANUFACTURING READY — the gate that used to be handed out for free
  const byId = Object.fromEntries(stages.map((s) => [s.stage, s]));
  const blockers = [];
  for (const id of [STAGE.DESIGNED, STAGE.VALID_GEOMETRY, STAGE.SIMULATED, STAGE.VERIFIED, STAGE.MANUFACTURING_ANALYSIS]) {
    const s = byId[id];
    if (!s) { blockers.push(`${STAGE_LABEL[id]} was not evaluated.`); continue; }
    if (s.status === STATUS.FAIL) blockers.push(`${s.label} failed: ${s.reasons[0] || 'see details'}`);
    else if (s.status === STATUS.NOT_RUN) blockers.push(`${s.label} has not been run.`);
  }
  const unevaluated = byId[STAGE.MANUFACTURING_ANALYSIS]?.data?.skipped || [];

  stages.push(blockers.length
    ? stage(STAGE.MANUFACTURING_READY, STATUS.FAIL, {
        reasons: blockers,
        method: 'Every prior stage must pass. Simulation alone never grants this.',
      })
    : stage(STAGE.MANUFACTURING_READY, STATUS.PARTIAL, {
        reasons: [
          `Every check Forge3D can perform for ${proc.name} passed.`,
          'This is NOT a certification. Stress, deflection, fatigue and tolerance stack-up were not evaluated.',
          ...(unevaluated.length ? [`${unevaluated.length} process rule(s) could not be evaluated: ${unevaluated.map((s) => s.id.replace(/_/g, ' ')).join(', ')}.`] : []),
          'Have a qualified engineer review any part that carries load or matters to safety.',
        ],
        method: 'All evaluable stages passed.',
        confidence: 'low',
      }));

  const reached = highestReached(stages);
  return {
    process, processName: proc.name,
    stages,
    reachedStage: reached,
    reachedLabel: STAGE_LABEL[reached],
    manufacturingReady: byId[STAGE.MANUFACTURING_READY]?.status !== STATUS.FAIL && blockers.length === 0,
    blockers,
    summary: summarize(stages, reached, blockers),
  };
}

function highestReached(stages) {
  let reached = null;
  for (const id of STAGE_ORDER) {
    const s = stages.find((x) => x.stage === id);
    if (!s) break;
    if (s.status === STATUS.PASS || s.status === STATUS.PARTIAL) reached = id;
    else break;
  }
  return reached || STAGE.DESIGNED;
}

function summarize(stages, reached, blockers) {
  const s = stages.find((x) => x.stage === reached);
  if (blockers.length) return `Reached "${STAGE_LABEL[reached]}". Blocked by: ${blockers[0]}`;
  return `Reached "${STAGE_LABEL[reached]}"${s?.status === STATUS.PARTIAL ? ' (with limitations)' : ''}.`;
}

// ── Material reporting ────────────────────────────────────────────────────
// What we can honestly say about a material, and what we cannot.
export function materialAssessment(key) {
  const m = MATERIALS[key];
  if (!m) return { ok: false, reason: `Unknown material "${key}"` };
  const limit = strengthLimit(key);
  return {
    ok: true,
    key, name: m.name, grade: m.grade,
    structural: hasStructuralData(key),
    properties: {
      density_g_cm3: m.density,
      youngsModulus_GPa: m.youngsGPa,
      poissonRatio: m.poisson,
      yieldStrength_MPa: m.yieldMPa,
      ultimateTensile_MPa: m.ultimateMPa,
      thermalConductivity_W_mK: m.conductivity,
      specificHeat_J_gK: m.specificHeat,
      thermalExpansion_um_mK: m.cteUmPerMK,
      electricalConductivity_S_m: m.elecConductivity,
    },
    strengthBasis: limit,
    caveats: [
      `Handbook typical values for: ${m.grade}. Not certified lot data.`,
      ...(m.printAnisotropy != null
        ? [`Printed parts are anisotropic — Z-axis strength is roughly ${Math.round(m.printAnisotropy * 100)}% of the XY value listed.`]
        : []),
      ...(m.yieldMPa == null ? ['Brittle: no yield point, so design against ultimate strength with a larger margin.'] : []),
    ],
    cannotCompute: ['stress', 'deformation', 'safety_factor', 'fatigue'].map((id) => ({ id, ...CAPABILITIES[id] })),
  };
}
