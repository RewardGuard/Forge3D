# Phase 2 — the Forge3D control bridge ✅ BUILT

The MCP server ([index.mjs](index.mjs)) and the Electron-side bridge are both
done. This is how a remote Claude actually drives the live app:

```
Claude ──stdio(MCP)──▶ forge3d-orchestra ──HTTP──▶ Forge3D bridge ──▶ window.__orchestraRunTool ──▶ runTool()
        (index.mjs)                       127.0.0.1:8765            (electron/main.js)   (src/lib/orchestraBridge.js)
```

## The pieces (all implemented)

**Electron main — `electron/main.js`**
A localhost-only HTTP server (`startBridge` / `stopBridge`) that:
- `POST /tool  { name, args }` → asks the renderer to run the tool and returns its JSON result.
- `GET /health` → liveness + whether a token is required.
- Optional `Authorization: Bearer <token>` gate (`cfg.bridgeToken`).
- Is **off by default**, started only when the Settings toggle (`cfg.bridgeEnabled`) is on,
  and restarted on launch if it was left on. Bound to `127.0.0.1`.

It reaches the renderer with `webContents.executeJavaScript`, passing the call as a
single JSON string (`\u2028`/`\u2029` escaped) so nothing is interpolated into source.

**Renderer — `src/lib/orchestraBridge.js`** (registered in `src/main.jsx`)
Exposes `window.__orchestraRunTool(payloadJson)`, the single execution point:
- `orchestrate` → `runOrchestra(goal)` (the in-app director), returning final status + timeline.
- `screenshot` → captures the viewport and returns the image so Claude can **see** the design.
- everything else → `runTool(name, args)` from `src/lib/orchestraTools.js`.

**Settings — `src/components/SettingsButton.jsx`**
Orchestra AI section → "Let Claude control Forge3D (MCP plugin)": on/off toggle,
live listening status, a copy-paste MCP config snippet, and an optional shared token.

## Security

- Bound to `127.0.0.1` only — never reachable off the machine.
- Off by default, behind an explicit Settings toggle.
- Optional shared token (`Settings → Generate token`, mirror it into the plugin's
  `FORGE3D_BRIDGE_TOKEN` env). The MCP server forwards it as a Bearer header.

## Test it without Electron

`npm test` (in this folder) runs [smoke.mjs](smoke.mjs): it stands up a mock bridge
on the same HTTP contract and drives the real MCP server over stdio, asserting the
full tool list, token forwarding, text results, and image surfacing.
