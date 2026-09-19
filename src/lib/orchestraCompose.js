// ============================================================================
// Orchestra Composer — turn a Design Spec into ONE integrated model.
//
// This is where the two worlds stop being separate. From the spec we build:
//   • real-scale geometry (mm → scene units), with cutouts as REAL CSG holes
//     (doors/windows/ports) via the live boolean group renderer;
//   • the circuit, wired BY FUNCTION (button → LEDs), with matching firmware;
//   • each electronic placed as a physical body MOUNTED on the structure, whose
//     mesh id is its circuit node (`part-<nodeId>`) — so the LED you see on the
//     wall IS the LED in the netlist. Physical + electrical are one thing.
// ============================================================================
import { useStore } from './store.js';
import { PART_BY_ID, SCENE_SCALE } from '../data/parts.js';
import { partMaterial } from './materials.js';
import { synthesizeCircuit } from './orchestraCircuit.js';

const U = SCENE_SCALE / 1000; // mm → scene units (≈0.012)

// Convert real mm dimensions to a primitive's `scale`, accounting for each
// primitive's base size in geometryFactory.js. Exported so the action API can
// offer precise per-axis mm sizing (add_primitive size_mm).
export function shapeScale(shape, dims = {}, u = U) {
  // Millimetres arrive straight from an LLM (add_primitive / cut_hole / move_mesh
  // size_mm) or a generated spec, so negative and non-finite values are real
  // inputs. A NEGATIVE scale flips a mesh inside-out in three.js — inverted
  // normals, black render, and degenerate CSG cuts / physics colliders — so take
  // the magnitude and treat anything non-finite as "unspecified".
  const mm = (v) => { const n = Math.abs(Number(v)); return Number.isFinite(n) ? n : 0; };
  const dd = dims || {};
  const w = mm(dd.w) * u, h = mm(dd.h) * u, d = mm(dd.d) * u, r = mm(dd.r) * u;
  switch (shape) {
    case 'cylinder': return [(r || w / 2 || 0.05) / 0.4, h || 1, (r || d / 2 || 0.05) / 0.4];
    case 'pyramid': return [(w || 0.12) / 1.2, h || 0.1, (d || 0.12) / 1.2];  // ConeGeometry(0.6,1,4)
    case 'cone': return [w || 0.1, h || 0.1, d || 0.1];                        // ConeGeometry(0.5,1)
    default: return [w || 0.1, h || 0.1, d || 0.1];                            // box 1×1×1
  }
}

const ROLE_COLOR = {
  floor: '#6b7480', wall: '#cdd3da', roof: '#9c4a3c', enclosure: '#7c93b8',
  panel: '#8aa0c8', chassis: '#c0392b', default: '#aab3bf',
};

function nid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Build the geometry meshes for the spec. A body with cutouts becomes a live CSG
// group (positive body + negative cutters → holes); others are plain meshes.
function buildGeometry(spec) {
  const meshes = [];
  for (const b of spec.bodies || []) {
    const color = ROLE_COLOR[b.role] || ROLE_COLOR.default;
    const hasCut = (b.cutouts || []).length > 0;
    const gid = hasCut ? 'g_' + b.id : null;
    meshes.push({
      id: nid(), role: b.role, bodyId: b.id, kind: b.shape === 'box' ? 'box' : b.shape,
      label: b.id, color, materialKey: b.material,
      position: (b.pos_mm || [0, 0, 0]).map((n) => n * U),
      rotation: b.rot || [0, 0, 0],
      scale: shapeScale(b.shape, b.dims_mm),
      ...(gid ? { groupId: gid } : {}),
    });
    for (const c of b.cutouts || []) {
      meshes.push({
        id: nid(), role: 'cutout', kind: 'box', negative: true, groupId: gid,
        label: c.id || 'cutout', color: '#ef4444',
        position: (c.pos_mm || b.pos_mm).map((n) => n * U),
        rotation: [0, 0, 0],
        scale: shapeScale(c.shape || 'box', c.dims_mm),
      });
    }
  }
  return meshes;
}

// A part mesh placed at a real position, whose id ties it to its circuit node.
function partMeshFor(nodeId, partId, pos_mm) {
  const p = PART_BY_ID[partId];
  const w = Math.max((p.size.w / 1000) * SCENE_SCALE, 0.05);
  const h = Math.max((p.size.h / 1000) * SCENE_SCALE, 0.05);
  const d = Math.max((p.size.d / 1000) * SCENE_SCALE, 0.05);
  return {
    id: 'part-' + nodeId, kind: 'part', partId, role: 'electronic',
    label: p.name, size: [w, h, d], mm: [p.size.w, p.size.h, p.size.d],
    position: (pos_mm || [0, 0, 0]).map((n) => n * U), rotation: [0, 0, 0],
    color: partId === 'led-5mm' ? '#ffd23f' : p.color, scale: 1,
    material: partMaterial(partId), materialKey: partMaterial(partId).key,
  };
}

const STRUCT_ROOT = (m) => m.role === 'floor' || m.role === 'chassis' || m.role === 'base';

// Mount the electronics by reading the RESULTING NETLIST (the circuit AI created
// the nodes). We map each node to the spec's electronics of the same partId, in
// order — the i-th led-5mm node goes to the i-th indicator position, etc. Parts
// the agent added that the spec didn't position (drivers, resistors) are tucked
// inside. Geometry + physical placement stay deterministic; only wiring is the AI's.
export function mountByNetlist(spec) {
  const st = useStore.getState();
  const nodes = st.nodes;
  const elec = spec.electronics || [];
  const specByPart = {};
  for (const e of elec) (specByPart[e.partId] = specByPart[e.partId] || []).push(e);
  const used = {};
  const floor = st.meshes.find(STRUCT_ROOT);
  const home = floor ? floor.position : [0, 0.2, 0];
  const added = [];
  for (const n of nodes) {
    const pool = specByPart[n.partId];
    const i = used[n.partId] || 0; used[n.partId] = i + 1;
    const e = pool && pool[i];
    const mesh = partMeshFor(n.id, n.partId, e ? e.pos_mm : null);
    if (!e) mesh.position = [home[0] + (i % 4) * 0.05, home[1], home[2] + Math.floor(i / 4) * 0.05]; // tuck extras inside
    mesh.specFunction = e?.function;
    // rigidly fix non-wheel-driving parts to the body; motors get re-attached to
    // their wheels in assembleVehicle (so the wheel spins, not the motor)
    if (floor) { mesh.attachedTo = floor.id; mesh.drives = false; }
    added.push(mesh);
  }
  useStore.setState((s) => ({ meshes: [...s.meshes, ...added] }));
  return { mounted: added.length };
}

// Mechatronics for a vehicle: bolt each wheel onto a drive motor so it spins
// when the circuit powers that motor. The motor mesh is shrunk into the wheel hub.
export function assembleVehicle() {
  const st = useStore.getState();
  const wheels = st.meshes.filter((m) => m.role === 'wheel');
  const motors = st.meshes.filter((m) => m.kind === 'part' && m.partId === 'dc-motor');
  const upd = st.updateMesh, attach = st.setAttachment;
  let attached = 0;
  wheels.forEach((w, i) => {
    const motor = motors[i % Math.max(1, motors.length)];
    if (!motor) return;
    upd(motor.id, { position: [...w.position], scale: 0.3 }); // hide the motor in the hub
    attach(w.id, motor.id, true); // wheel spins with its motor (wheel→motor→chassis = one unit)
    attached++;
  });
  return { wheels: wheels.length, motors: motors.length, attached };
}

// A propeller / fan body spins with the nearest DC motor, exactly like a
// wheel does on a vehicle: attached, and flagged as spinning so the Life Sim
// turns it when the motor is powered.
export function attachSpinners() {
  const st = useStore.getState();
  const spinners = st.meshes.filter((m) => m.role === 'propeller' || m.role === 'fan' || m.role === 'rotor');
  const motors = st.meshes.filter((m) => m.kind === 'part' && m.partId === 'dc-motor');
  let attached = 0;
  for (const sp of spinners) {
    let best = null, bestD = Infinity;
    for (const mo of motors) { const d = Math.hypot(...sp.position.map((v, i) => v - mo.position[i])); if (d < bestD) { bestD = d; best = mo; } }
    if (!best) continue;
    st.setAttachment(sp.id, best.id, true);
    attached++;
  }
  return { spinners: spinners.length, motors: motors.length, attached };
}

// Panel-mounted indicators/controls need a through-hole so the part seats in the
// wall and its wires reach the inside. Add those holes as CSG cutouts on the host
// body BEFORE geometry is built — the design is manufacturable by construction,
// and the manufacturing validator later confirms each part has its hole.
export function addMountHoles(spec) {
  const bodyById = Object.fromEntries((spec.bodies || []).map((b) => [b.id, b]));
  for (const e of spec.electronics || []) {
    if (e.function !== 'indicator' && e.function !== 'control') continue;
    const host = bodyById[e.mountOn];
    const p = PART_BY_ID[e.partId];
    if (!host || !p) continue;
    const dia = Math.max(p.size.w, p.size.d) + 2; // part + 2 mm clearance
    const d = host.dims_mm || {};
    const dims = [d.w || 50, d.h || 50, d.d || 50];
    // The hole runs along the axis of the face the part mounts on. A thin wall
    // gets a through-hole; a thick body (an LED in a wing TIP, a switch in a
    // fuselage) gets a pocket one diameter deep from that face — the old rule
    // always drilled through the thinnest axis, which for a wing-tip LED was
    // a vertical hole in empty air next to the wing.
    const f = String(e.face || '+x');
    const axis = { x: 0, y: 1, z: 2 }[f[1]] ?? (dims[0] <= dims[1] && dims[0] <= dims[2] ? 0 : dims[2] <= dims[1] ? 2 : 1);
    const sign = f[0] === '-' ? -1 : 1;
    const thin = dims[axis] <= 2 * dia;
    const len = thin ? dims[axis] * 3 : dia;
    const cdims = axis === 0 ? { w: len, h: dia, d: dia } : axis === 2 ? { w: dia, h: dia, d: len } : { w: dia, h: len, d: dia };
    const cpos = [...(e.pos_mm || host.pos_mm)];
    cpos[axis] = thin ? host.pos_mm[axis] : host.pos_mm[axis] + sign * (dims[axis] / 2 - dia / 2 + 1); // centred in the wall, or a pocket at the face
    (host.cutouts = host.cutouts || []).push({ id: 'hole_' + e.id, shape: 'box', dims_mm: cdims, pos_mm: cpos, forPart: e.id });
  }
  return spec;
}

let _lastSpec = null;
export function getLastSpec() { return _lastSpec; }

// Build + place the deterministic GEOMETRY only (no circuit). Makes the static
// structure ONE rigid body by attaching the bodies to the floor/chassis — except
// a vehicle's wheels, which get bolted to their motors later (so they can spin).
export function composeGeometry(spec) {
  addMountHoles(spec);
  _lastSpec = spec;
  const geometry = buildGeometry(spec);
  const floor = geometry.find(STRUCT_ROOT) || geometry.find((m) => m.role !== 'cutout');
  if (floor) {
    for (const m of geometry) {
      if (m === floor || m.role === 'cutout') continue;
      if (spec.isVehicle && m.role === 'wheel') continue; // wheels attach to motors
      m.attachedTo = floor.id; m.drives = false;
    }
  }
  useStore.setState({ meshes: geometry, selectedMeshId: null, selectedMeshIds: [] });
  return {
    bodies: geometry.filter((m) => m.role !== 'cutout').length,
    cutouts: geometry.filter((m) => m.role === 'cutout').length,
    floorId: floor?.id,
  };
}

// Offline / one-shot compose (used by the design_structure tool): geometry +
// the deterministic synthesizer + mount + vehicle assembly. The pipeline's real
// path instead delegates the circuit to the build_circuit agent (with model
// escalation) and only falls back to the synthesizer when no model is available.
export function composeSpec(spec) {
  const g = composeGeometry(spec);
  synthesizeCircuit(spec);
  const m = mountByNetlist(spec);
  if (spec.isVehicle) assembleVehicle();
  return { bodies: g.bodies, cutouts: g.cutouts, mounted: m.mounted };
}
