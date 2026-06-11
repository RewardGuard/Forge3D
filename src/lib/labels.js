import { PART_BY_ID } from '../data/parts.js';

// Stable per-instance display names: when a circuit has several of the same
// part, number them ("DC Motor 6V #1", "#2"…) so you can tell them apart in
// the canvas, simulation list, netlist and Life Sim.
export function numberedNodeNames(nodes) {
  const totals = {};
  for (const n of nodes) totals[n.partId] = (totals[n.partId] || 0) + 1;
  const counts = {};
  const map = {};
  for (const n of nodes) {
    const base = PART_BY_ID[n.partId]?.name || n.partId;
    counts[n.partId] = (counts[n.partId] || 0) + 1;
    map[n.id] = totals[n.partId] > 1 ? `${base} #${counts[n.partId]}` : base;
  }
  return map;
}
