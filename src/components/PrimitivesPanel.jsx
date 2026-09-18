import React from 'react';
import { useStore } from '../lib/store.js';
import { DEFAULT_SHAPE_UNIT } from '../data/parts.js';

// Built-in primitive shapes the user can drop straight into the scene. This is
// the first thing in the 3D Design sidebar: the most basic CAD action should
// never be buried under the AI tools.
export const PRIMITIVES = [
  { kind: 'box', label: 'Box', color: '#7c93b8', glyph: '▢' },
  { kind: 'sphere', label: 'Sphere', color: '#b88a8a', glyph: '●' },
  { kind: 'cylinder', label: 'Cylinder', color: '#8ab89a', glyph: '⬭' },
  { kind: 'cone', label: 'Cone', color: '#b8a07c', glyph: '▲' },
  { kind: 'pyramid', label: 'Pyramid', color: '#a98ab8', glyph: '◭' },
  { kind: 'torus', label: 'Torus', color: '#8ab8b2', glyph: '◯' },
  { kind: 'torusknot', label: 'Knot', color: '#b87ca0', glyph: '∞' },
  { kind: 'capsule', label: 'Capsule', color: '#7cb88f', glyph: '⬬' },
  { kind: 'plane', label: 'Plate', color: '#9aa7bd', glyph: '▬' },
  { kind: 'tetrahedron', label: 'Tetra', color: '#c0a062', glyph: '◬' },
  { kind: 'icosahedron', label: 'Icosa', color: '#6294c0', glyph: '⬢' },
];

export default function PrimitivesPanel() {
  const addMesh = useStore((s) => s.addMesh);
  return (
    <div className="prim-grid" data-tut="add-shape">
      {PRIMITIVES.map((p) => (
        <button key={p.kind} className="prim-btn" title={`Add a ${p.label.toLowerCase()}`}
          onClick={() => addMesh({ kind: p.kind, label: p.label, color: p.color, scale: DEFAULT_SHAPE_UNIT })}>
          <span className="prim-glyph" style={{ color: p.color }}>{p.glyph}</span>
          <span className="prim-label">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
