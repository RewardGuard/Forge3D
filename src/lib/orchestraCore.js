// ============================================================================
// Orchestra ENGINEERING CORE — the part that decides whether Forge3D is a toy or
// a tool. Pure SPEC → COMPOSE → VALIDATE → ITERATE, with NO UI / IPC / model /
// browser dependency, so it runs headless and is provable by automated tests
// (scripts/acceptance-orchestra.mjs). The AI/agent/escalation layers sit ON TOP
// of this; this is the deterministic ground truth.
// ============================================================================
import { useStore } from './store.js';
import { composeGeometry, mountByNetlist, assembleVehicle } from './orchestraCompose.js';
import { synthesizeCircuit, indicatorReport, motorReport, validateCircuit } from './orchestraCircuit.js';
import { validateStructure, applyStructureFixes } from './orchestraPhysics.js';
import { validateManufacture, validateIntegration } from './orchestraManufacture.js';
import { validateGeometry, applyGeometryFixes } from './orchestraGeometry.js';
import { detectPattern, seedSpec, motorCount, indicatorCount } from './orchestraSpec.js';

// Deterministically realise a spec: geometry → circuit (built-in synthesizer) →
// physical mount (by netlist) → vehicle assembly. No model calls.
export function composeDeterministic(spec) {
  composeGeometry(spec);
  synthesizeCircuit(spec);
  mountByNetlist(spec);
  if (spec.isVehicle) assembleVehicle();
}

// Run EVERY validator and fold them into one verdict. This is the objective
// definition of "correct, functional, manufacturable" the acceptance tests check.
export function validateAll(spec) {
  const struct = validateStructure();
  const mfg = validateManufacture(spec);
  const integ = validateIntegration(spec);
  const ind = indicatorReport();
  const mr = motorReport();
  const circ = validateCircuit('generic');

  const expMotors = (spec.electronics || []).filter((e) => e.function === 'actuator' && e.partId === 'dc-motor').length;
  const ledOk = ind.total ? ind.lit === ind.total : true;
  const motorOk = mr.motors.length ? mr.anyActive : expMotors === 0;
  const structuralOk = struct.stable && !struct.issues.some((i) => ['support', 'interference', 'ground'].includes(i.type));

  return {
    ok: structuralOk && mfg.issues.length === 0 && integ.issues.length === 0 && ledOk && motorOk,
    structural: { ok: structuralOk, stable: struct.stable, mass_g: struct.mass, com: struct.com, issues: struct.issues.map((i) => i.msg) },
    dimensional: { printable: mfg.report.printable, envelope_mm: mfg.report.envelope_mm, minWall_mm: mfg.report.minWall_mm, fitsBed: mfg.report.fitsBed, issues: mfg.issues.map((i) => i.msg) },
    integration: { ok: integ.issues.length === 0, issues: integ.issues.map((i) => i.msg) },
    electrical: {
      ok: ledOk && motorOk,
      leds: ind.total ? `${ind.lit}/${ind.total}` : 'n/a',
      motors: mr.motors.length ? `${mr.motors.filter((m) => m.active).length}/${mr.motors.length}` : 'n/a',
      deficiencies: circ,
    },
    bom: mfg.report.bom,
  };
}

// Compose, then ITERATE: when a validation fails, auto-fix what's deterministically
// fixable (wheel orientation/proportion, grounding/support) and re-validate, up to
// `max` rounds. Returns { ok, iterations, report }.
export function iterateToValid(spec, max = 4) {
  composeDeterministic(spec);
  let report = validateAll(spec);
  let iterations = 1;
  while (!report.ok && iterations < max) {
    const arch = spec.isVehicle ? 'car' : 'generic';
    applyGeometryFixes(validateGeometry(arch));           // wheels flat, proportion
    applyStructureFixes(validateStructure().issues);      // ground / support
    report = validateAll(spec);
    iterations++;
  }
  return { ok: report.ok, iterations, report };
}

// Reset the scene + circuit (used between acceptance cases).
export function resetScene() {
  useStore.setState({ meshes: [], selectedMeshId: null, selectedMeshIds: [] });
  useStore.getState().clearCircuit();
}

// CONFORMANCE — a "valid" design that isn't what was asked for is a FAILURE. This
// checks the built scene actually contains what the goal requires (a sumo robot
// must really have wheels, motors and the ultrasonic), so a model that returns a
// tiny valid-but-wrong box is rejected rather than accepted.
export function conforms(goal) {
  const g = String(goal || '').toLowerCase();
  const s = useStore.getState();
  const has = (pid) => s.nodes.some((n) => n.partId === pid);
  const count = (pid) => s.nodes.filter((n) => n.partId === pid).length;
  const wheels = s.meshes.filter((m) => m.role === 'wheel').length;
  const missing = [];
  if (/ultrasonic|ultrasonido|hc-?sr04|distance sensor|sensor de distancia/.test(g) && !has('hcsr04')) missing.push('ultrasonic sensor');
  if (/pir|motion|movimiento/.test(g) && !has('pir')) missing.push('motion sensor');
  const isVehicle = /\b(car|robot|rover|vehicle|coche|carro|auto|buggy|truck)\b/.test(g);
  const needMotors = (isVehicle || /\bmotor|motores|servo|fan|ventilador\b/.test(g)) ? motorCount(g) : 0; // motors, NOT wheels
  if (needMotors && count('dc-motor') < needMotors) missing.push(`${needMotors} motor(s) (found ${count('dc-motor')})`);
  if (isVehicle && wheels < 2) missing.push('wheels');
  if (/\bled|leds|luces?\b/.test(g) && !/\blamp|lámpara\b/.test(g) && !has('led-5mm')) missing.push('LED(s)');
  if (/\bbutton|botón|boton\b/.test(g) && !has('push-button')) missing.push('button');
  return { ok: missing.length === 0, missing };
}

export function collectDeficiencies(report) {
  const d = [];
  if (report?.structural && !report.structural.ok) d.push('structural: ' + report.structural.issues.join('; '));
  if (report?.dimensional && report.dimensional.issues.length) d.push('manufacturing: ' + report.dimensional.issues.join('; '));
  if (report?.integration && !report.integration.ok) d.push('mounting: ' + report.integration.issues.join('; '));
  if (report?.electrical && !report.electrical.ok) d.push(`electrical: LEDs ${report.electrical.leds}, motors ${report.electrical.motors} didn't all work`);
  return d.join(' | ');
}

// AUTONOMOUS DESIGN — from the GOAL ALONE, with no human help. Tries the model's
// spec (specProvider) with re-spec-on-failure, validating AND checking conformance
// each round; if the model can't produce a correct design it FALLS BACK to the
// validated template for the recognised pattern, so the result is never garbage.
// `specProvider(goal, deficiencies)` is the LLM in production (a stub in tests).
export function autonomousDesign(goal, { specProvider = null, max = 3 } = {}) {
  let deficiencies = null, lastReport = null;
  if (specProvider) {
    for (let i = 0; i < max; i++) {
      const spec = specProvider(goal, deficiencies);
      if (!spec) break;
      resetScene();
      const r = iterateToValid(spec);
      const c = conforms(goal);
      if (r.ok && c.ok) return { ok: true, source: 'model', round: i + 1, report: r.report };
      lastReport = r.report;
      deficiencies = [collectDeficiencies(r.report), c.missing.length ? 'missing: ' + c.missing.join(', ') : ''].filter(Boolean).join(' | ');
    }
  }
  const tmpl = seedSpec(detectPattern(goal), goal);
  if (tmpl) {
    resetScene();
    const r = iterateToValid(tmpl);
    return { ok: r.ok && conforms(goal).ok, source: 'template', report: r.report };
  }
  return { ok: false, source: 'none', report: lastReport };
}
