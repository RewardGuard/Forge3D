import { PART_BY_ID, PARTS } from '../data/parts.js';
import { numberedNodeNames } from './labels.js';

// Build a human-readable text netlist of the circuit. This is both shown to the
// user (so they can see exactly what the agent sees) and sent to the AI agent
// as context for debugging. Example wires render as:  n1.+ ──── n2.VIN
export function buildNetlist(nodes, wires) {
  if (!nodes || !nodes.length) return 'Empty circuit — no parts placed yet.';
  const names = numberedNodeNames(nodes);
  const nameOf = (id) => names[id] || id;

  const lines = [];
  lines.push(`PARTS (${nodes.length}):`);
  for (const n of nodes) {
    const p = PART_BY_ID[n.partId];
    const pins = p?.pins?.length ? `[${p.pins.join(', ')}]` : '[no pins]';
    lines.push(`  ${n.id}  ${names[n.id] || n.partId}  ${pins}`);
  }

  lines.push('');
  lines.push(`WIRES (${wires.length}):`);
  if (!wires.length) lines.push('  (none)');
  for (const w of wires) {
    lines.push(
      `  ${w.from.node}.${w.from.pin} (${nameOf(w.from.node)}) ──── ${w.to.node}.${w.to.pin} (${nameOf(w.to.node)})`
    );
  }

  // List pins that aren't wired to anything — common source of bugs.
  const used = new Set();
  for (const w of wires) {
    used.add(`${w.from.node}.${w.from.pin}`);
    used.add(`${w.to.node}.${w.to.pin}`);
  }
  const loose = [];
  for (const n of nodes) {
    const p = PART_BY_ID[n.partId];
    for (const pin of p?.pins || []) {
      if (!used.has(`${n.id}.${pin}`)) loose.push(`${n.id}.${pin}`);
    }
  }
  if (loose.length) {
    lines.push('');
    lines.push('UNCONNECTED PINS:');
    lines.push('  ' + loose.join(', '));
  }

  return lines.join('\n');
}

// Compact catalog of every part the agent is allowed to add, so it only
// references real partIds and valid pins.
export function partsCatalog() {
  return PARTS.map((p) => `${p.id} — ${p.name} — [${(p.pins || []).join(', ')}]`).join('\n');
}
