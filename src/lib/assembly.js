// Assemblies — point 13 of the spec.
//
// A component is a mesh with an identity, material, mass and transform (it
// already had those). An assembly is a named node in a tree that owns
// components and other assemblies. The tree lives beside the meshes rather
// than inside them, so a flat scene and a deep hierarchy are the same model
// with different bookkeeping — nothing about a body changes when it is
// moved into a subassembly.
//
// Exploded views are DISPLAY offsets kept in the viewport state, never
// written to positions, so an exploded assembly still exports assembled.
//
// Interference uses the kernel's exact surface distance for bodies it can
// rebuild and a bounding-box test for the rest; every pair reports which.

import { useStore } from './store.js';
import { measureBody, measureBetween } from './measure.js';
import { kernelSupports } from './kernelBridge.js';
import { MATERIALS, partMaterialKey } from './materials.js';
import { PART_BY_ID } from '../data/parts.js';
import { worldAABB } from './orchestraGeometry.js';
import { SCENE_SCALE } from '../data/parts.js';

const MM = SCENE_SCALE / 1000;
const toMm = (u) => u / MM;
const ROOT = 'root';

// ── Tree ──────────────────────────────────────────────────────────────────
export function assemblyTree() {
  const s = useStore.getState();
  const asm = s.assemblies || {};
  const meshes = s.meshes || [];
  const nodes = {};
  nodes[ROOT] = { id: ROOT, name: s.projectName || 'Assembly', parentId: null, children: [], meshes: [], depth: 0 };
  for (const a of Object.values(asm)) nodes[a.id] = { ...a, children: [], meshes: [], depth: 0 };
  for (const a of Object.values(nodes)) {
    if (a.id === ROOT) continue;
    const parent = nodes[a.parentId] || nodes[ROOT];
    parent.children.push(a.id);
  }
  for (const m of meshes) {
    const owner = nodes[m.assemblyId] || nodes[ROOT];
    owner.meshes.push(m.id);
  }
  // depth
  const walk = (id, d) => { nodes[id].depth = d; for (const c of nodes[id].children) walk(c, d + 1); };
  walk(ROOT, 0);
  return { nodes, root: ROOT };
}

/** Every mesh id under an assembly, recursively. */
export function meshesUnder(assemblyId, tree = assemblyTree()) {
  const out = [];
  const walk = (id) => { const n = tree.nodes[id]; if (!n) return; out.push(...n.meshes); for (const c of n.children) walk(c); };
  walk(assemblyId || ROOT);
  return out;
}

/** Would moving `id` under `newParent` create a cycle? */
export function wouldCycle(id, newParent, tree = assemblyTree()) {
  let cur = newParent;
  while (cur && cur !== ROOT) { if (cur === id) return true; cur = tree.nodes[cur]?.parentId; }
  return false;
}

// ── Mass roll-up ──────────────────────────────────────────────────────────
export async function assemblyMass(assemblyId) {
  const tree = assemblyTree();
  const ids = meshesUnder(assemblyId, tree);
  const meshes = useStore.getState().meshes;
  let mass = 0, exact = 0; const com = [0, 0, 0]; const rows = [];
  for (const id of ids) {
    const m = meshes.find((x) => x.id === id); if (!m) continue;
    const r = await measureBody(m);
    if (!r.ok) continue;
    mass += r.mass_g; if (r.source === 'kernel') exact++;
    for (let i = 0; i < 3; i++) com[i] += r.centreOfMass_mm[i] * r.mass_g;
    rows.push({ id, label: m.label || id, mass_g: r.mass_g, source: r.source });
  }
  return {
    assemblyId: assemblyId || ROOT, components: ids.length, exact,
    mass_g: +mass.toFixed(3),
    centreOfMass_mm: mass > 0 ? com.map((v) => +(v / mass).toFixed(2)) : [0, 0, 0],
    rows,
    basis: `${exact} of ${ids.length} bodies measured exactly by the kernel; the rest from the primitive model. Solid bodies assumed.`,
  };
}

// ── Exploded view ─────────────────────────────────────────────────────────
/**
 * Display offsets that push each body away from its assembly's centre,
 * scaled by `factor` (0 = assembled). Subassemblies explode as a unit
 * first, then their members — so structure reads at a glance.
 */
export function explodedOffsets(factor, assemblyId = ROOT) {
  const tree = assemblyTree();
  const meshes = useStore.getState().meshes;
  const byId = Object.fromEntries(meshes.map((m) => [m.id, m]));
  const offsets = {};
  if (!(factor > 0)) return offsets;

  const centreOf = (ids) => {
    const pts = ids.map((i) => byId[i]?.position).filter(Boolean);
    if (!pts.length) return [0, 0, 0];
    return pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / pts.length);
  };
  const walk = (id, inherited) => {
    const n = tree.nodes[id]; if (!n) return;
    const all = meshesUnder(id, tree);
    const c = centreOf(all);
    // members explode from this node's centre
    for (const mid of n.meshes) {
      const p = byId[mid]?.position || [0, 0, 0];
      const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const len = Math.hypot(...d) || 1;
      // radial push proportional to distance from centre, with a floor so
      // co-located parts still separate; small upward bias so stacks lift
      const push = (0.35 + len) * factor;
      offsets[mid] = [inherited[0] + (d[0] / len) * push, inherited[1] + (d[1] / len) * push + 0.15 * factor, inherited[2] + (d[2] / len) * push];
    }
    // subassemblies explode as units from the parent centre, then recurse
    for (const cid of n.children) {
      const sub = meshesUnder(cid, tree);
      const sc = centreOf(sub);
      const d = [sc[0] - c[0], sc[1] - c[1], sc[2] - c[2]];
      const len = Math.hypot(...d) || 1;
      const push = (0.6 + len) * factor;
      walk(cid, [inherited[0] + (d[0] / len) * push, inherited[1] + (d[1] / len) * push + 0.2 * factor, inherited[2] + (d[2] / len) * push]);
    }
  };
  walk(assemblyId, [0, 0, 0]);
  return offsets;
}

// ── Interference ──────────────────────────────────────────────────────────
/**
 * Pairwise check. Exact (kernel surface distance) where both bodies are
 * kernel solids, bounding-box otherwise — each pair says which. Pairs that
 * are declared attached (attachedTo) or share a CSG group are expected to
 * touch and are skipped.
 */
export async function interferenceReport({ clearanceMm = 0.5, assemblyId = ROOT } = {}) {
  const meshes = useStore.getState().meshes;
  const ids = meshesUnder(assemblyId);
  const list = meshes.filter((m) => ids.includes(m.id) && !m.negative);
  const overlaps = [], nearMisses = []; let pairs = 0, exact = 0;

  const related = (a, b) => a.attachedTo === b.id || b.attachedTo === a.id || (a.groupId && a.groupId === b.groupId);
  const aabbOverlapMm = (a, b) => {
    const A = worldAABB(a), B = worldAABB(b);
    if (!A?.min || !B?.min) return null;
    const ox = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x);
    const oy = Math.min(A.max.y, B.max.y) - Math.max(A.min.y, B.min.y);
    const oz = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z);
    if (ox <= 0 || oy <= 0 || oz <= 0) return { overlap: false, gapMm: toMm(Math.max(-ox, -oy, -oz)) };
    return { overlap: true, depthMm: toMm(Math.min(ox, oy, oz)) };
  };

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (related(a, b)) continue;
      pairs++;
      const box = aabbOverlapMm(a, b);
      if (box && !box.overlap && box.gapMm > clearanceMm * 4) continue;   // far apart by bounds — no need for the kernel
      if (kernelSupports(a.kind) && kernelSupports(b.kind)) {
        const d = await measureBetween(a, b);
        if (d.source === 'kernel' && d.minDistance_mm != null) {
          exact++;
          if (d.overlapping || d.minDistance_mm < 1e-3) {
            overlaps.push({ a: a.id, b: b.id, aLabel: a.label || a.id, bLabel: b.label || b.id, method: 'exact', depthMm: box?.overlap ? +box.depthMm.toFixed(2) : 0,
              msg: `${a.label || a.id} and ${b.label || b.id} ${d.overlapping ? 'pass through each other' : 'touch'} (exact surface check).` });
          } else if (d.minDistance_mm < clearanceMm) {
            nearMisses.push({ a: a.id, b: b.id, aLabel: a.label || a.id, bLabel: b.label || b.id, method: 'exact', gapMm: d.minDistance_mm,
              msg: `${a.label || a.id} and ${b.label || b.id} are ${d.minDistance_mm.toFixed(2)} mm apart — under the ${clearanceMm} mm clearance.` });
          }
          continue;
        }
      }
      if (box?.overlap) {
        overlaps.push({ a: a.id, b: b.id, aLabel: a.label || a.id, bLabel: b.label || b.id, method: 'bounding-box', depthMm: +box.depthMm.toFixed(2),
          msg: `${a.label || a.id} and ${b.label || b.id} overlap by ${box.depthMm.toFixed(1)} mm (bounding boxes — conservative; the real solids may miss).` });
      } else if (box && box.gapMm < clearanceMm) {
        nearMisses.push({ a: a.id, b: b.id, aLabel: a.label || a.id, bLabel: b.label || b.id, method: 'bounding-box', gapMm: +box.gapMm.toFixed(2),
          msg: `${a.label || a.id} and ${b.label || b.id} boxes are ${box.gapMm.toFixed(2)} mm apart.` });
      }
    }
  }
  return {
    ok: overlaps.length === 0, pairs, exact, clearanceMm, overlaps, nearMisses,
    basis: `${pairs} pairs checked (${exact} with exact kernel surface distance, the rest by bounding box). Attached and grouped pairs are expected to touch and were skipped. Static positions only — moving parts are not swept through their travel.`,
  };
}

// ── BOM ───────────────────────────────────────────────────────────────────
/**
 * Bill of materials for an assembly: identical bodies (same kind, size,
 * material) collapse into one line with a quantity; catalogue parts keep
 * their part number and price. Mass per line comes from the measurement
 * module, so it matches what the Inspector shows.
 */
export async function assemblyBOM(assemblyId = ROOT) {
  const tree = assemblyTree();
  const meshes = useStore.getState().meshes;
  const ids = meshesUnder(assemblyId, tree);
  const lines = new Map();
  for (const id of ids) {
    const m = meshes.find((x) => x.id === id); if (!m || m.negative) continue;
    const r = await measureBody(m);
    const matKey = m.kind === 'part' && m.partId ? partMaterialKey(m.partId) : (m.material || m.materialKey || 'pla');
    const size = r.ok && r.boundingBox ? r.boundingBox.size_mm.map((v) => v.toFixed(1)).join('×') : '—';
    const key = m.kind === 'part' ? `part:${m.partId}` : `${m.kind}:${size}:${matKey}:${m.cornerRadius_mm || 0}`;
    const part = m.kind === 'part' ? PART_BY_ID[m.partId] : null;
    const line = lines.get(key) || {
      key, qty: 0,
      description: part ? part.name : `${m.kind}${m.cornerRadius_mm ? ` r${m.cornerRadius_mm}` : ''} ${size} mm`,
      partNumber: part ? m.partId : null,
      material: part ? (MATERIALS[matKey]?.name || matKey) : (MATERIALS[matKey]?.name || matKey),
      unitMass_g: r.ok ? r.mass_g : null,
      unitPrice: part ? part.price : null,
      source: r.ok ? r.source : 'unknown',
      ids: [],
    };
    line.qty++; line.ids.push(id);
    lines.set(key, line);
  }
  const rows = [...lines.values()].map((l) => ({
    ...l,
    lineMass_g: l.unitMass_g != null ? +(l.unitMass_g * l.qty).toFixed(2) : null,
    linePrice: l.unitPrice != null ? +(l.unitPrice * l.qty).toFixed(2) : null,
  })).sort((a, b) => (a.partNumber ? 0 : 1) - (b.partNumber ? 0 : 1) || a.description.localeCompare(b.description));
  return {
    assemblyId, lines: rows.length, items: rows.reduce((a, r) => a + r.qty, 0),
    totalMass_g: +rows.reduce((a, r) => a + (r.lineMass_g || 0), 0).toFixed(2),
    totalPrice: +rows.reduce((a, r) => a + (r.linePrice || 0), 0).toFixed(2),
    rows,
    note: 'Price is known only for catalogue parts. Printed/machined bodies have no price here — mass is what you would quote from.',
  };
}

export function bomToCsv(bom) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Qty', 'Description', 'Part number', 'Material', 'Unit mass (g)', 'Line mass (g)', 'Unit price', 'Line price', 'Measured'];
  const rows = bom.rows.map((r) => [r.qty, r.description, r.partNumber || '', r.material, r.unitMass_g ?? '', r.lineMass_g ?? '', r.unitPrice ?? '', r.linePrice ?? '', r.source]);
  return [head, ...rows, ['', 'TOTAL', '', '', '', bom.totalMass_g, '', bom.totalPrice, '']].map((r) => r.map(esc).join(',')).join('\n');
}

export { ROOT };
