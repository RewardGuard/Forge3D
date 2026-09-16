// The engineering view of the current model that Orchestra reasons over.
//
// Point 7 of the professional-CAD spec asks that Orchestra understand the
// model rather than sit beside it as a chatbot. That starts with giving it a
// structured, honest picture instead of a screenshot and a goal string.
//
// Two rules govern everything here:
//   1. Real units. Dimensions leave in millimetres, mass in grams, never in
//      the renderer's internal scene units.
//   2. Heuristics are labelled. Feature ROLES (which body is a mounting boss,
//      which is structural) are inferred from labels and geometry, not
//      declared by the user, so every role carries how confident we are and
//      why. Orchestra must be able to tell a fact from a guess.

import { useStore } from './store.js';
import { MATERIALS, partMaterialKey } from './materials.js';
import { estimateGeom } from './lifesim.js';
import { worldAABB } from './orchestraGeometry.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;            // scene units per mm
const toMm = (u) => +(u / MM).toFixed(3);

// Label patterns that suggest a body's engineering role. Deliberately
// conservative: anything unmatched stays 'unclassified' rather than guessing.
const ROLE_HINTS = [
  { role: 'mounting', re: /\b(mount|boss|standoff|screw|bolt|hole|tab|bracket|lug|anchor)\b/i, why: 'label names a fastening feature' },
  { role: 'structural', re: /\b(rib|beam|frame|chassis|spar|wall|floor|roof|support|column|strut)\b/i, why: 'label names a load path' },
  { role: 'enclosure', re: /\b(lid|cover|shell|case|housing|panel|door)\b/i, why: 'label names an enclosing surface' },
  { role: 'cosmetic', re: /\b(logo|badge|trim|bezel|decal|fillet|chamfer)\b/i, why: 'label names a non-structural feature' },
];

function classifyRole(mesh) {
  if (mesh.kind === 'part') {
    return { role: 'electronic', confidence: 'high', why: 'placed from the parts catalogue' };
  }
  for (const h of ROLE_HINTS) {
    if (h.re.test(mesh.label || '') || h.re.test(mesh.id || '')) {
      return { role: h.role, confidence: 'low', why: `heuristic: ${h.why}` };
    }
  }
  return { role: 'unclassified', confidence: 'none', why: 'no role could be inferred from the label or geometry' };
}

// Mass from real density × real volume. No fudge factors — the life sim's
// sublinear "effective grams" is a visual timescale trick and is NOT used here.
export function bodyMass(mesh) {
  const key = mesh.kind === 'part' && mesh.partId ? partMaterialKey(mesh.partId) : (mesh.material || 'pla');
  const mat = MATERIALS[key] || MATERIALS.pla;
  const { volCm3 } = estimateGeom(mesh);
  return { materialKey: key, materialName: mat.name, volCm3, massG: volCm3 * mat.density };
}

export function describeBody(mesh) {
  const m = bodyMass(mesh);
  const box = worldAABB(mesh);
  const size = box && box.max && box.min
    ? [toMm(box.max.x - box.min.x), toMm(box.max.y - box.min.y), toMm(box.max.z - box.min.z)]
    : null;
  const role = classifyRole(mesh);
  return {
    id: mesh.id,
    label: mesh.label || mesh.id,
    kind: mesh.kind,
    partId: mesh.partId || null,
    position_mm: (mesh.position || [0, 0, 0]).map(toMm),
    rotation_rad: mesh.rotation || [0, 0, 0],
    boundingBox_mm: size,
    minDimension_mm: size ? Math.min(...size) : null,
    scale: mesh.scale ?? 1,
    material: { key: m.materialKey, name: m.materialName },
    volume_cm3: +m.volCm3.toFixed(4),
    mass_g: +m.massG.toFixed(3),
    role: role.role,
    roleConfidence: role.confidence,
    roleBasis: role.why,
    attachedTo: mesh.attachedTo || null,
    groupId: mesh.groupId || null,
  };
}

/**
 * The full context. Everything Orchestra is allowed to reason from.
 * Pass `readiness` (from engineeringReport.evaluateReadiness) when you have
 * one; it is not recomputed here so the context stays cheap to build.
 */
export function buildModelContext({ readiness = null, history = [] } = {}) {
  const s = useStore.getState();
  const meshes = s.meshes || [];
  const bodies = meshes.map(describeBody);

  const totalMass = bodies.reduce((a, b) => a + b.mass_g, 0);
  const totalVol = bodies.reduce((a, b) => a + b.volume_cm3, 0);

  // Centre of mass, mass-weighted over body centroids.
  let com = [0, 0, 0];
  if (totalMass > 0) {
    for (const b of bodies) {
      com[0] += b.position_mm[0] * b.mass_g;
      com[1] += b.position_mm[1] * b.mass_g;
      com[2] += b.position_mm[2] * b.mass_g;
    }
    com = com.map((v) => +(v / totalMass).toFixed(2));
  }

  // Overall envelope across every body.
  let env = null;
  if (bodies.length) {
    const withBox = bodies.filter((b) => b.boundingBox_mm);
    if (withBox.length) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const b of withBox) {
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], b.position_mm[i] - b.boundingBox_mm[i] / 2);
          hi[i] = Math.max(hi[i], b.position_mm[i] + b.boundingBox_mm[i] / 2);
        }
      }
      env = hi.map((h, i) => +(h - lo[i]).toFixed(2));
    }
  }

  const roleCounts = {};
  for (const b of bodies) roleCounts[b.role] = (roleCounts[b.role] || 0) + 1;

  const materialsInUse = [...new Set(bodies.map((b) => b.material.key))].map((k) => ({
    key: k, name: MATERIALS[k]?.name || k, grade: MATERIALS[k]?.grade || null,
    density_g_cm3: MATERIALS[k]?.density ?? null,
    youngsModulus_GPa: MATERIALS[k]?.youngsGPa ?? null,
  }));

  return {
    bodyCount: bodies.length,
    bodies,
    massProperties: {
      totalMass_g: +totalMass.toFixed(3),
      totalVolume_cm3: +totalVol.toFixed(4),
      centreOfMass_mm: com,
      envelope_mm: env,
      basis: 'Analytic primitive volume × material density, solid bodies at 100% infill.',
    },
    materialsInUse,
    roleCounts,
    circuit: {
      nodeCount: (s.nodes || []).length,
      wireCount: (s.wires || []).length,
    },
    simulation: {
      running: Boolean(s.lifeSimRunning),
      lastReport: s.simReport || null,
      kind: 'visual',
      caveat: 'Rigid-body visual physics. Not an engineering simulation — do not read loads off it.',
    },
    readiness: readiness
      ? { reached: readiness.reachedLabel, manufacturingReady: readiness.manufacturingReady, blockers: readiness.blockers }
      : null,
    operationHistory: history.slice(-20),
    limitations: [
      'Bodies are primitives (box/sphere/cylinder/part), not a B-rep solid model. There is no face, edge or vertex topology to reason about.',
      'Feature roles are inferred from labels and carry low confidence — confirm before relying on them.',
      'Mass assumes solid bodies. An FDM part at 20% infill weighs far less.',
    ],
  };
}

// A compact text form for a model prompt — keeps token cost sane while
// preserving every number the AI needs to compute against.
export function contextToPrompt(ctx) {
  const L = [];
  L.push(`MODEL: ${ctx.bodyCount} bodies, ${ctx.massProperties.totalMass_g} g total, envelope ${ctx.massProperties.envelope_mm?.join('×') ?? '—'} mm.`);
  L.push(`Centre of mass: ${ctx.massProperties.centreOfMass_mm.join(', ')} mm.`);
  L.push('BODIES (id · label · role[confidence] · size mm · material · mass g):');
  for (const b of ctx.bodies) {
    L.push(`  ${b.id} · ${b.label} · ${b.role}[${b.roleConfidence}] · ${b.boundingBox_mm?.join('×') ?? '—'} · ${b.material.key} · ${b.mass_g} g`);
  }
  if (ctx.materialsInUse.length) {
    L.push('MATERIALS: ' + ctx.materialsInUse.map((m) => `${m.key} (${m.grade || m.name}, ρ=${m.density_g_cm3} g/cm³, E=${m.youngsModulus_GPa} GPa)`).join('; '));
  }
  if (ctx.circuit.nodeCount) L.push(`CIRCUIT: ${ctx.circuit.nodeCount} components, ${ctx.circuit.wireCount} wires.`);
  if (ctx.readiness) L.push(`READINESS: reached "${ctx.readiness.reached}"; manufacturing ready = ${ctx.readiness.manufacturingReady}.`);
  if (ctx.operationHistory.length) L.push('RECENT OPERATIONS: ' + ctx.operationHistory.map((o) => o.op || o).join(', '));
  L.push('LIMITATIONS: ' + ctx.limitations.join(' '));
  return L.join('\n');
}
