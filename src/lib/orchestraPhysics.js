// ============================================================================
// Orchestra structural / physical validation — what a mechanical & structural
// engineer checks before a part is printed:
//   • grounding        — the build rests on the floor (lowest point ≈ 0)
//   • support          — every body rests on the ground or on another body
//                        (nothing floats unsupported)
//   • stability        — the center of mass sits inside the support polygon
//                        (it won't tip over)
//   • interference     — solids don't pass through each other
// Mass = material density × volume, so the COM is real, not geometric.
// Reuses worldAABB (geometry) + estimateGeom + material density.
// ============================================================================
import { useStore } from './store.js';
import { worldAABB } from './orchestraGeometry.js';
import { estimateGeom, resolveMaterial } from './lifesim.js';

const GROUND_EPS = 0.06;   // a body whose bottom is within this of the floor is "grounded"
const CONTACT_EPS = 0.12;  // vertical gap tolerated for "resting on" another body

// Physical bodies = everything solid (structure + mounted electronics), minus the
// negative CSG cutters (those are holes, not matter).
function physicalMeshes() {
  return useStore.getState().meshes.filter((m) => !m.negative);
}

function infoOf(mesh) {
  const b = worldAABB(mesh);
  const mat = resolveMaterial(mesh);
  const geom = estimateGeom(mesh);
  const mass = Math.max(0.01, (mat.density || 1) * geom.volCm3); // grams
  return { mesh, box: b, mass, minY: b.min.y, maxY: b.max.y, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2 };
}

// xz overlap (footprint) between two boxes, as a fraction of the smaller.
function footprintOverlap(a, b) {
  const ox = Math.max(0, Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x));
  const oz = Math.max(0, Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z));
  const area = ox * oz;
  const sa = (a.box.max.x - a.box.min.x) * (a.box.max.z - a.box.min.z);
  const sb = (b.box.max.x - b.box.min.x) * (b.box.max.z - b.box.min.z);
  return area / Math.max(1e-6, Math.min(sa, sb));
}

// Validate the assembly. archetype is advisory (e.g. a vehicle rolls on wheels,
// so its "ground" footprint is the wheels). Returns { issues, com, stable, mass }.
export function validateStructure() {
  const items = physicalMeshes().map(infoOf);
  if (!items.length) return { issues: [], com: [0, 0, 0], stable: true, mass: 0 };
  const structure = items.filter((it) => it.mesh.kind !== 'part'); // electronics are mounted, not free bodies
  const issues = [];

  // ---- rigid units (union-find over attachment + CSG group), so a body BOLTED
  // to the assembly counts as supported. A car chassis is held up by its wheels,
  // not by resting on the floor — without this it looks "unsupported". ----
  const parent = {};
  const find = (x) => { if (parent[x] === undefined) parent[x] = x; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (const it of items) { find(it.mesh.id); if (it.mesh.groupId) union(it.mesh.id, 'g:' + it.mesh.groupId); if (it.mesh.attachedTo) union(it.mesh.id, it.mesh.attachedTo); }
  const unitGrounded = {};
  for (const it of items) if (it.minY <= GROUND_EPS * 2) unitGrounded[find(it.mesh.id)] = true;

  // ---- grounding: at least one rigid unit must touch the floor ----
  const globalMinY = Math.min(...(structure.length ? structure : items).map((it) => it.minY));
  if (!Object.keys(unitGrounded).length && globalMinY > GROUND_EPS) {
    issues.push({ type: 'ground', global: true, shift: globalMinY, msg: `the build floats ${globalMinY.toFixed(2)}u above the floor — dropping it down` });
  } else if (globalMinY < -GROUND_EPS) {
    issues.push({ type: 'ground', global: true, shift: globalMinY, msg: `the build is sunk ${(-globalMinY).toFixed(2)}u into the floor` });
  }

  // ---- support: each body must be grounded, bolted to a grounded unit, or rest
  // on another body. Only a body whose WHOLE unit floats is flagged. ----
  for (const it of structure) {
    if (it.minY <= GROUND_EPS) continue;                 // itself on the floor
    if (unitGrounded[find(it.mesh.id)]) continue;        // rigidly held by the grounded assembly
    const restsOn = structure.some((o) => o !== it && Math.abs(it.minY - o.maxY) <= CONTACT_EPS && footprintOverlap(it, o) > 0.05);
    if (!restsOn) {
      issues.push({ type: 'support', meshId: it.mesh.id, msg: `${it.mesh.label || it.mesh.role} is unsupported (floats with nothing under it)`, fix: { position: [it.mesh.position[0], it.mesh.position[1] - (it.minY), it.mesh.position[2]] } });
    }
  }

  // ---- center of mass + support polygon (tip-over) ----
  let M = 0, cx = 0, cy = 0, cz = 0;
  for (const it of items) { M += it.mass; cx += it.mass * it.cx; cy += it.mass * ((it.box.min.y + it.box.max.y) / 2); cz += it.mass * it.cz; }
  cx /= M; cy /= M; cz /= M;
  const grounded = structure.filter((it) => it.minY <= GROUND_EPS * 2);
  if (grounded.length) {
    const minX = Math.min(...grounded.map((it) => it.box.min.x)), maxX = Math.max(...grounded.map((it) => it.box.max.x));
    const minZ = Math.min(...grounded.map((it) => it.box.min.z)), maxZ = Math.max(...grounded.map((it) => it.box.max.z));
    const mx = (maxX - minX) * 0.04, mz = (maxZ - minZ) * 0.04; // 4% inward margin
    const inside = cx >= minX + mx && cx <= maxX - mx && cz >= minZ + mz && cz <= maxZ - mz;
    if (!inside) issues.push({ type: 'stability', msg: `center of mass (${cx.toFixed(2)}, ${cz.toFixed(2)}) falls outside the support footprint — it would tip over` });
  }

  // ---- interference: large solid-solid overlap that isn't a CSG group ----
  for (let i = 0; i < structure.length; i++) {
    for (let j = i + 1; j < structure.length; j++) {
      const a = structure[i], b = structure[j];
      if (a.mesh.groupId && a.mesh.groupId === b.mesh.groupId) continue; // same CSG body
      const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      if (yOverlap > CONTACT_EPS && footprintOverlap(a, b) > 0.5) {
        issues.push({ type: 'interference', msg: `${a.mesh.label} and ${b.mesh.label} intersect each other` });
      }
    }
  }

  return { issues, com: [+cx.toFixed(3), +cy.toFixed(3), +cz.toFixed(3)], mass: +M.toFixed(0), stable: !issues.some((i) => i.type === 'stability') };
}

export function applyStructureFixes(issues) {
  const st = useStore.getState();
  const update = st.updateMesh;
  let n = 0;
  for (const it of issues) {
    if (it.global && it.shift) {
      for (const m of st.meshes.filter((x) => !x.negative)) {
        const p = m.position || [0, 0, 0];
        update(m.id, { position: [p[0], p[1] - it.shift, p[2]] });
      }
      n++;
    } else if (it.meshId && it.fix) { update(it.meshId, it.fix); n++; }
  }
  return n;
}
