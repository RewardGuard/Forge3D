import { PART_BY_ID } from '../data/parts.js';

// Compute the on-canvas pixel position of a given pin, mirroring the schematic layout
// used by CircuitCanvas (node box with pins down the left/right edges).
const NODE_W = 150;
const PIN_GAP = 22;
const PIN_TOP = 34;

export function pinPosition(node, pinIndex, totalPins) {
  const leftCount = Math.ceil(totalPins / 2);
  const isLeft = pinIndex < leftCount;
  const idxInСol = isLeft ? pinIndex : pinIndex - leftCount;
  const x = isLeft ? node.x : node.x + NODE_W;
  const y = node.y + PIN_TOP + idxInСol * PIN_GAP;
  return { x, y };
}

function pinIndexMap(part) {
  const map = {};
  part.pins.forEach((p, i) => (map[p] = i));
  return map;
}

// Produce an SVG string. Traces become filled rounded rectangles/paths so the cut
// outline yields a conductive sticker trace; pads are larger squares for parts.
export function circuitToSvg(nodes, wires, opts = {}) {
  const traceWidth = opts.traceWidth ?? 3; // mm-ish at 1px=1unit
  const padSize = opts.padSize ?? 9;
  const pxToMm = opts.pxToMm ?? 0.5; // canvas px -> mm scale for real cut size

  // bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pinPts = {}; // `${nodeId}:${pin}` -> {x,y}

  for (const node of nodes) {
    const part = PART_BY_ID[node.partId];
    const idxMap = pinIndexMap(part);
    for (const pin of part.pins) {
      const pos = pinPosition(node, idxMap[pin], part.pins.length);
      pinPts[`${node.id}:${pin}`] = pos;
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x); maxY = Math.max(maxY, pos.y);
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 200; }

  const pad = 30;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const wPx = maxX - minX;
  const hPx = maxY - minY;
  const wMm = (wPx * pxToMm).toFixed(1);
  const hMm = (hPx * pxToMm).toFixed(1);

  const tx = (x) => (x - minX).toFixed(1);
  const ty = (y) => (y - minY).toFixed(1);

  const tracePaths = wires
    .map((w) => {
      const a = pinPts[`${w.from.node}:${w.from.pin}`];
      const b = pinPts[`${w.to.node}:${w.to.pin}`];
      if (!a || !b) return '';
      const midX = (a.x + b.x) / 2;
      // orthogonal manhattan routing for clean cuts
      return `<path d="M ${tx(a.x)} ${ty(a.y)} L ${tx(midX)} ${ty(a.y)} L ${tx(midX)} ${ty(b.y)} L ${tx(b.x)} ${ty(b.y)}" fill="none" stroke="#111" stroke-width="${traceWidth}" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join('\n    ');

  const pads = Object.values(pinPts)
    .map((p) => `<rect x="${(p.x - minX - padSize / 2).toFixed(1)}" y="${(p.y - minY - padSize / 2).toFixed(1)}" width="${padSize}" height="${padSize}" rx="1.5" fill="#111"/>`)
    .join('\n    ');

  const labels = nodes
    .map((n) => {
      const part = PART_BY_ID[n.partId];
      return `<text x="${tx(n.x)}" y="${ty(n.y - 8)}" font-family="monospace" font-size="9" fill="#444">${escapeXml(part.name)}</text>`;
    })
    .join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wPx.toFixed(1)} ${hPx.toFixed(1)}">
  <desc>Forge3D sticker circuit — cut along filled black regions. Real size ${wMm}x${hMm} mm.</desc>
  <rect x="0" y="0" width="${wPx.toFixed(1)}" height="${hPx.toFixed(1)}" fill="#fff"/>
  <g id="traces">
    ${tracePaths}
  </g>
  <g id="pads">
    ${pads}
  </g>
  <g id="labels">
    ${labels}
  </g>
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
