import React, { useRef } from 'react';
import { useStore } from '../lib/store.js';
import { PART_BY_ID } from '../data/parts.js';
import { numberedNodeNames } from '../lib/labels.js';

const INPUT_KINDS = new Set(['push-button', 'toggle-switch', 'potentiometer', 'joystick']);

// A real draggable 2-axis joystick: drag the knob, it springs back to center on
// release (like a physical thumb-stick). Emits { x, y } in 0..1 (center 0.5).
function JoyPad({ value, onChange }) {
  const ref = useRef();
  const x = value?.x ?? 0.5;
  const y = value?.y ?? 0.5;
  const update = (e) => {
    const r = ref.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onChange({ x: nx, y: 1 - ny }); // invert Y so up = 1
  };
  const down = (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); update(e); };
  const move = (e) => { if (e.buttons) update(e); };
  const up = (e) => { try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ } onChange({ x: 0.5, y: 0.5 }); };
  return (
    <div className="joypad" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="joypad-cross" />
      <div className="joypad-knob" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
    </div>
  );
}

// Live controls for the interactive parts in the circuit. Pressing a button /
// flipping a switch / dragging a pot actually changes the simulation (closes
// nets, drives analog voltages) so you can test your circuit by hand.
export default function InputControls() {
  const nodes = useStore((s) => s.nodes);
  const inputs = useStore((s) => s.inputs);
  const setInput = useStore((s) => s.setInput);
  const toggleInput = useStore((s) => s.toggleInput);
  const simOn = useStore((s) => s.simOn);

  const inputNodes = nodes.filter((n) => INPUT_KINDS.has(n.partId));
  const names = numberedNodeNames(nodes);
  if (inputNodes.length === 0) return null;

  return (
    <>
      <div className="divider" />
      <label className="lbl">Inputs — click / drag to control</label>
      {!simOn && <p className="muted small">Run the simulation to see their effect.</p>}
      <div className="input-list">
        {inputNodes.map((n) => {
          const part = PART_BY_ID[n.partId];
          const v = inputs[n.id];
          return (
            <div key={n.id} className="input-row">
              <span className="input-name">{names[n.id] || part.name}</span>

              {n.partId === 'push-button' && (
                <button
                  className={'btn input-btn' + (v ? ' active' : '')}
                  onPointerDown={() => setInput(n.id, true)}
                  onPointerUp={() => setInput(n.id, false)}
                  onPointerLeave={() => setInput(n.id, false)}
                >{v ? 'PRESSED' : 'Hold'}</button>
              )}

              {n.partId === 'toggle-switch' && (
                <label className="switch">
                  <input type="checkbox" checked={!!v} onChange={() => toggleInput(n.id)} />
                  <span className="switch-track"><span className="switch-thumb" /></span>
                </label>
              )}

              {n.partId === 'potentiometer' && (
                <div className="input-slider">
                  <input type="range" min="0" max="1" step="0.01"
                    value={v ?? 0.5}
                    onChange={(e) => setInput(n.id, parseFloat(e.target.value))} />
                  <span className="input-val">{Math.round((v ?? 0.5) * 100)}%</span>
                </div>
              )}

              {n.partId === 'joystick' && (
                <div className="joy">
                  <JoyPad value={v} onChange={(xy) => setInput(n.id, { ...(v || {}), ...xy })} />
                  <div className="joy-side">
                    <span className="muted small">X {Math.round((v?.x ?? 0.5) * 100)}% · Y {Math.round((v?.y ?? 0.5) * 100)}%</span>
                    <button
                      className={'btn input-btn' + (v?.sw ? ' active' : '')}
                      onPointerDown={() => setInput(n.id, { ...(v || {}), sw: true })}
                      onPointerUp={() => setInput(n.id, { ...(v || {}), sw: false })}
                      onPointerLeave={() => setInput(n.id, { ...(v || {}), sw: false })}
                    >{v?.sw ? 'SW ↓' : 'press SW'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
