import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../lib/store.js';
import { buildProductionFiles } from '../lib/production.js';

function fmtDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtSize(b) {
  if (b == null) return '';
  if (b > 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GB';
  if (b > 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MB';
  return Math.max(1, Math.round(b / 1024)) + ' KB';
}

// In-app project library: browse drafts (.f3d) and production packages without
// digging through Finder, plus one-click "export to production" (USB-ready).
export default function ProjectsModal() {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState({ projects: [], production: [] });
  const [prodName, setProdName] = useState('my-project');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProject = useStore((s) => s.loadProject);
  const serialize = useStore((s) => s.serialize);
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const meshes = useStore((s) => s.meshes);
  const codeByNode = useStore((s) => s.codeByNode);
  const bom = useStore((s) => s.bom);
  const exportQuality = useStore((s) => s.exportQuality);

  const refresh = useCallback(() => {
    window.forge.projects.list().then(setLists).catch(() => setLists({ projects: [], production: [] }));
  }, []);
  useEffect(() => { if (open) { refresh(); setStatus(''); } }, [open, refresh]);

  async function openProject(p) {
    const res = await window.forge.projects.openPath(p.path);
    if (res?.opened) {
      loadProject(res.content);
      setOpen(false);
    }
  }

  async function exportProduction() {
    setBusy(true);
    setStatus('Building production package (code, STL, SVG, summary)…');
    try {
      const files = await buildProductionFiles({
        name: prodName, serialize, nodes, wires, meshes, codeByNode, bom: bom(), quality: exportQuality,
      });
      const res = await window.forge.production.export({ name: prodName, files });
      if (res?.ok) {
        setStatus(`✓ Ready for the USB → ${res.path}${res.zipped ? ' (zipped: exceeded 128 GB)' : ''} · ${fmtSize(res.size)}`);
        refresh();
      } else {
        setStatus('Export failed.');
      }
    } catch (err) {
      setStatus('Error: ' + String(err?.message || err));
    }
    setBusy(false);
  }

  return (
    <>
      <button className="mini" onClick={() => setOpen(true)} title="Project library & production exports">📁 Projects</button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Projects</h3>
              <button className="modal-x" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              {/* ===== drafts ===== */}
              <section className="set-section">
                <h4>Projects (drafts — .f3d)</h4>
                {lists.projects.length === 0 ? (
                  <p className="muted small">No saved projects yet. Use <b>Save</b> in the top bar — they'll show up here.</p>
                ) : (
                  <div className="proj-list">
                    {lists.projects.map((p) => (
                      <div key={p.path} className="proj-row">
                        <span className="proj-name">{p.name}</span>
                        <span className="proj-meta">{fmtDate(p.mtime)} · {fmtSize(p.size)}</span>
                        <button className="btn" onClick={() => openProject(p)}>Open</button>
                        <button className="btn ghost" onClick={() => window.forge.projects.reveal(p.path)} title="Show in Finder">⌖</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ===== production ===== */}
              <section className="set-section">
                <h4>Production level</h4>
                <p className="muted small">
                  Packages everything for the workshop USB: board code (.ino / .py + Pi OS setup notes),
                  the <b>.stl</b> for the da Vinci mini maker, the <b>.svg</b> for the Silhouette Cameo,
                  and a summary with cost, Amazon links and the thermal breaking point. Zipped automatically
                  only if it would exceed your 128 GB USB.
                </p>
                <div className="key-row">
                  <input value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="package name…" />
                  <button className="btn primary" disabled={busy || !prodName.trim()} onClick={exportProduction}>
                    {busy ? 'Packaging…' : '📦 Export production'}
                  </button>
                </div>
                {status && <p className="status">{status}</p>}

                {lists.production.length > 0 && (
                  <div className="proj-list">
                    {lists.production.map((p) => (
                      <div key={p.path} className="proj-row">
                        <span className="proj-name">{p.isDir ? '📦 ' : '🗜 '}{p.name}</span>
                        <span className="proj-meta">{fmtDate(p.mtime)}</span>
                        <button className="btn" onClick={() => window.forge.projects.reveal(p.path)}>Show in Finder</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="modal-foot">
              <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
