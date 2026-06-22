// ============================================================================
// Renderer side of the Forge3D control bridge (Phase 2).
//
// The Electron main process runs a tiny localhost HTTP server; for each request
// it asks the renderer to execute a tool by evaluating
// `window.__orchestraRunTool(payloadJson)` (see electron/main.js → startBridge).
// This module is the renderer half: it registers that global so the bridge has a
// single, safe execution point.
//
// It speaks the EXACT same vocabulary as the in-app Orchestra director
// (src/lib/orchestraTools.js → runTool), so a remote Claude (via the MCP plugin
// in server/orchestra-mcp) drives Forge3D with the same tools the local director
// uses. Two calls are handled specially because they don't live in the shared
// TOOLS registry:
//   • orchestrate — hands a whole goal to the in-app director (runOrchestra) and
//     reports the final status + a compact timeline.
//   • screenshot  — captures the live viewport and returns the image so Claude
//     can SEE the design directly (no HF round-trip; that's what `look` is for).
// ============================================================================
import { runTool } from './orchestraTools.js';
import { runOrchestra } from './orchestra.js';
import { captureViewport } from './capture.js';
import { useStore } from './store.js';

// Run a full autonomous build and summarise it for the caller. runOrchestra
// drives the store and resolves when the pipeline finishes; we read the outcome
// off the store rather than inventing a return value.
async function doOrchestrate(goal) {
  if (!goal) return { ok: false, error: 'orchestrate needs a goal' };
  await runOrchestra(goal);
  const s = useStore.getState();
  return {
    ok: s.orchestraStatus !== 'error',
    result: {
      status: s.orchestraStatus, // done | error | stopped
      goal: s.orchestraGoal,
      tokens: s.orchestraTokens,
      steps: (s.orchestraSteps || []).map((st) => ({
        n: st.n, tool: st.tool || st.kind, ok: st.ok !== false,
        thought: typeof st.thought === 'string' ? st.thought.slice(0, 200) : undefined,
      })),
    },
  };
}

function doScreenshot() {
  const shot = captureViewport(useStore.getState().orchestraHeadroom || 'balanced');
  if (!shot) return { ok: false, error: 'nothing to capture yet — add or generate an object first' };
  // index.mjs surfaces result.image as an MCP image block, so Claude sees it.
  return { ok: true, result: { image: shot.dataUrl, w: shot.w, h: shot.h } };
}

// Single entry point the bridge evaluates. Accepts a JSON string so the main
// process never has to interpolate raw values into evaluated source.
async function dispatch(payloadJson) {
  let name, args;
  try {
    ({ name, args } = JSON.parse(payloadJson || '{}'));
  } catch (e) {
    return { ok: false, error: 'bridge: bad payload — ' + String(e?.message || e) };
  }
  args = args || {};
  try {
    if (name === 'orchestrate') return await doOrchestrate(args.goal);
    if (name === 'screenshot') return doScreenshot();
    return await runTool(name, args); // already returns { ok, result } | { ok:false, error }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Install the global the Electron bridge calls. Idempotent.
export function registerOrchestraBridge() {
  if (typeof window === 'undefined') return;
  window.__orchestraRunTool = dispatch;
}
