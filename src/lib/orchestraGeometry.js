// ============================================================================
// Orchestra geometry — deterministic engineering knowledge.
//
// A weak LLM cannot place wheels with correct proportions one tool-call at a
// time. So the geometry that has a KNOWN-CORRECT answer is built and validated
// in code here (parametric, like a CAD macro): the director invokes a blueprint
// for a recognized archetype, then validateGeometry() catches anything wrong
// (upright wheels, floating bodies, a part dwarfing the rest) and applyFixes()
// repairs it. The 3D generator is reserved for organic/aesthetic shapes.
// ============================================================================
import * as THREE from 'three';
import { useStore } from './store.js';
import { scaleArr } from './scaleUtil.js';

const HALF_PI = Math.PI / 2;

// Base half-extents of each primitive at scale 1 (matches geometryFactory.js).
function baseHalf(kind) {
  switch (kind) {
    case 'cylinder': return [0.4, 0.5, 0.4];
    case 'capsule': return [0.3, 0.6, 0.3];
    case 'plane': return [0.5, 0.01, 0.5];
    case 'pyramid': return [0.6, 0.5, 0.6];
    default: return [0.5, 0.5, 0.5]; // box, sphere, cone, part, baked…
  }
}

// World-space axis-aligned bounding box of a placed mesh (rotation-aware).
// `part` meshes carry their real size in `size`; `baked` carry it in `half` —
// using those (not the primitive base) keeps mass/COM/fit honest.
export function worldAABB(mesh) {
  const h = mesh.kind === 'part' && Array.isArray(mesh.size) ? mesh.size.map((v) => v / 2)
    : Array.isArray(mesh.half) ? mesh.half // baked CSG + measured STL imports carry real half-extents
    : baseHalf(mesh.kind);
  const s = scaleArr(mesh.scale);
  const g = new THREE.BoxGeometry(2 * h[0] * s[0], 2 * h[1] * s[1], 2 * h[2] * s[2]);
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...(mesh.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(mesh.rotation || [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  ));
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.dispose();
  return b;
}

export function meshDims(mesh) {
  const b = worldAABB(mesh);
  const size = new THREE.Vector3(); b.getSize(size);
  const center = new THREE.Vector3(); b.getCenter(center);
  return { w: +size.x.toFixed(3), h: +size.y.toFixed(3), d: +size.z.toFixed(3), minY: +b.min.y.toFixed(3), center: [center.x, center.y, center.z] };
}

// ---- goal classification (keyword-first; cheap and reliable) ----
export function classifyGoal(goal) {
  const g = String(goal || '').toLowerCase();
  if (/\b(car|vehicle|auto|coche|carro|buggy|rover|truck|rc car)\b/.test(g)) return 'car';
  if (/\b(robot|rover|bot|arm|gripper)\b/.test(g)) return 'robot';
  if (/\b(lamp|light|lámpara|lampara|luz|desk lamp)\b/.test(g)) return 'lamp';
  if (/\b(drone|quad|copter)\b/.test(g)) return 'drone';
  return 'generic';
}

// ============================================================================
// Blueprints — return an array of mesh specs with correct proportions. Every
// spec carries a `role` tag so later phases (assembly, validation) recognize it.
// ============================================================================
const C = { body: '#c0392b', cabin: '#34495e', wheel: '#161616', arm: '#7f8c8d', bulb: '#f1c40f', base: '#2c3e50' };

export function buildCar() {
  const L = 1.7, H = 0.36, W = 0.95;      // chassis length/height/width
  const R = 0.28, T = 0.18;               // wheel radius / thickness
  const wheelY = R;                        // ride height: bottom touches the floor
  const chassisY = R + H / 2 + 0.04;       // body rides just above the wheels
  const xAxle = L / 2 - 0.22;              // wheel x at the ends
  const zTrack = W / 2 + T / 2;            // wheels just outside the body
  // cylinder local axis is Y; rotate +90° about X so the axle points along Z
  const wheel = (label, x, z) => ({
    role: 'wheel', kind: 'cylinder', label, color: C.wheel,
    position: [x, wheelY, z], rotation: [HALF_PI, 0, 0],
    scale: [R / 0.4, T, R / 0.4],
  });
  return [
    { role: 'chassis', kind: 'box', label: 'chassis', color: C.body, position: [0, chassisY, 0], rotation: [0, 0, 0], scale: [L, H, W] },
    { role: 'cabin', kind: 'box', label: 'cabin', color: C.cabin, position: [-0.05, chassisY + H / 2 + 0.16, 0], rotation: [0, 0, 0], scale: [0.7, 0.32, W * 0.82] },
    wheel('wheel_fl', xAxle, zTrack),
    wheel('wheel_fr', xAxle, -zTrack),
    wheel('wheel_rl', -xAxle, zTrack),
    wheel('wheel_rr', -xAxle, -zTrack),
  ];
}

export function buildRobot() {
  return [
    { role: 'chassis', kind: 'box', label: 'body', color: C.base, position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [0.7, 0.7, 0.5] },
    { role: 'head', kind: 'box', label: 'head', color: C.cabin, position: [0, 1.0, 0], rotation: [0, 0, 0], scale: [0.42, 0.34, 0.42] },
    { role: 'wheel', kind: 'cylinder', label: 'wheel_l', color: C.wheel, position: [0, 0.26, 0.34], rotation: [HALF_PI, 0, 0], scale: [0.65, 0.16, 0.65] },
    { role: 'wheel', kind: 'cylinder', label: 'wheel_r', color: C.wheel, position: [0, 0.26, -0.34], rotation: [HALF_PI, 0, 0], scale: [0.65, 0.16, 0.65] },
  ];
}

export function buildLamp() {
  return [
    { role: 'base', kind: 'cylinder', label: 'base', color: C.base, position: [0, 0.06, 0], rotation: [0, 0, 0], scale: [1.1, 0.12, 1.1] },
    { role: 'arm', kind: 'cylinder', label: 'arm', color: C.arm, position: [0, 0.7, 0], rotation: [0, 0, 0], scale: [0.12, 1.3, 0.12] },
    { role: 'bulb', kind: 'sphere', label: 'bulb', color: C.bulb, position: [0, 1.35, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
  ];
}

export const BLUEPRINTS = { car: buildCar, robot: buildRobot, lamp: buildLamp };

// Place a blueprint into the scene (returns the ids it created). Clears any
// previous design meshes so a re-run starts from a clean, correct layout.
export function placeBlueprint(archetype) {
  const make = BLUEPRINTS[archetype];
  if (!make) return null;
  const st = useStore.getState();
  // keep projected circuit footprints; clear design primitives/models
  const keep = st.meshes.filter((m) => m.kind === 'part');
  const specs = make();
  const created = [];
  const meshes = specs.map((spec) => {
    const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    created.push({ id, role: spec.role, label: spec.label });
    return { scale: 1, ...spec, id };
  });
  useStore.setState({ meshes: [...keep, ...meshes], selectedMeshId: null, selectedMeshIds: [] });
  return created;
}

// ============================================================================
// Validation — deterministic dimension / proportion / placement checks.
// Returns issues with a concrete `fix` (a mesh patch) where auto-repair is safe.
// ============================================================================
export function validateGeometry(archetype) {
  const meshes = useStore.getState().meshes.filter((m) => m.kind !== 'part');
  const issues = [];
  if (!meshes.length) return issues;

  const wheels = meshes.filter((m) => m.role === 'wheel' || /wheel|tire|rueda/i.test(m.label || ''));
  const bodies = meshes.filter((m) => m.role === 'chassis' || m.role === 'body' || m.role === 'base');
  const bodyH = bodies.length ? Math.max(...bodies.map((b) => meshDims(b).h)) : (meshes.length ? meshDims(meshes[0]).h : 1);

  // 1) wheels must lie on their side (a cylinder with no x/z rotation is a pillar)
  for (const w of wheels) {
    if (w.kind !== 'cylinder' && w.kind !== 'torus') continue;
    const [rx, , rz] = w.rotation || [0, 0, 0];
    const flat = Math.abs(Math.abs(rx) - HALF_PI) < 0.3 || Math.abs(Math.abs(rz) - HALF_PI) < 0.3;
    if (!flat) issues.push({ meshId: w.id, type: 'orientation', msg: `${w.label || 'wheel'} is standing upright — should lie flat`, fix: { rotation: [HALF_PI, 0, 0] } });
  }

  // 2) grounding is an ASSEMBLY property: the lowest point of the whole build
  // should rest on the floor. A car body riding ABOVE its wheels is correct, so
  // we don't flag individual elevated parts — only the whole thing floating, or a
  // single part punched through the floor.
  const globalMinY = Math.min(...meshes.map((m) => meshDims(m).minY));
  if (globalMinY > 0.15) {
    issues.push({ type: 'ground', global: true, shift: globalMinY, msg: `the whole build floats ${globalMinY.toFixed(2)}u above the floor — dropping it down` });
  }
  for (const m of meshes) {
    const d = meshDims(m);
    if (d.minY < -0.15) issues.push({ meshId: m.id, type: 'ground', msg: `${m.label || m.kind} is sunk into the floor`, fix: { position: [m.position[0], (m.position[1] - d.minY), m.position[2]] } });
  }

  // 3) gross proportion: a wheel must not dwarf the body
  for (const w of wheels) {
    const d = meshDims(w);
    const wheelR = Math.max(d.h, d.d) / 2;
    if (bodies.length && wheelR > bodyH * 1.6) {
      const target = bodyH * 0.9;
      const f = target / Math.max(wheelR, 1e-3);
      const s = scaleArr(w.scale);
      issues.push({ meshId: w.id, type: 'proportion', msg: `${w.label || 'wheel'} (r≈${wheelR.toFixed(2)}) is too big for the body (h≈${bodyH.toFixed(2)})`, fix: { scale: [s[0] * f, s[1], s[2] * f] } });
    }
  }

  // 4) a car needs 4 wheels (report-only — the director adds the missing ones)
  if (archetype === 'car' && wheels.length !== 4) {
    issues.push({ type: 'count', msg: `expected 4 wheels, found ${wheels.length}` });
  }
  return issues;
}

// Apply the auto-fixable issues. Returns how many were repaired.
export function applyGeometryFixes(issues) {
  const st = useStore.getState();
  const update = st.updateMesh;
  let n = 0;
  for (const it of issues) {
    if (it.global && it.shift) {
      // drop the whole assembly so its lowest point sits on the floor
      for (const m of st.meshes.filter((x) => x.kind !== 'part')) {
        const p = m.position || [0, 0, 0];
        update(m.id, { position: [p[0], p[1] - it.shift, p[2]] });
      }
      n++;
    } else if (it.meshId && it.fix) { update(it.meshId, it.fix); n++; }
  }
  return n;
}
