#!/usr/bin/env node
// ============================================================================
// Forge3D Orchestra — MCP plugin for Claude.
//
// Exposes Forge3D's Orchestra action API to Claude (Desktop / Code) as MCP
// tools, the same way the video-editing tool lets Claude drive a video editor.
// Claude can then design 3D objects, hand wiring to the circuit agent, write
// firmware and run the Life Sim — all by calling these tools.
//
// ARCHITECTURE
//   Claude  ──stdio(MCP)──▶  this server  ──HTTP──▶  Forge3D bridge  ──▶  runTool()
//                                                    (in the Electron app)
//
// This server is complete. The Forge3D-side bridge (a tiny local HTTP server in
// the Electron main process that calls runTool in the renderer) is the Phase-2
// piece — see BRIDGE.md. Until it's running, tool calls return a clear,
// actionable "bridge offline" message instead of failing silently.
// ============================================================================
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_DEFS } from './tools.mjs';

const BRIDGE_URL = process.env.FORGE3D_BRIDGE || 'http://127.0.0.1:8765';
// Must match cfg.bridgeToken in the app (Settings → Orchestra AI → control bridge).
// Optional: the bridge is localhost-only, so a token is only an extra lock.
const BRIDGE_TOKEN = process.env.FORGE3D_BRIDGE_TOKEN || '';

// Forward a tool call to the live Forge3D app over the local bridge.
async function callForge(name, args) {
  let res;
  try {
    res = await fetch(`${BRIDGE_URL}/tool`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(BRIDGE_TOKEN ? { authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ name, args: args || {} }),
    });
  } catch {
    return {
      ok: false,
      error: `Forge3D bridge offline at ${BRIDGE_URL}. Open the Forge3D desktop app and enable "Allow Claude to control Forge3D" (Settings → Orchestra AI). See server/orchestra-mcp/BRIDGE.md.`,
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || `bridge error ${res.status}` };
  return data; // { ok, result } from runTool
}

const server = new Server(
  { name: 'forge3d-orchestra', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const out = await callForge(name, args);
  // `look` returns an image — surface it to Claude as an image content block.
  const content = [{ type: 'text', text: JSON.stringify(out.result ?? out, null, 2) }];
  if (out?.result?.image && typeof out.result.image === 'string' && out.result.image.startsWith('data:')) {
    const [meta, b64] = out.result.image.split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    content.push({ type: 'image', data: b64, mimeType: mime });
  }
  return { content, isError: out?.ok === false };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('forge3d-orchestra MCP server ready (bridge: ' + BRIDGE_URL + ')');
