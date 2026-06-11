import React, { useState, useRef, useEffect } from 'react';
import PartsLibrary from '../components/PartsLibrary.jsx';
import CircuitCanvas from '../components/CircuitCanvas.jsx';
import SimulationPanel from '../components/SimulationPanel.jsx';
import CodePanel from '../components/CodePanel.jsx';
import { useStore } from '../lib/store.js';

export default function CircuitWorkspace() {
  const [dock, setDock] = useState('sim'); // sim | code
  const [rightW, setRightW] = useState(380); // resizable right dock width
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      const w = window.innerWidth - e.clientX;
      setRightW(Math.min(760, Math.max(300, w)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove('col-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const removeNode = useStore((s) => s.removeNode);
  const clearCircuit = useStore((s) => s.clearCircuit);
  const wires = useStore((s) => s.wires);
  const nodes = useStore((s) => s.nodes);
  const pendingPin = useStore((s) => s.pendingPin);
  const setTab = useStore((s) => s.setTab);
  const projectCircuitTo3D = useStore((s) => s.projectCircuitTo3D);

  return (
    <div className="layout three-col-sim" style={{ gridTemplateColumns: `260px 1fr ${rightW}px` }}>
      <aside className="sidebar left">
        <PartsLibrary />
      </aside>
      <section className="canvas-wrap">
        <div className="toolbar">
          <span className="muted small">
            {nodes.length} parts · {wires.length} wires
            {pendingPin && <span className="hint-pill"> — pick a second pin to connect ({pendingPin.pin})</span>}
          </span>
          <div className="spacer" />
          <button className="btn" disabled={!selectedNodeId} onClick={() => removeNode(selectedNodeId)}>Delete part</button>
          <button className="btn" onClick={() => { projectCircuitTo3D(); }}>⤢ Send to 3D</button>
          <button className="btn" onClick={() => setTab('export')}>Export ▸</button>
          <button className="btn danger" onClick={clearCircuit}>Clear</button>
        </div>
        <CircuitCanvas />
      </section>
      <aside className="sidebar right column">
        <div
          className="col-resizer"
          title="Drag to resize"
          onPointerDown={(e) => {
            dragging.current = true;
            document.body.classList.add('col-resizing');
            e.preventDefault();
          }}
          onDoubleClick={() => setRightW(380)}
        />
        <div className="dock-tabs">
          <button className={'dock-tab' + (dock === 'sim' ? ' on' : '')} onClick={() => setDock('sim')}>Simulation</button>
          <button className={'dock-tab' + (dock === 'code' ? ' on' : '')} onClick={() => setDock('code')}>Code</button>
        </div>
        {dock === 'sim' ? <SimulationPanel /> : <CodePanel />}
      </aside>
    </div>
  );
}
