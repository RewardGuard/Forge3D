import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import { DEFAULT_SHAPE_UNIT, SCENE_SCALE } from '../data/parts.js';

export default function ThingiversePanel() {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | searching | done | error
  const [message, setMessage] = useState('');
  const [importingId, setImportingId] = useState(null);

  const hasThingiverseToken = useStore((s) => s.hasThingiverseToken);
  const addMesh = useStore((s) => s.addMesh);

  async function search(e) {
    e?.preventDefault?.();
    if (!term.trim()) return;
    setStatus('searching');
    setMessage('Searching Thingiverse…');
    try {
      const { hits, total } = await window.forge.thingiverse.search({ term, perPage: 24 });
      setHits(hits || []);
      setStatus('done');
      setMessage((hits?.length || 0) === 0 ? 'No models found.' : `${total ?? hits.length} results.`);
    } catch (err) {
      setStatus('error');
      setMessage(String(err.message || err));
    }
  }

  async function importThing(hit) {
    setImportingId(hit.id);
    setMessage(`Importing “${hit.name}”…`);
    try {
      const { bytes, name, dims_mm } = await window.forge.thingiverse.import({ thingId: hit.id });
      if (!bytes) throw new Error('No STL returned.');
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
      // place at the STL's REAL size (native mm) when it could be measured —
      // the viewer normalizes to longest-dim=1, so longest-mm × scale restores it
      const mesh = { kind: 'stl', label: name || hit.name, color: '#9aa7bd', modelUrl: blobUrl, scale: DEFAULT_SHAPE_UNIT };
      const mx = dims_mm ? Math.max(dims_mm.w, dims_mm.h, dims_mm.d) : 0;
      if (mx > 0) {
        mesh.scale = (mx / 1000) * SCENE_SCALE;
        mesh.half = [dims_mm.w / (2 * mx), dims_mm.h / (2 * mx), dims_mm.d / (2 * mx)];
        mesh.mm = [dims_mm.w, dims_mm.h, dims_mm.d];
      }
      addMesh(mesh);
      setStatus('done');
      setMessage(`Imported “${hit.name}”${mx > 0 ? ` at real size (${Math.round(dims_mm.w)}×${Math.round(dims_mm.h)}×${Math.round(dims_mm.d)} mm)` : ''}.`);
    } catch (err) {
      setStatus('error');
      setMessage(String(err.message || err));
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="panel scroll">
      <h3>Thingiverse Search</h3>

      {!hasThingiverseToken && (
        <p className="status error">
          Add a free Thingiverse app token in Settings (top-right) first.
        </p>
      )}

      <form className="search" onSubmit={search}>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search models (e.g. raspberry pi case)…"
          disabled={!hasThingiverseToken}
        />
        <button
          className="btn primary full"
          style={{ marginTop: 6 }}
          disabled={!hasThingiverseToken || status === 'searching' || !term.trim()}
        >
          {status === 'searching' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {message && <p className={'status ' + (status === 'searching' ? 'running' : status)}>{message}</p>}

      <div className="thingi-grid">
        {hits.map((h) => (
          <div className="thingi-card" key={h.id}>
            <a
              className="thingi-thumb-wrap"
              href={h.publicUrl}
              target="_blank"
              rel="noreferrer"
              title="Open on Thingiverse"
            >
              {h.thumbnail ? (
                <img className="thingi-thumb" src={h.thumbnail} alt={h.name} loading="lazy" />
              ) : (
                <div className="thingi-thumb placeholder">STL</div>
              )}
            </a>
            <div className="thingi-name" title={h.name}>{h.name}</div>
            {h.creator && <div className="thingi-creator">by {h.creator}</div>}
            <button
              className="btn full"
              disabled={importingId === h.id}
              onClick={() => importThing(h)}
            >
              {importingId === h.id ? 'Importing…' : '+ Import to scene'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
