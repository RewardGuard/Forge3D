// ============================================================================
// Cloud Orchestra — runs Forge3D's engineering engine HEADLESS, server-side.
//
// This is the "works for anyone, no install" half of the remote connector. It
// reuses the exact same engine the desktop app and acceptance tests use
// (orchestraCore.js + orchestraTools.js), which run in plain Node against the
// zustand store — no DOM, no Electron. A Claude user with no Forge3D installed
// can still say "design a sumo robot" and get a validated spec + netlist +
// firmware + BOM + feasibility report back.
//
// `orchestrate` is the headline: it is ATOMIC — reset → autonomousDesign →
// capture the whole design in one mutex-held call — so the cloud never needs
// per-call scene state (which matters because the store is a singleton).
//
// Tools that need the live app (mesh gen, vision, the running Life Sim) or an
// LLM round-trip are LIVE_ONLY: in cloud mode they return a clear "pair your
// desktop" message instead of failing. When a desktop IS paired, the router
// relays everything to it and this module isn't used.
// ============================================================================
import { useStore } from '../../src/lib/store.js';
import { resetScene, autonomousDesign, iterateToValid, conforms } from '../../src/lib/orchestraCore.js';
import { runTool, TOOLS } from '../../src/lib/orchestraTools.js';
import { seedSpec } from '../../src/lib/orchestraSpec.js';

// Tools that touch window.forge / DOM / the running physics loop — meaningless
// without the live desktop app. Everything else in TOOLS is pure store work.
export const LIVE_ONLY = new Set([
  'gen_mesh', 'build_circuit', 'gen_code', 'look', 'screenshot',
  'run_sim', 'pause_sim', 'set_joystick', 'set_input', 'get_sim_report',
]);

const NEEDS_DESKTOP = (name) =>
  `"${name}" needs the live Forge3D desktop app. Pair it (Forge3D → Settings → Forge3D Cloud), ` +
  'or use `orchestrate` to design in the cloud and get the spec, netlist, firmware and BOM back.';

// --- serialize engine runs: the store is a global singleton, so concurrent
//     requests must not interleave. Each call awaits the previous one. ---
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// Compact, transport-friendly snapshot of the current headless design.
function captureDesign() {
  const s = useStore.getState();
  return {
    meshes: s.meshes.map((m) => ({
      id: m.id, role: m.role, label: m.label || m.kind, kind: m.kind, partId: m.partId,
      position: round(m.position), rotation: round(m.rotation), scale: m.scale,
      size: m.size, materialKey: m.materialKey,
      ...(m.attachedTo ? { attachedTo: m.attachedTo, drives: m.drives !== false } : {}),
    })),
    circuit: {
      nodes: s.nodes.map((n) => ({ id: n.id, partId: n.partId })),
      wires: s.wires.map((w) => ({ from: w.from, to: w.to })),
    },
    firmware: s.codeByNode || {},
  };
}
const round = (a) => (Array.isArray(a) ? a.map((n) => +(+n).toFixed(2)) : a);

// The headline cloud action: a whole goal → a complete, validated design.
function orchestrateCloud(goal) {
  if (!goal || !String(goal).trim()) return { ok: false, error: 'orchestrate needs a goal' };
  const g = String(goal);
  resetScene();
  let r = autonomousDesign(g);
  // Some patterns (e.g. "lamp") have no headless template, so autonomousDesign
  // can come back empty. Fall back to the universal generic builder so the cloud
  // always returns a real, mounted, validated design instead of nothing.
  if (!r.ok && useStore.getState().meshes.length === 0) {
    const gspec = seedSpec('generic', g);
    if (gspec) { resetScene(); const rr = iterateToValid(gspec); r = { ok: rr.ok && conforms(g).ok, source: 'generic', report: rr.report }; }
  }
  const c = conforms(g);
  return {
    ok: r.ok,
    result: {
      goal, status: r.ok ? 'done' : 'incomplete', source: r.source, // model | template | none
      conforms: c.ok, missing: c.missing || [],
      report: r.report || null, // structural / dimensional / integration / electrical / bom
      design: captureDesign(),
      note: r.ok
        ? 'Validated cloud design. Pair your desktop to open it live (3D + Life Sim).'
        : 'Best-effort cloud design — some requirements unmet (see missing/report).',
    },
  };
}

// Execute one tool in cloud (no-desktop) mode.
export function runCloudTool(name, args = {}) {
  return withLock(async () => {
    try {
      if (name === 'orchestrate') return orchestrateCloud(args.goal);
      if (LIVE_ONLY.has(name)) return { ok: false, error: NEEDS_DESKTOP(name) };
      if (TOOLS[name]) return await runTool(name, args); // get_state, get_netlist, validate_*, etc.
      return { ok: false, error: `unknown tool "${name}"` };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
