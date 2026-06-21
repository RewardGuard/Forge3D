# Phase 2 — the Forge3D control bridge

The MCP server ([index.mjs](index.mjs)) is done. The remaining piece is a tiny
local HTTP server **inside the Electron app** that receives `{ name, args }` and
runs it through the renderer's `runTool(name, args)` (from
`src/lib/orchestraTools.js`). That function is already the single execution
point for every Orchestra action, so the bridge is thin.

## Why a bridge

`runTool` lives in the **renderer** (it touches the zustand store and the
`window.forge` IPC bridges). The MCP server is a **separate Node process**. The
bridge is the glue: Electron's **main** process runs the HTTP listener and asks
the **renderer** to execute the tool via IPC, then returns the result.

## Implementation sketch (electron/main.js)

```js
import http from 'node:http';

// gated by a Settings toggle ("Allow Claude to control Forge3D")
function startOrchestraBridge(win) {
  http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/tool') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { name, args } = JSON.parse(body || '{}');
        // ask the renderer to run the tool and wait for the result
        const out = await win.webContents.executeJavaScript(
          `window.__orchestraRunTool(${JSON.stringify(name)}, ${JSON.stringify(args || {})})`
        );
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
  }).listen(8765, '127.0.0.1');
}
```

## Renderer side (one line, e.g. in src/main.jsx)

```js
import { runTool } from './lib/orchestraTools.js';
window.__orchestraRunTool = (name, args) => runTool(name, args); // returns a Promise
```

For `orchestrate`, route to `runOrchestra(goal)` from `src/lib/orchestra.js`
instead of `runTool`, and stream steps back over a WebSocket if you want Claude
to watch live (optional).

## Security

- Bind to `127.0.0.1` only.
- Put it behind an explicit Settings toggle (off by default).
- Consider a shared token in the `Authorization` header echoed by the MCP server
  via an env var.
