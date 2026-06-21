// ============================================================================
// Orchestra manufacturing & integration validation — what a manufacturing and
// an integration engineer check before a design is released:
//   • printability (FDM): minimum wall thickness, fits a print bed
//   • part fit/tolerance: every panel-mounted part has a hole ≥ its diameter;
//     internal parts (MCU, battery) fit the cavity with clearance
//   • integration: each electronic sits on the real exterior face it claims,
//     indicators point outward, nothing is buried inside a wall
//   • a Bill of Materials + a feasibility report
// Works on the authoritative Design Spec (exact mm), plus store.bom() for the BOM.
// ============================================================================
import { useStore } from './store.js';
import { PART_BY_ID } from '../data/parts.js';

const BED_MM = [220, 220, 250]; // a common desktop FDM build volume
const STRUCT_ROLES = new Set(['wall', 'floor', 'roof', 'enclosure', 'panel', 'base']);

function halfOf(b) {
  const d = b.dims_mm || {};
  const w = d.w || (d.r ? d.r * 2 : 10), h = d.h || 10, dd = d.d || (d.r ? d.r * 2 : 10);
  return [w / 2, h / 2, dd / 2];
}

export function envelopeMM(spec) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const b of spec.bodies || []) {
    const hh = halfOf(b), p = b.pos_mm || [0, 0, 0];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i] - hh[i]); max[i] = Math.max(max[i], p[i] + hh[i]); }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// FDM printability + part fit + BOM. Returns { issues, warnings, report }.
export function validateManufacture(spec) {
  const issues = [], warnings = [];
  const minWall = spec.constraints?.minWall_mm || 1.2;

  // ---- minimum wall thickness ----
  for (const b of spec.bodies || []) {
    if (!STRUCT_ROLES.has(b.role)) continue;
    const d = b.dims_mm || {};
    const t = Math.min(d.w ?? 1e9, d.h ?? 1e9, d.d ?? 1e9);
    if (t < minWall) issues.push({ type: 'wall', msg: `${b.id} is ${t.toFixed(1)} mm thick — below the ${minWall} mm minimum printable wall` });
  }

  // ---- panel-mounted part fit: each needs a through-hole ≥ its diameter ----
  for (const e of spec.electronics || []) {
    if (e.function !== 'indicator' && e.function !== 'control') continue;
    const host = (spec.bodies || []).find((b) => b.id === e.mountOn);
    const p = PART_BY_ID[e.partId];
    if (!host || !p) continue;
    const dia = Math.max(p.size.w, p.size.d);
    const hole = (host.cutouts || []).find((c) => c.forPart === e.id);
    if (!hole) { issues.push({ type: 'fit', msg: `${e.id} (${p.name}) has no mounting hole in ${host.id}` }); continue; }
    const cd = hole.dims_mm || {};
    const cross = [cd.w, cd.h, cd.d].filter((v) => v != null).sort((a, b) => a - b); // through-axis is the largest
    const minCross = cross[0] || 0;
    if (minCross + 0.01 < dia) issues.push({ type: 'fit', msg: `${e.id} hole is ${minCross.toFixed(1)} mm — too small for the ${dia.toFixed(1)} mm ${p.name}` });
  }

  // ---- internal parts fit the cavity (envelope minus two walls) ----
  const env = envelopeMM(spec);
  const interior = env.size.map((s) => Math.max(0, s - 2 * Math.max(minWall, 3)));
  for (const e of spec.electronics || []) {
    if (!['mcu', 'power', 'driver'].includes(e.function)) continue;
    const p = PART_BY_ID[e.partId]; if (!p) continue;
    const foot = [p.size.w, p.size.d].sort((a, b) => b - a); // largest two dims
    const room = [interior[0], interior[2]].sort((a, b) => b - a);
    if (foot[0] > room[0] || foot[1] > room[1]) issues.push({ type: 'fit', msg: `${p.name} (${p.size.w}×${p.size.d} mm) doesn't fit the internal cavity (~${room.map((r) => Math.round(r)).join('×')} mm)` });
  }

  // ---- print bed ----
  const sorted = [...env.size].sort((a, b) => b - a), bed = [...BED_MM].sort((a, b) => b - a);
  const fitsBed = sorted.every((s, i) => s <= bed[i] + 0.5);
  if (!fitsBed) warnings.push(`envelope ${env.size.map((s) => Math.round(s)).join('×')} mm exceeds a ${BED_MM.join('×')} mm bed — split into printable parts`);

  const bom = useStore.getState().bom();
  const report = {
    printable: issues.length === 0,
    envelope_mm: env.size.map((s) => Math.round(s)),
    minWall_mm: minWall,
    fitsBed,
    bom: { parts: bom.rows.length, total_usd: bom.total },
    warnings,
  };
  return { issues, warnings, report };
}

// Electromechanical integration: parts on the right face, outward-facing, not buried.
export function validateIntegration(spec) {
  const issues = [];
  const byId = Object.fromEntries((spec.bodies || []).map((b) => [b.id, b]));
  const AX = { '+x': 0, '-x': 0, '+y': 1, '-y': 1, '+z': 2, '-z': 2 };
  for (const e of spec.electronics || []) {
    const host = byId[e.mountOn];
    if (!host) { issues.push({ type: 'mount', msg: `${e.id} is not mounted on any body` }); continue; }
    if (e.function !== 'indicator' && e.function !== 'control') continue;
    const f = e.face || '+x';
    const ax = AX[f], sign = f[0] === '+' ? 1 : -1;
    const surface = (host.pos_mm[ax] || 0) + sign * halfOf(host)[ax];
    const pos = (e.pos_mm || [])[ax];
    const onExterior = sign > 0 ? pos >= surface - 1.5 : pos <= surface + 1.5;
    if (!onExterior) issues.push({ type: 'outward', msg: `${e.id} should sit on the exterior ${f} face of ${host.id} but is set ${Math.abs(pos - surface).toFixed(0)} mm off it` });
  }
  return { issues };
}
