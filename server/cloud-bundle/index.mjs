#!/usr/bin/env node
// ============================================================================
// Forge3D — Claude Desktop bundle (hybrid: live app first, cloud fallback).
//
// A stdio MCP server Claude Desktop launches. For each tool call it routes to:
//   1) your LIVE Forge3D app, if it's open with the control bridge on
//      (http://127.0.0.1:8765) — so Claude's work APPEARS in the 3D viewport, or
//   2) the hosted Forge3D Cloud (forge3d.duckdns.org), headless, when the app
//      isn't running — so it still works with no app.
//
// Cloud URL + token are baked in via the manifest, so install is zero-config.
// ============================================================================
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TOOL_DEFS } from '../orchestra-mcp/tools.mjs';

const CLOUD_URL = process.env.FORGE3D_CLOUD_URL || 'https://forge3d.duckdns.org/mcp';
const TOKEN = process.env.FORGE3D_API_TOKEN || '';
const LOCAL_BRIDGE = (process.env.FORGE3D_BRIDGE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const BRIDGE_TOKEN = process.env.FORGE3D_BRIDGE_TOKEN || '';

// --- is the live desktop app reachable? (cached a few seconds) ---
let localUntil = 0, localOK = false;
async function localOnline() {
  if (Date.now() < localUntil) return localOK;
  try { localOK = (await fetch(LOCAL_BRIDGE + '/health', { signal: AbortSignal.timeout(800) })).ok; }
  catch { localOK = false; }
  localUntil = Date.now() + 4000;
  return localOK;
}

// --- lazy cloud MCP client (fallback when the app isn't open) ---
let cloud = null;
async function getCloud() {
  if (cloud) return cloud;
  const c = new Client({ name: 'forge3d-bundle', version: '0.1.0' }, { capabilities: {} });
  const t = new StreamableHTTPClientTransport(new URL(CLOUD_URL), { requestInit: { headers: TOKEN ? { authorization: 'Bearer ' + TOKEN } : {} } });
  await c.connect(t);
  c.onclose = () => { if (cloud === c) cloud = null; };
  cloud = c;
  return c;
}

// the local bridge returns { ok, result }; surface result text + any image block
function formatLocal(out) {
  const content = [{ type: 'text', text: JSON.stringify(out?.result ?? out, null, 2) }];
  const img = out?.result?.image;
  if (typeof img === 'string' && img.startsWith('data:')) {
    const [meta, b64] = img.split(',');
    content.push({ type: 'image', data: b64, mimeType: (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
  }
  return { content, isError: out?.ok === false };
}

const server = new Server({ name: 'forge3d', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  // 1) drive the LIVE app if it's open → the build appears in the viewport
  if (await localOnline()) {
    try {
      const r = await fetch(LOCAL_BRIDGE + '/tool', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(BRIDGE_TOKEN ? { authorization: 'Bearer ' + BRIDGE_TOKEN } : {}) },
        body: JSON.stringify({ name, args: args || {} }),
      });
      return formatLocal(await r.json());
    } catch { /* app went away mid-call — fall through to cloud */ }
  }
  // 2) headless cloud fallback
  try { return await (await getCloud()).callTool({ name, arguments: args || {} }); }
  catch (e) { cloud = null; return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e?.message || e) }) }], isError: true }; }
});

await server.connect(new StdioServerTransport());
console.error(`Forge3D bundle ready (live app: ${LOCAL_BRIDGE}, cloud: ${CLOUD_URL})`);
