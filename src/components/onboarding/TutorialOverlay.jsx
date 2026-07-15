import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store.js';

// A live, 7-step coach-mark that drives the REAL editor. Each step highlights an
// actual control and auto-advances when its goal is detected in the store (with a
// Next fallback so nobody gets stuck). Dismissable at any point.
//
// `arm(state)` captures a baseline when a step opens; `done(state, baseline)`
// reports completion. `tab` (optional) switches the editor to the right workspace
// as the step opens so the highlighted control is actually mounted.
const STEPS = [
  {
    key: 'add', tab: 'design', selector: '[data-tut="add-shape"]',
    title: 'Add a shape',
    body: 'Every build starts with geometry. Click one of the Quick Primitives to drop your first object into the scene.',
    arm: (s) => ({ n: s.meshes.length }),
    done: (s, b) => s.meshes.length > b.n,
  },
  {
    key: 'inspect', tab: 'design', selector: '.sidebar.right',
    title: 'Fine-tune it',
    body: 'Click your shape in the 3D view to select it — its exact size, position and colour show up here in the Inspector, ready to dial in.',
    done: (s) => Boolean(s.selectedMeshId),
  },
  {
    key: 'circuit-tab', selector: '[data-tut="tab-circuit"]',
    title: 'Open the Circuit tab',
    body: 'Forge3D designs the electronics right next to the geometry. Click the Circuit tab to wire things up.',
    done: (s) => s.tab === 'circuit',
  },
  {
    key: 'part', tab: 'circuit', selector: '[data-tut="parts"]',
    title: 'Drop a component',
    body: 'Click a part from the library (try an LED or an Arduino) to place it on the board.',
    arm: (s) => ({ n: s.nodes.length }),
    done: (s, b) => s.nodes.length > b.n,
  },
  {
    key: 'wire', tab: 'circuit', selector: '.circuit-svg',
    title: 'Connect this pin',
    body: 'Click one pin on a part, then click another pin to run a wire between them. Add at least one connection.',
    arm: (s) => ({ n: s.wires.length }),
    done: (s, b) => s.wires.length > b.n,
  },
  {
    key: 'run', tab: 'circuit', selector: '[data-tut="run-sim"]',
    title: 'Run it',
    body: 'Press Run simulation — Forge3D powers the circuit and runs the code, lighting up whatever your sketch drives.',
    done: (s) => s.simOn || s.lifeSimRunning,
  },
  {
    key: 'export', tab: 'export', selector: '[data-tut="export-panel"]',
    title: 'Ship it',
    body: 'This is where you export STL, a sticker-circuit SVG and the bill of materials to actually fabricate. That is the whole loop — you are ready!',
    done: () => false,
    last: true,
  },
];

// Track a target element's viewport rect. Values are rounded and only committed
// when they actually move (>1px) — critical because some targets sit next to a
// live 3D canvas whose sub-pixel reflows otherwise made the spotlight+card
// grow/shrink every frame.
function useTargetRect(selector, dep) {
  const [rect, setRect] = useState(null);
  const prev = useRef(null);
  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const el = selector ? document.querySelector(selector) : null;
      if (!el) { if (prev.current !== null) { prev.current = null; setRect(null); } return; }
      const r = el.getBoundingClientRect();
      const next = { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) };
      const p = prev.current;
      if (!p || Math.abs(p.top - next.top) > 1 || Math.abs(p.left - next.left) > 1 || Math.abs(p.width - next.width) > 1 || Math.abs(p.height - next.height) > 1) {
        prev.current = next;
        setRect(next);
      }
    };
    measure();
    const id = setInterval(measure, 400);
    window.addEventListener('resize', measure);
    return () => { alive = false; clearInterval(id); window.removeEventListener('resize', measure); };
  }, [selector, dep]);
  return rect;
}

export default function TutorialOverlay() {
  const setTab = useStore((s) => s.setTab);
  const setShellView = useStore((s) => s.setShellView);
  const setOnboarding = useStore((s) => s.setOnboarding);

  const [i, setI] = useState(0);
  const baseline = useRef({});
  const step = STEPS[i];

  // snapshot the scene + whether onboarding was already done, so the tutorial's
  // scratch edits never clobber a real project (e.g. when replayed from Home)
  const snapshot = useRef(null);
  const wasOnboarded = useRef(false);
  useEffect(() => {
    const s = useStore.getState();
    wasOnboarded.current = s.onboarded;
    snapshot.current = {
      meshes: s.meshes, nodes: s.nodes, wires: s.wires, codeByNode: s.codeByNode,
      tab: s.tab, simOn: s.simOn,
    };
  }, []);

  const rect = useTargetRect(step.selector, i);

  // opening a step: switch to its workspace, capture the completion baseline,
  // then auto-advance ONLY on a later store change that satisfies the goal.
  // (No synchronous check at mount — that used to spuriously skip steps whose
  // condition was already true. The `n === i` guard blocks stale advances.)
  useEffect(() => {
    if (step.tab && useStore.getState().tab !== step.tab) setTab(step.tab);
    baseline.current = step.arm ? step.arm(useStore.getState()) : {};
    if (step.last) return undefined;
    let advanced = false;
    let timer = 0;
    const unsub = useStore.subscribe(() => {
      if (advanced) return;
      if (step.done(useStore.getState(), baseline.current)) {
        advanced = true;
        timer = setTimeout(() => setI((n) => (n === i ? Math.min(n + 1, STEPS.length - 1) : n)), 500);
      }
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [i, step, setTab]);

  function finish(skipped) {
    // restore the pre-tutorial scene so scratch edits vanish
    if (snapshot.current) useStore.setState(snapshot.current);
    setOnboarding({ tutorialSeen: true, onboarded: true });
    window.forge.onboarding?.set({ tutorialSeen: true });
    // returning users who replayed go back Home; first-run continues to the splash
    setShellView(wasOnboarded.current ? 'home' : 'welcome');
  }

  // tooltip placement: below the target if there's room, else above; clamped
  const place = useMemo(() => {
    const CARD_W = 340, CARD_H = 210, M = 14;
    if (!rect) return { left: window.innerWidth / 2 - CARD_W / 2, top: window.innerHeight / 2 - CARD_H / 2, centered: true };
    let left = rect.left + rect.width / 2 - CARD_W / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - CARD_W - M));
    const below = rect.top + rect.height + M;
    const top = below + CARD_H < window.innerHeight ? below : Math.max(M, rect.top - CARD_H - M);
    return { left, top, centered: false };
  }, [rect]);

  return (
    <div className="tut-root">
      {/* spotlight: a transparent hole over the target, dimming everything else */}
      {rect ? (
        <div
          className="tut-spot"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="tut-dim" />
      )}

      <div className="tut-card" style={{ left: place.left, top: place.top }}>
        <div className="tut-step">Step {i + 1} of {STEPS.length}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tut-dots">
          {STEPS.map((_, n) => <span key={n} className={'tut-dot' + (n === i ? ' on' : n < i ? ' done' : '')} />)}
        </div>
        <div className="tut-actions">
          <button className="tut-skip" onClick={() => finish(true)}>Skip tutorial</button>
          <div className="spacer" />
          {i > 0 && <button className="btn" onClick={() => setI((n) => n - 1)}>Back</button>}
          {step.last
            ? <button className="btn primary" onClick={() => finish(false)}>Finish ✓</button>
            : <button className="btn primary" onClick={() => setI((n) => Math.min(n + 1, STEPS.length - 1))}>Next →</button>}
        </div>
      </div>
    </div>
  );
}
