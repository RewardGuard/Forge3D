import React, { useState } from 'react';
import { PARTS, CATEGORIES } from '../data/parts.js';
import { useStore } from '../lib/store.js';

export default function PartsLibrary() {
  const [q, setQ] = useState('');
  const addNode = useStore((s) => s.addNode);
  const query = q.trim().toLowerCase();

  return (
    <div className="panel scroll">
      <h3>Parts Library</h3>
      <input className="search" placeholder="Search parts…" value={q} onChange={(e) => setQ(e.target.value)} />
      {CATEGORIES.map((cat) => {
        const items = PARTS.filter(
          (p) => p.category === cat && (!query || p.name.toLowerCase().includes(query))
        );
        if (!items.length) return null;
        return (
          <div key={cat} className="cat">
            <div className="cat-title">{cat}</div>
            {items.map((p) => (
              <button key={p.id} className="part-card" onClick={() => addNode(p.id)} title={p.desc}>
                <span className="swatch" style={{ background: p.color }} />
                <span className="part-name">{p.name}</span>
                <span className="part-price">${p.price.toFixed(2)}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
