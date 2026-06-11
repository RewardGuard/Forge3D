// Life Simulator physics v2 — a stylized-but-grounded thermal & material model.
// No physics engine dependency; we integrate each object's temperature and
// structural state every frame with a numerically stable relaxation scheme.
//
// What it models, per object:
//   • Thermal mass — big/dense/high-specific-heat objects change temperature
//     slowly; small plastics heat almost instantly. (density · specificHeat · size)
//   • Hazards radiate heat with distance falloff and a user intensity.
//   • Conduction — heat flows between objects that touch or are attached,
//     scaled by the materials' conductivities.
//   • Convective cooling pulls everything toward ambient (bigger surface = faster).
//   • Melting — past meltC the object softens and slumps, losing integrity.
//   • Combustion — flammable materials ignite past ignitionC, then self-heat,
//     burn down their fuel, and radiate heat to nearby objects (fire spreads).
//   • Mechanical wear — motor-driven parts lose a little integrity over time.
//
// Note: the numbers are realistic in *proportion* (a flamethrower can melt
// aluminium but not steel; a tiny LED lens cooks far faster than a steel motor)
// but compressed onto a watchable timescale. It's a teaching toy, not FEA.

import { MATERIALS, partMaterial } from './materials.js';
import { SCENE_SCALE } from '../data/parts.js';

export const AMBIENT_C = 25;

// One scene unit in centimetres (mm = units * 1000 / SCENE_SCALE).
const UNIT_CM = 1000 / SCENE_SCALE / 10; // ≈ 8.33 cm
const UNIT_CM3 = UNIT_CM ** 3;

// Hazard catalog. `tempC` = source temperature; `reach` in scene units;
// `rate` = heat-transfer aggressiveness (relaxation weight).
export const HAZARDS = {
  flamethrower: { id: 'flamethrower', name: 'Flamethrower', tempC: 1000, reach: 3.2, rate: 6.0, color: '#ff5722', icon: '🔥' },
  torch:        { id: 'torch',        name: 'Blow Torch',   tempC: 1300, reach: 1.5, rate: 9.0, color: '#ff8a3d', icon: '🔦' },
  plasma:       { id: 'plasma',       name: 'Plasma Jet',   tempC: 2200, reach: 1.2, rate: 12,  color: '#7c4dff', icon: '⚡' },
  heatLamp:     { id: 'heatLamp',     name: 'Heat Lamp',    tempC: 240,  reach: 4.5, rate: 2.0, color: '#ffb300', icon: '💡' },
  oven:         { id: 'oven',         name: 'Oven (bake)',  tempC: 220,  reach: 99,  rate: 1.4, color: '#ef9a9a', icon: '🍳' },
  cryo:         { id: 'cryo',         name: 'Cryo Spray',   tempC: -80,  reach: 2.6, rate: 4.0, color: '#4fc3f7', icon: '❄️' },
};
export const HAZARD_LIST = Object.values(HAZARDS);

// ---- material resolution ----------------------------------------------------
export function resolveMaterial(mesh) {
  if (mesh.materialKey && MATERIALS[mesh.materialKey]) {
    return { key: mesh.materialKey, ...MATERIALS[mesh.materialKey] };
  }
  if (mesh.kind === 'part' && mesh.partId) return partMaterial(mesh.partId);
  return { key: 'abs', ...MATERIALS.abs };
}

// ---- geometry estimation ----------------------------------------------------
// Fraction of the bounding cube each primitive fills (rough but consistent).
const KIND_FILL = {
  sphere: 0.52, cylinder: 0.5, cone: 0.26, pyramid: 0.22, torus: 0.18,
  torusknot: 0.15, plane: 0.02, capsule: 0.4, tetrahedron: 0.12,
  icosahedron: 0.45, box: 1, part: 1, default: 0.5,
};

// Returns { volCm3, surfaceCm2 } for a mesh.
export function estimateGeom(mesh) {
  // scale may be uniform (number) or stretched ([x,y,z]) — volume uses x*y*z
  const s = Array.isArray(mesh.scale) ? mesh.scale : [mesh.scale ?? 1, mesh.scale ?? 1, mesh.scale ?? 1];
  let volUnits;
  if (mesh.kind === 'part' && Array.isArray(mesh.size)) {
    volUnits = Math.max(1e-5, mesh.size[0] * mesh.size[1] * mesh.size[2]);
  } else {
    const fill = KIND_FILL[mesh.kind] ?? KIND_FILL.default;
    volUnits = fill * s[0] * s[1] * s[2];
  }
  const volCm3 = volUnits * UNIT_CM3;
  const sideCm = Math.cbrt(volCm3) || 0.1;
  const surfaceCm2 = 6 * sideCm * sideCm;
  return { volCm3, surfaceCm2 };
}

// Heat capacity (J/K), compressed via a sublinear exponent so the size range
// (sub-gram lenses → kilo-scale motors) stays on one watchable timescale.
function heatCapacity(mat, geom) {
  const mass = mat.density * Math.pow(geom.volCm3, 0.62); // "effective" grams
  return Math.max(0.05, mass * mat.specificHeat * 1.2);
}

function dist3(a, b) {
  const dx = (a[0] ?? 0) - (b[0] ?? 0);
  const dy = (a[1] ?? 0) - (b[1] ?? 0);
  const dz = (a[2] ?? 0) - (b[2] ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---- state ------------------------------------------------------------------
export function initLifeState(meshes) {
  const st = { _t: 0, objects: {} };
  for (const m of meshes) {
    st.objects[m.id] = {
      temp: AMBIENT_C, integrity: 1, melt: 0,
      ignited: false, fuel: 1, destroyed: false,
    };
  }
  return st;
}

// Precompute per-object physical constants once per step set.
function precompute(meshes) {
  const info = {};
  for (const m of meshes) {
    const mat = resolveMaterial(m);
    const geom = estimateGeom(m);
    info[m.id] = {
      mat, geom,
      cap: heatCapacity(mat, geom),
      radius: Math.cbrt(geom.volCm3 / UNIT_CM3) * 0.62, // approx bounding radius in units
    };
  }
  return info;
}

const CONV_RATE = 0.45;   // convection weight toward ambient (× area factor)
const COND_K = 0.025;     // conduction coupling scale

// Advance by dt seconds. hazards: [{ type, position, on, intensity }].
// drivenIds: Set of mesh ids that are being spun by a motor (mechanical wear).
// Internally sub-steps for stability with strong sources.
export function stepLifeState(prev, meshes, hazards, dt, drivenIds) {
  const steps = Math.max(1, Math.min(4, Math.ceil(dt / 0.02)));
  const h = dt / steps;
  let state = prev && prev.objects ? prev : initLifeState(meshes);
  const info = precompute(meshes);

  for (let s = 0; s < steps; s++) state = subStep(state, meshes, hazards, info, h, drivenIds);
  return state;
}

function subStep(state, meshes, hazards, info, dt, drivenIds) {
  const objects = {};
  const prevObj = state.objects;

  // collect active emitters: hazards + currently-burning objects
  const emitters = [];
  for (const hz of hazards) {
    if (!hz.on) continue;
    const spec = HAZARDS[hz.type];
    if (!spec) continue;
    emitters.push({
      pos: hz.position || [0, 0, 0],
      temp: spec.tempC,
      rate: spec.rate * (hz.intensity ?? 1),
      reach: spec.reach,
    });
  }
  for (const m of meshes) {
    const o = prevObj[m.id];
    if (o && o.ignited && !o.destroyed) {
      emitters.push({ pos: m.position || [0, 0, 0], temp: 780, rate: 3.5 * (0.3 + o.fuel), reach: 1.6, self: m.id });
    }
  }

  for (const m of meshes) {
    const o = prevObj[m.id] || { temp: AMBIENT_C, integrity: 1, melt: 0, ignited: false, fuel: 1, destroyed: false };
    const { mat, cap, geom, radius } = info[m.id];
    let { temp, integrity, melt, ignited, fuel } = o;

    if (o.destroyed) { objects[m.id] = o; continue; }

    // ---- thermal relaxation: weighted target temperature ----
    const areaFactor = Math.sqrt(geom.surfaceCm2) * 0.08;
    let sumW = CONV_RATE * areaFactor;          // convection toward ambient
    let sumWT = sumW * AMBIENT_C;

    for (const e of emitters) {
      if (e.self === m.id) continue;
      const d = dist3(m.position || [0, 0, 0], e.pos);
      if (d > e.reach + radius) continue;
      const atten = Math.max(0, 1 - d / (e.reach + radius));
      const w = e.rate * atten * atten;
      sumW += w; sumWT += w * e.temp;
    }

    // ---- conduction with neighbours (touch / attachment) ----
    for (const n of meshes) {
      if (n.id === m.id) continue;
      const no = prevObj[n.id];
      if (!no || no.destroyed) continue;
      const ni = info[n.id];
      const d = dist3(m.position || [0, 0, 0], n.position || [0, 0, 0]);
      const linked = m.attachedTo === n.id || n.attachedTo === m.id;
      const touching = d < radius + ni.radius;
      if (!linked && !touching) continue;
      const kEff = COND_K * Math.min(mat.conductivity, ni.mat.conductivity) ** 0.5 * (linked ? 1.6 : 1);
      const w = kEff * areaFactor;
      sumW += w; sumWT += w * no.temp;
    }

    if (ignited) { // a fire feeds its own object hard
      sumW += 4.0 * (0.3 + fuel); sumWT += (4.0 * (0.3 + fuel)) * 850;
    }

    const Tstar = sumWT / sumW;
    const alpha = 1 - Math.exp(-(sumW / cap) * dt);
    temp += (Tstar - temp) * alpha;

    // ---- ignition / burning ----
    if (mat.ignitionC != null && !ignited && temp >= mat.ignitionC) ignited = true;
    if (ignited) {
      const burnSpeed = (0.06 + 0.14 * mat.burn);
      fuel = Math.max(0, fuel - burnSpeed * dt);
      integrity -= (0.18 + 0.5 * mat.burn) * dt / Math.max(0.3, mat.toughness);
      if (fuel <= 0) { ignited = false; } // burned out
    }

    // ---- melting / softening ----
    if (temp > mat.meltC) {
      const over = (temp - mat.meltC) / Math.max(120, mat.meltC);
      melt = Math.min(1, melt + over * 0.9 * dt);
      integrity -= over * (0.55 / Math.max(0.2, mat.toughness)) * dt;
    } else if (temp > mat.maxTempC) {
      // sustained over-temperature degradation (creep / annealing / warping)
      const over = (temp - mat.maxTempC) / Math.max(80, mat.meltC - mat.maxTempC);
      integrity -= over * (0.12 / Math.max(0.2, mat.toughness)) * dt;
    }

    // ---- cryo embrittlement: brittle materials crack when frozen hard ----
    if (temp < -30 && mat.toughness < 0.45) integrity -= 0.12 * dt;

    // ---- mechanical wear on driven parts ----
    if (drivenIds && drivenIds.has(m.id)) integrity -= 0.01 * dt;

    integrity = Math.max(0, Math.min(1, integrity));
    melt = Math.max(0, Math.min(1, melt));
    const destroyed = integrity <= 0.002;
    objects[m.id] = {
      temp, integrity, melt,
      ignited: destroyed ? false : ignited,
      fuel, destroyed,
    };
  }

  return { _t: (state._t || 0) + dt, objects };
}

// ---- visual + UI helpers ----------------------------------------------------
// Approximate blackbody glow color for a temperature (°C). Returns null below
// the visible-glow threshold so the object keeps its base color.
export function glowColor(temp) {
  if (temp < 480) return null;
  const t = Math.min(1, (temp - 480) / (1500 - 480));
  // dull red → orange → yellow-white
  const r = 1;
  const g = 0.15 + 0.7 * t;
  const b = Math.max(0, (t - 0.6) / 0.4) * 0.8;
  return [r, g, b];
}

// Surface tint (char/heat) used on the standard material's base color.
export function tempColor(temp) {
  if (temp <= AMBIENT_C + 10) return null;
  const t = Math.min(1, (temp - AMBIENT_C) / (700 - AMBIENT_C));
  const r = Math.round(120 + t * 135);
  const g = Math.round(60 - t * 40);
  const b = Math.round(50 - t * 35);
  return `rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`;
}

export function statusLabel(s) {
  if (!s) return 'ok';
  if (s.destroyed) return 'destroyed';
  if (s.ignited) return 'on fire';
  if (s.melt > 0.05) return 'melting';
  if (s.integrity < 0.5) return 'failing';
  if (s.temp > 70) return 'hot';
  if (s.temp < 0) return 'frozen';
  return 'ok';
}
