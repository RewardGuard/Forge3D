import React, { useRef, useState, useEffect } from 'react';
import { useStore } from '../lib/store.js';
import { PART_BY_ID } from '../data/parts.js';
import { pinPosition } from '../lib/circuitSvg.js';
import { useSimulation, netRole } from '../lib/simulate.js';
import { numberedNodeNames } from '../lib/labels.js';

const NODE_W = 150;
const ROLE_COLOR = {
  power: '#f59e0b',
  ground: '#94a3b8',
  signal: '#0a98a6',
  short: '#ef4444',
};

// Classify what an *active* component is doing, for the on-canvas indicator.
const SPIN_PARTS = new Set(['dc-motor', 'pump-12v', 'linear-actuator', 'servo-sg90', 'servo-mg996', 'stepper-28byj', 'stepper-nema17', 'vibration-motor']);
const LIT_PARTS = new Set(['led-5mm', 'rgb-led', 'seven-seg', 'oled-ssd1306', 'lcd1602', 'max7219', 'neopixel-ring']);
const SOUND_PARTS = new Set(['buzzer', 'speaker-8ohm']);
function activeKind(partId) {
  if (SPIN_PARTS.has(partId)) return 'spin';
  if (LIT_PARTS.has(partId)) return 'lit';
  if (SOUND_PARTS.has(partId)) return 'sound';
  return 'on';
}
const STATE_LABEL = { spin: 'spinning', lit: 'lit', sound: 'sound', on: 'on' };
const STATE_COLOR = { spin: '#38bdf8', lit: '#facc15', sound: '#a78bfa', on: '#22c55e' };

// The animated glyph drawn inside the floating "active" badge above a node.
function ActiveGlyph({ kind }) {
  const c = STATE_COLOR[kind];
  if (kind === 'spin') {
    return (
      <g stroke={c} strokeWidth="2.4" strokeLinecap="round">
        <line x1="0" y1="-6" x2="0" y2="6" />
        <line x1="-5.2" y1="-3" x2="5.2" y2="3" />
        <line x1="-5.2" y1="3" x2="5.2" y2="-3" />
        <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="0.7s" repeatCount="indefinite" />
      </g>
    );
  }
  if (kind === 'lit') {
    return (
      <circle r="5" fill={c}>
        <animate attributeName="opacity" values="0.45;1;0.45" dur="0.9s" repeatCount="indefinite" />
      </circle>
    );
  }
  if (kind === 'sound') {
    return (
      <g fill="none" stroke={c} strokeWidth="2">
        <circle r="3" />
        <path d="M 4 -5 A 7 7 0 0 1 4 5">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="0.8s" repeatCount="indefinite" />
        </path>
      </g>
    );
  }
  return (
    <circle r="5" fill={c}>
      <animate attributeName="opacity" values="1;0.3;1" dur="1.1s" repeatCount="indefinite" />
    </circle>
  );
}

function nodeHeight(part) {
  const leftCount = Math.ceil(part.pins.length / 2);
  return 34 + leftCount * 22 + 12;
}

export default function CircuitCanvas() {
  const nodes = useStore((s) => s.nodes);
  const names = React.useMemo(() => numberedNodeNames(nodes), [nodes]);
  const wires = useStore((s) => s.wires);
  const pendingPin = useStore((s) => s.pendingPin);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const moveNode = useStore((s) => s.moveNode);
  const selectNode = useStore((s) => s.selectNode);
  const clickPin = useStore((s) => s.clickPin);
  const cancelPin = useStore((s) => s.cancelPin);
  const removeWire = useStore((s) => s.removeWire);

  const sim = useSimulation();
  const svgRef = useRef();
  const [drag, setDrag] = useState(null); // { id, dx, dy }
  // pan & zoom: drag empty space to move around, scroll/buttons to zoom
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const pan = useRef(null); // { startX, startY, baseX, baseY, moved }

  // role color for a given pin from the live simulation (null when sim off)
  const roleColor = (nodeId, pin) => {
    if (!sim) return null;
    const net = sim.netMap[sim.pinNet[`${nodeId}:${pin}`]];
    return ROLE_COLOR[netRole(net)];
  };
  const compFor = (nodeId) => sim?.components.find((c) => c.nodeId === nodeId);

  function onMouseDownNode(e, node) {
    e.stopPropagation();
    selectNode(node.id);
    const pt = toSvg(e);
    setDrag({ id: node.id, dx: pt.x - node.x, dy: pt.y - node.y });
  }
  // screen px -> world coordinates (accounts for pan/zoom)
  function toSvg(e) {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.x) / view.k,
      y: (e.clientY - rect.top - view.y) / view.k,
    };
  }
  function onBackgroundDown(e) {
    pan.current = { startX: e.clientX, startY: e.clientY, baseX: view.x, baseY: view.y, moved: false };
    // cursor feedback must be set imperatively: pan is a ref, it never re-renders
    if (svgRef.current) svgRef.current.style.cursor = 'grabbing';
  }
  function onMouseMove(e) {
    if (drag) {
      const pt = toSvg(e);
      moveNode(drag.id, pt.x - drag.dx, pt.y - drag.dy);
      return;
    }
    if (pan.current && e.buttons) {
      const dx = e.clientX - pan.current.startX;
      const dy = e.clientY - pan.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.current.moved = true;
      // capture NOW — pan.current may be nulled by mouseup before the state
      // updater runs (this exact race crashed the app: null.baseX)
      const nx = pan.current.baseX + dx;
      const ny = pan.current.baseY + dy;
      setView((v) => ({ ...v, x: nx, y: ny }));
    }
  }
  function onMouseUp() {
    setDrag(null);
    // a real click (no movement) on empty space clears selection / pending pin
    if (pan.current && !pan.current.moved) { selectNode(null); cancelPin(); }
    pan.current = null;
    if (svgRef.current) svgRef.current.style.cursor = 'default';
  }
  // Wheel: two-finger scroll pans, pinch / ⌘+scroll zooms. Registered natively
  // (passive:false) so we can preventDefault — otherwise macOS turns the gesture
  // into history-swipe/page-zoom, which blanks the whole window.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          // pinch gestures arrive as ctrlKey wheel events
          const f = Math.exp(-e.deltaY * 0.01);
          const k = Math.min(2.5, Math.max(0.35, v.k * f));
          if (!Number.isFinite(k)) return v;
          const wx = (mx - v.x) / v.k;
          const wy = (my - v.y) / v.k;
          return { k, x: mx - wx * k, y: my - wy * k };
        }
        // plain scroll = pan
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // zoom buttons scale around the visible center, not the canvas origin
  const zoomBy = (f) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.35, v.k * f));
      if (!Number.isFinite(k) || k === v.k) return v;
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      return { k, x: cx - wx * k, y: cy - wy * k };
    });
  };

  // pin pixel positions for wires
  const pinPt = (nodeId, pin) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const part = PART_BY_ID[node.partId];
    const idx = part.pins.indexOf(pin);
    return pinPosition(node, idx, part.pins.length);
  };

  return (
    <>
    <svg
      ref={svgRef}
      className="circuit-svg"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onMouseDown={onBackgroundDown}
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a2230" strokeWidth="1" />
        </pattern>
        <filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#22c55e" floodOpacity="0.85" />
        </filter>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />

      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
      {/* wires */}
      {wires.map((w) => {
        const a = pinPt(w.from.node, w.from.pin);
        const b = pinPt(w.to.node, w.to.pin);
        const midX = (a.x + b.x) / 2;
        const d = `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
        const col = roleColor(w.from.node, w.from.pin);
        return (
          <path
            key={w.id}
            d={d}
            className="wire"
            style={col ? { stroke: col } : undefined}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeWire(w.id); }}
          />
        );
      })}

      {/* nodes */}
      {nodes.map((node) => {
        const part = PART_BY_ID[node.partId];
        const h = nodeHeight(part);
        const leftCount = Math.ceil(part.pins.length / 2);
        const selected = selectedNodeId === node.id;
        const comp = compFor(node.id);
        const active = comp?.active;
        const kind = active ? activeKind(node.partId) : null;
        return (
          <g key={node.id} transform={`translate(${node.x},${node.y})`}>
            <rect
              className={'node-box' + (selected ? ' selected' : '') + (active ? ' active' : '')}
              width={NODE_W}
              height={h}
              rx="8"
              filter={active ? 'url(#nodeGlow)' : undefined}
              onMouseDown={(e) => onMouseDownNode(e, node)}
              style={{ cursor: 'grab' }}
            />
            <rect width={NODE_W} height="24" rx="8" fill={part.color} onMouseDown={(e) => onMouseDownNode(e, node)} />
            <text x="8" y="16" className="node-title">{names[node.id] || part.name}</text>
            <text x={NODE_W - 8} y="16" className="node-price" textAnchor="end">${part.price.toFixed(2)}</text>

            {/* clear floating "active" badge above the node: spinning / lit / sound / on */}
            {active && (
              <g transform="translate(0,-13)">
                <rect x={NODE_W - 92} y={-14} width={92} height={20} rx={10}
                  fill="var(--panel-2)" stroke={STATE_COLOR[kind]} strokeWidth="1.5" />
                <g transform={`translate(${NODE_W - 78},-4)`}>
                  <ActiveGlyph kind={kind} />
                </g>
                <text x={NODE_W - 62} y={0} className="state-text" fill={STATE_COLOR[kind]}>
                  {kind === 'spin' && comp?.dir ? (comp.dir > 0 ? 'spin +' : 'spin −') : STATE_LABEL[kind]}
                </text>
              </g>
            )}

            {part.pins.map((pin, i) => {
              const isLeft = i < leftCount;
              const idxInCol = isLeft ? i : i - leftCount;
              const px = isLeft ? 0 : NODE_W;
              const py = 34 + idxInCol * 22;
              const active = pendingPin && pendingPin.node === node.id && pendingPin.pin === pin;
              const col = roleColor(node.id, pin);
              return (
                <g key={pin} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); clickPin(node.id, pin); }} style={{ cursor: 'crosshair' }}>
                  <circle cx={px} cy={py} r="5" className={'pin' + (active ? ' active' : '')} style={col && !active ? { stroke: col } : undefined} />
                  <text x={isLeft ? px + 9 : px - 9} y={py + 3} textAnchor={isLeft ? 'start' : 'end'} className="pin-label">{pin}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      </g>

      {nodes.length === 0 && (
        <text x="50%" y="50%" textAnchor="middle" className="empty-hint">
          Click parts on the left to add them, then click two pins to wire them. Drag empty space to pan, scroll to zoom.
        </text>
      )}
    </svg>

    {/* zoom controls overlay */}
    <div className="zoom-ctl">
      <button className="zoom-btn" title="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
      <button className="zoom-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
      <button className="zoom-btn" title="Reset view" onClick={() => setView({ x: 0, y: 0, k: 1 })}>⌂</button>
      <span className="zoom-pct">{Math.round(view.k * 100)}%</span>
    </div>
    </>
  );
}
