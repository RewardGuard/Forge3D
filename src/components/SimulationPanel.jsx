import React from 'react';
import { useStore } from '../lib/store.js';
import { useSimulation } from '../lib/simulate.js';
import InputControls from './InputControls.jsx';

export default function SimulationPanel() {
  const simOn = useStore((s) => s.simOn);
  const toggleSim = useStore((s) => s.toggleSim);
  const sim = useSimulation();

  return (
    <div className="panel scroll">
      <h3>Simulation</h3>
      <button data-tut="run-sim" className={'btn full ' + (simOn ? 'danger' : 'primary')} onClick={toggleSim}>
        {simOn ? '■ Stop simulation' : '▶ Run simulation'}
      </button>

      {!simOn && <p className="muted small">Powers up the circuit AND runs the code on each board — GPIO pins your sketch drives will light/blink the parts wired to them (through resistors too).</p>}

      <InputControls />

      {simOn && sim && (
        <>
          <div className="sim-stats">
            <div className="stat"><span>Supply</span><b>{sim.totals.voltage} V</b></div>
            <div className="stat"><span>Current</span><b>{(sim.totals.current * 1000).toFixed(0)} mA</b></div>
            <div className="stat"><span>Power</span><b>{sim.totals.powerW} W</b></div>
            <div className="stat"><span>Active</span><b>{sim.totals.activeCount}/{sim.components.length}</b></div>
          </div>

          <div className="legend">
            <span><i style={{ background: '#f59e0b' }} />power</span>
            <span><i style={{ background: '#94a3b8' }} />ground</span>
            <span><i style={{ background: '#0a98a6' }} />signal</span>
            <span><i style={{ background: '#ef4444' }} />short</span>
          </div>

          <label className="lbl">Components</label>
          <div className="comp-list">
            {sim.components.map((c) => (
              <div key={c.nodeId} className="comp-row">
                <span className={'dot ' + (c.active ? 'on' : 'off')} />
                <span className="comp-name">{c.name}</span>
                <span className="comp-note">{c.note}</span>
              </div>
            ))}
            {sim.components.length === 0 && <p className="muted small">No parts placed.</p>}
          </div>

          <label className="lbl">Warnings</label>
          {sim.warnings.length === 0 ? (
            <p className="ok-text small">✓ No issues detected.</p>
          ) : (
            <ul className="warnings">
              {sim.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}

          <p className="muted small">{sim.nets.length} electrical nets · {sim.totals.sourceCount} power rail(s)</p>
        </>
      )}
    </div>
  );
}
