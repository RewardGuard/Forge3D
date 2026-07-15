import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.js';
import markUrl from '../../assets/forge3d-mark.png';
import ConnectClaudeButton from '../onboarding/ConnectClaudeButton.jsx';
import UpgradeButton from '../onboarding/UpgradeButton.jsx';
import StoragePanel from './StoragePanel.jsx';
import AdStrip from './AdStrip.jsx';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const iconFor = (name) => {
  const ext = String(name).split('.').pop().toLowerCase();
  if (ext === 'stl' || ext === '3mf') return '🧊';
  if (ext === 'obj' || ext === 'gltf' || ext === 'glb') return '🗿';
  if (ext === 'svg') return '🏷';
  if (ext === 'zip') return '🗜';
  return '📁';
};

// The home base: your projects, split into In Development (.f3d drafts) and
// Production (exported STL/SVG/BOM packages). Corner holds Connect-to-Claude +
// Upgrade. A tiny ad strip sits at the very bottom until you're entitled.
export default function HomeDashboard() {
  const setShellView = useStore((s) => s.setShellView);
  const loadProject = useStore((s) => s.loadProject);
  const me = useStore((s) => s.me);

  const [{ projects, production }, setLists] = useState({ projects: [], production: [] });
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await window.forge.projects.list();
      setLists({ projects: res.projects || [], production: res.production || [] });
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function openProject(p) {
    const res = await window.forge.projects.openPath(p.path);
    if (res?.opened && res.content) {
      loadProject(res.content);
      setShellView('editor');
    }
  }

  function newProject() {
    // start from a clean scene in the editor
    useStore.setState({ meshes: [], nodes: [], wires: [], codeByNode: {}, selectedMeshId: null, selectedNodeId: null, pendingPin: null, tab: 'orchestra' });
    setShellView('editor');
  }

  return (
    <div className="hd-root">
      <header className="hd-top">
        <div className="brand">
          <img className="logo-img" src={markUrl} alt="" /> Forge3D
        </div>
        <div className="spacer" />
        <span className="hd-account muted small">
          {me?.email ? me.email : 'Offline'}
          {me?.plan === 'pro' && <span className="badge orc-badge-done" style={{ marginLeft: 6 }}>PRO</span>}
          {me?.trial?.active && <span className="badge" style={{ marginLeft: 6 }}>TRIAL</span>}
        </span>
        <ConnectClaudeButton />
        <UpgradeButton />
      </header>

      <main className="hd-main">
        <div className="hd-hero">
          <h1>Your projects</h1>
          <button className="btn primary" onClick={newProject}>＋ New project</button>
        </div>

        <section>
          <div className="hd-sec-head"><h2>In development</h2><span className="muted small">{projects.length} · editable .f3d drafts</span></div>
          {loading ? <p className="muted small">Loading…</p> : projects.length === 0 ? (
            <div className="hd-empty">No drafts yet. Start a <b>New project</b> or ask Claude to build one.</div>
          ) : (
            <div className="hd-grid">
              {projects.map((p) => (
                <button key={p.path} className="hd-tile dev" onClick={() => openProject(p)} title={p.path}>
                  <span className="hd-tile-ico">✎</span>
                  <span className="hd-tile-name">{p.name.replace(/\.(f3d|json)$/i, '')}</span>
                  <span className="hd-tile-meta">edited {fmtDate(p.mtime)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="hd-sec-head"><h2>Production</h2><span className="muted small">{production.length} · exported STL / SVG / BOM</span></div>
          {loading ? <p className="muted small">Loading…</p> : production.length === 0 ? (
            <div className="hd-empty">Nothing exported yet. Finish a design and export it to see fabrication-ready files here.</div>
          ) : (
            <div className="hd-grid">
              {production.map((p) => (
                <button key={p.path} className="hd-tile prod" onClick={() => window.forge.projects.reveal(p.path)} title={p.path}>
                  <span className="hd-tile-ico">{p.isDir ? '📦' : iconFor(p.name)}</span>
                  <span className="hd-tile-name">{p.name}</span>
                  <span className="hd-tile-meta">{p.isDir ? 'package' : 'file'} · {fmtDate(p.mtime)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <StoragePanel />

        <div className="hd-footer">
          <button className="linkish" onClick={() => setShellView('tutorial')}>↻ Replay tutorial</button>
          <button className="linkish" onClick={refresh}>Refresh projects</button>
        </div>
      </main>

      <AdStrip />
    </div>
  );
}
