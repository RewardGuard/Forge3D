import React, { useState, useMemo } from 'react';
import LifeSimView from '../components/LifeSimView.jsx';
import InputControls from '../components/InputControls.jsx';
import { useStore } from '../lib/store.js';
import { HAZARD_LIST, HAZARDS, resolveMaterial, statusLabel } from '../lib/lifesim.js';
import { MATERIALS } from '../lib/materials.js';

let hazSeq = 1;

export default function LifeSimWorkspace() {
  const meshes = useStore((s) => s.meshes);
  const theme = useStore((s) => s.theme);
  const setMeshMaterial = useStore((s) => s.setMeshMaterial);
  const setTab = useStore((s) => s.setTab);
  // run state + report live in the store so the Orchestra director can drive the
  // sim ("▶ Run") and read the physics outcome without touching this component.
  const running = useStore((s) => s.lifeSimRunning);
  const setRunning = useStore((s) => s.setLifeSimRunning);
  const setSimReport = useStore((s) => s.setSimReport);

  const [hazards, setHazards] = useState([]);
  const [report, setReportLocal] = useState({});
  const setReport = (r) => { setReportLocal(r); setSimReport(r); };
  const [newType, setNewType] = useState('flamethrower');
  const [resetSignal, setResetSignal] = useState(0);

  const materialKeys = Object.keys(MATERIALS);

  function addHazard() {
    setHazards((hs) => [
      ...hs,
      { id: 'h' + hazSeq++, type: newType, position: [hs.length * 0.4 - 0.4, 0.3, 1.2], on: true, intensity: 1 },
    ]);
  }
  function patchHazard(id, patch) {
    setHazards((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }
  function removeHazard(id) {
    setHazards((hs) => hs.filter((h) => h.id !== id));
  }
  function reset() {
    setRunning(false);
    setReport({});
    setResetSignal((n) => n + 1);
  }

  const summary = useMemo(() => {
    const vals = Object.values(report.objects || {});
    const destroyed = vals.filter((s) => s.destroyed).length;
    const burning = vals.filter((s) => s.ignited).length;
    const maxTemp = vals.reduce((a, s) => Math.max(a, s.temp), 0);
    return { destroyed, burning, maxTemp, total: meshes.length, elapsed: report._t || 0 };
  }, [report, meshes.length]);

  if (meshes.length === 0) {
    return (
      <div className="layout two-col">
        <aside className="sidebar left">
          <div className="panel">
            <h3>Life Simulator</h3>
            <p className="muted small">
              The Life Sim runs your build with real-world-style physics: heat, fire and material
              durability. Add objects in <b>3D Design</b> or send your circuit parts to the scene first.
            </p>
            <button className="btn full" onClick={() => setTab('design')}>Go to 3D Design</button>
          </div>
        </aside>
        <section className="viewport"><LifeSimView running={false} hazards={[]} theme={theme} onReport={() => {}} /></section>
      </div>
    );
  }

  return (
    <div className="layout three-col-sim">
      <aside className="sidebar left">
        <div className="panel scroll">
          <h3>Hazards</h3>
          <div className="row">
            <select value={newType} onChange={(e) => setNewType(e.target.value)}>
              {HAZARD_LIST.map((h) => (
                <option key={h.id} value={h.id}>{h.icon} {h.name} ({h.tempC}°C)</option>
              ))}
            </select>
            <button className="btn" onClick={addHazard}>+ Add</button>
          </div>

          {hazards.length === 0 && <p className="muted small">Add a hazard, then press Run to test durability.</p>}

          {hazards.map((h) => {
            const spec = HAZARDS[h.type];
            return (
              <div className="haz-card" key={h.id}>
                <div className="row" style={{ alignItems: 'center' }}>
                  <span className="haz-name">{spec.icon} {spec.name}</span>
                  <div className="spacer" />
                  <button className={'mini' + (h.on ? ' on' : '')} onClick={() => patchHazard(h.id, { on: !h.on })}>
                    {h.on ? 'On' : 'Off'}
                  </button>
                  <button className="mini" onClick={() => removeHazard(h.id)}>✕</button>
                </div>
                <div className="haz-axes">
                  {['X', 'Y', 'Z'].map((ax, i) => (
                    <label key={ax} className="haz-ax">
                      {ax}
                      <input
                        type="number" step="0.2" value={h.position[i]}
                        onChange={(e) => {
                          const p = [...h.position]; p[i] = parseFloat(e.target.value) || 0;
                          patchHazard(h.id, { position: p });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label className="haz-intensity">
                  <span>Intensity {Math.round((h.intensity ?? 1) * 100)}%</span>
                  <input
                    type="range" min="0.2" max="1" step="0.05"
                    value={h.intensity ?? 1}
                    onChange={(e) => patchHazard(h.id, { intensity: parseFloat(e.target.value) })}
                  />
                </label>
                <span className="muted small">{spec.tempC}°C · reach {spec.reach.toFixed(1)}u</span>
              </div>
            );
          })}

          <div className="divider" />
          <h3>Materials</h3>
          <p className="muted small">Assign what each object is made of to test how it survives.</p>
          {meshes.map((m) => {
            const mat = resolveMaterial(m);
            return (
              <div className="row" key={m.id} style={{ alignItems: 'center', marginBottom: 4 }}>
                <span className="mat-name" title={m.label}>{m.label || m.kind}</span>
                <select
                  value={mat.key}
                  onChange={(e) => setMeshMaterial(m.id, e.target.value)}
                >
                  {materialKeys.map((k) => (
                    <option key={k} value={k}>{MATERIALS[k].name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="viewport">
        <LifeSimView running={running} hazards={hazards} theme={theme} onReport={setReport} resetSignal={resetSignal} />
        <div className="viewport-overlay row">
          <button className={'btn ' + (running ? 'danger' : 'primary')} onClick={() => setRunning(!running)}>
            {running ? '❚❚ Pause' : '▶ Run'}
          </button>
          <button className="btn" onClick={reset}>↺ Reset</button>
        </div>
      </section>

      <aside className="sidebar right">
        <div className="panel scroll">
          <h3>Durability</h3>
          <div className="sim-stats">
            <div className="stat"><span>Hottest</span><b>{summary.maxTemp.toFixed(0)}°C</b></div>
            <div className="stat"><span>On fire</span><b>{summary.burning}</b></div>
            <div className="stat"><span>Destroyed</span><b>{summary.destroyed}/{summary.total}</b></div>
            <div className="stat"><span>Elapsed</span><b>{summary.elapsed.toFixed(1)}s</b></div>
            <div className="stat"><span>Status</span><b>{running ? 'running' : 'paused'}</b></div>
          </div>

          <InputControls />

          <div className="comp-list">
            {meshes.map((m) => {
              const s = report.objects?.[m.id];
              const mat = resolveMaterial(m);
              const integ = s ? s.integrity : 1;
              const label = statusLabel(s);
              const melt = s ? Math.round((s.melt || 0) * 100) : 0;
              return (
                <div className="comp-row" key={m.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <div className="row" style={{ alignItems: 'center' }}>
                    <span className="comp-name">{m.label || m.kind}</span>
                    <span className={'comp-note tag-' + label.replace(/\s/g, '-')}>{label}</span>
                  </div>
                  <div className="bar"><i style={{ width: (integ * 100) + '%' }} className={integ < 0.5 ? 'low' : ''} /></div>
                  <span className="muted small">
                    {mat.name} · {(s ? s.temp : 25).toFixed(0)}°C · limit {mat.maxTempC}°C
                    {melt > 0 ? ` · melt ${melt}%` : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted small">First-pass physics: heat, ignition and material failure. Tune hazard distance with the X/Y/Z fields.</p>
        </div>
      </aside>
    </div>
  );
}
