// The viewport toolbar — what every professional CAD viewport has along its
// edge: standard views, projection, shading, a section plane, visibility and
// camera bookmarks. All of it is display state; none of it touches geometry.
//
// Keyboard: 1 front · 2 back · 3 left · 4 right · 5 top · 6 bottom · 7 iso
//           P projection · W wireframe · E edges · X x-ray · S shaded
//           H hide selected · I isolate · Shift+H show all · G grid · C section
import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';

const VIEWS = [['front', 'Front', '1'], ['back', 'Back', '2'], ['left', 'Left', '3'], ['right', 'Right', '4'],
               ['top', 'Top', '5'], ['bottom', 'Bottom', '6'], ['iso', 'Iso', '7']];
const SHADING = [['shaded', 'Shaded', 'S'], ['edges', '+Edges', 'E'], ['wireframe', 'Wire', 'W'], ['xray', 'X-ray', 'X']];

export default function ViewportToolbar() {
  const vp = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.setViewport);
  const setClip = useStore((s) => s.setClip);
  const setCameraView = useStore((s) => s.setCameraView);
  const hideSelected = useStore((s) => s.hideSelected);
  const isolateSelected = useStore((s) => s.isolateSelected);
  const showAll = useStore((s) => s.showAll);
  const removeBookmark = useStore((s) => s.removeBookmark);
  const recallBookmark = useStore((s) => s.recallBookmark);
  const requestBookmark = useStore((s) => s.requestBookmark);
  const selected = useStore((s) => s.selectedMeshId);
  const meshCount = useStore((s) => s.meshes.length);
  const [open, setOpen] = useState('views');
  const [bmName, setBmName] = useState('');

  const hiddenCount = vp.hiddenIds.length + (vp.isolatedIds ? meshCount - vp.isolatedIds.length : 0);

  // keyboard shortcuts — ignored while typing in a field
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest?.('.cm-editor'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const view = VIEWS.find(([, , key]) => key === k);
      if (view) { setCameraView(view[0]); return; }
      const sh = SHADING.find(([, , key]) => key.toLowerCase() === k.toLowerCase() && !e.shiftKey);
      if (sh) { setViewport({ shading: sh[0] }); return; }
      if (k === 'p' || k === 'P') setViewport({ projection: vp.projection === 'perspective' ? 'orthographic' : 'perspective' });
      else if (k === 'g' || k === 'G') setViewport({ grid: !vp.grid });
      else if (k === 'c' || k === 'C') setClip({ enabled: !vp.clip.enabled });
      else if (k === 'H') showAll();
      else if (k === 'h') hideSelected();
      else if (k === 'i' || k === 'I') isolateSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [vp, setViewport, setClip, setCameraView, hideSelected, isolateSelected, showAll]);

  const Tab = ({ id, label }) => (
    <button className={'vpt-tab' + (open === id ? ' on' : '')} onClick={() => setOpen(open === id ? null : id)}>{label}</button>
  );

  return (
    <div className="vpt">
      <div className="vpt-tabs">
        <Tab id="views" label="View" />
        <Tab id="shading" label={SHADING.find(([id]) => id === vp.shading)?.[1] || 'Shading'} />
        <Tab id="section" label={vp.clip.enabled ? `Section ${vp.clip.axis.toUpperCase()}` : 'Section'} />
        <Tab id="vis" label={hiddenCount ? `Hidden ${hiddenCount}` : 'Visibility'} />
        <Tab id="bm" label={vp.bookmarks.length ? `Views ★${vp.bookmarks.length}` : 'Bookmarks'} />
      </div>

      {open === 'views' && (
        <div className="vpt-panel">
          <div className="vpt-row">
            {VIEWS.map(([id, label, key]) => (
              <button key={id} className="vpt-btn" title={`${label} (${key})`} onClick={() => setCameraView(id)}>{label}</button>
            ))}
          </div>
          <div className="vpt-row">
            <button className={'vpt-btn' + (vp.projection === 'perspective' ? ' on' : '')} onClick={() => setViewport({ projection: 'perspective' })} title="Perspective (P)">Perspective</button>
            <button className={'vpt-btn' + (vp.projection === 'orthographic' ? ' on' : '')} onClick={() => setViewport({ projection: 'orthographic' })} title="Orthographic (P) — parallel lines stay parallel, as on a drawing">Orthographic</button>
            <button className={'vpt-btn' + (vp.grid ? ' on' : '')} onClick={() => setViewport({ grid: !vp.grid })} title="Grid (G)">Grid</button>
          </div>
        </div>
      )}

      {open === 'shading' && (
        <div className="vpt-panel">
          <div className="vpt-row">
            {SHADING.map(([id, label, key]) => (
              <button key={id} className={'vpt-btn' + (vp.shading === id ? ' on' : '')} title={`${label} (${key})`} onClick={() => setViewport({ shading: id })}>{label}</button>
            ))}
          </div>
          <p className="vpt-note">Display only — never changes the model, its mass or what exports.</p>
        </div>
      )}

      {open === 'section' && (
        <div className="vpt-panel">
          <div className="vpt-row">
            <button className={'vpt-btn' + (vp.clip.enabled ? ' on' : '')} onClick={() => setClip({ enabled: !vp.clip.enabled })} title="Section plane (C)">{vp.clip.enabled ? 'Section ON' : 'Section OFF'}</button>
            {['x', 'y', 'z'].map((a) => (
              <button key={a} className={'vpt-btn' + (vp.clip.axis === a ? ' on' : '')} onClick={() => setClip({ axis: a, enabled: true })}>{a.toUpperCase()}</button>
            ))}
            <button className={'vpt-btn' + (vp.clip.flip ? ' on' : '')} onClick={() => setClip({ flip: !vp.clip.flip })} title="Keep the other half">Flip</button>
          </div>
          <div className="vpt-row">
            <input type="range" min="-300" max="300" step="0.5" value={vp.clip.offsetMm} onChange={(e) => setClip({ offsetMm: parseFloat(e.target.value), enabled: true })} style={{ flex: 1 }} />
            <input type="number" step="0.5" value={vp.clip.offsetMm} onChange={(e) => setClip({ offsetMm: parseFloat(e.target.value) || 0, enabled: true })} style={{ width: 74 }} />
            <span className="muted small">mm</span>
          </div>
          <p className="vpt-note">Cuts the view along the {vp.clip.axis.toUpperCase()} axis at {vp.clip.offsetMm} mm to show the inside. The model is untouched.</p>
        </div>
      )}

      {open === 'vis' && (
        <div className="vpt-panel">
          <div className="vpt-row">
            <button className="vpt-btn" disabled={!selected} onClick={hideSelected} title="Hide selected (H)">Hide</button>
            <button className="vpt-btn" disabled={!selected} onClick={isolateSelected} title="Show only the selection (I)">Isolate</button>
            <button className="vpt-btn" disabled={!hiddenCount} onClick={showAll} title="Show all (Shift+H)">Show all</button>
          </div>
          <p className="vpt-note">{hiddenCount ? `${hiddenCount} of ${meshCount} bodies hidden from view — still in the model and in every export.` : 'Select a body to hide it or isolate it.'}</p>
        </div>
      )}

      {open === 'bm' && (
        <div className="vpt-panel">
          <div className="vpt-row">
            <input value={bmName} onChange={(e) => setBmName(e.target.value)} placeholder="Name this camera angle…" style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter' && bmName.trim()) { requestBookmark(bmName.trim()); setBmName(''); } }} />
            <button className="vpt-btn" disabled={!bmName.trim()} onClick={() => { requestBookmark(bmName.trim()); setBmName(''); }}>★ Save</button>
          </div>
          {vp.bookmarks.length === 0
            ? <p className="vpt-note">Save the current camera to return to it later.</p>
            : vp.bookmarks.map((b) => (
              <div key={b.name} className="vpt-row vpt-bm">
                <button className="vpt-btn" onClick={() => recallBookmark(b.name)}>★ {b.name}</button>
                <button className="vpt-btn ghost" onClick={() => removeBookmark(b.name)} title="Delete">✕</button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
