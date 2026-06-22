// End-to-end smoke test for the Forge3D Orchestra MCP plugin.
//
// It does NOT need Electron: it stands up a MOCK bridge (same HTTP contract the
// real Electron bridge implements in electron/main.js — POST /tool, GET /health,
// optional Bearer token) and drives the REAL MCP server (index.mjs) over stdio
// with the MCP SDK client, exactly the way Claude Desktop would.
//
// Run:  node smoke.mjs   (from server/orchestra-mcp, after `npm install`)
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_DEFS } from './tools.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'smoke-secret-123';
const PORT = 8799; // off the default 8765 so it never collides with a real app

// 1x1 jpeg so the image-surfacing path has real data to chew on.
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let seenAuth = null;

// --- mock bridge = the renderer's runTool, but deterministic ---
const bridge = http.createServer((req, res) => {
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, app: 'forge3d', version: 'mock' });
  if (req.method !== 'POST' || req.url !== '/tool') return json(404, { ok: false, error: 'not found' });
  seenAuth = req.headers['authorization'] || null;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { name, args } = JSON.parse(body || '{}');
    if (name === 'get_state') return json(200, { ok: true, result: { tab: 'design', objectCount: 0, echo: args } });
    if (name === 'screenshot') return json(200, { ok: true, result: { image: TINY_JPEG, w: 1, h: 1 } });
    if (name === 'add_primitive') return json(200, { ok: true, result: { id: 'm1', kind: args?.kind || 'box' } });
    return json(200, { ok: false, error: `mock has no handler for "${name}"` });
  });
});

function listen(server, port) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}

let passed = 0;
const ok = (msg) => { console.log('  ✓ ' + msg); passed++; };

async function main() {
  await listen(bridge, PORT);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'index.mjs')],
    env: { ...process.env, FORGE3D_BRIDGE: `http://127.0.0.1:${PORT}`, FORGE3D_BRIDGE_TOKEN: TOKEN },
  });
  const client = new Client({ name: 'forge3d-smoke', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);

  // 1) tool list is complete and matches our static defs
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = TOOL_DEFS.map((t) => t.name).sort();
  assert.deepEqual(names, expected, 'served tool list must equal TOOL_DEFS');
  for (const must of ['get_state', 'build_circuit', 'gen_code', 'run_sim', 'look', 'screenshot', 'orchestrate', 'validate_structure', 'done']) {
    assert.ok(names.includes(must), `missing tool: ${must}`);
  }
  ok(`server advertises all ${names.length} tools (incl. screenshot + orchestrate + validators)`);

  // 2) a normal tool round-trips through the bridge and the bearer token is forwarded
  const state = await client.callTool({ name: 'get_state', arguments: { probe: 1 } });
  const stateText = state.content.find((c) => c.type === 'text')?.text || '';
  assert.ok(stateText.includes('"tab": "design"'), 'get_state result should surface as text');
  assert.ok(stateText.includes('"probe": 1'), 'args should reach the bridge');
  assert.equal(seenAuth, `Bearer ${TOKEN}`, 'MCP server must forward the bearer token');
  ok('get_state round-trips and forwards the Authorization: Bearer token');

  // 3) screenshot surfaces an actual image content block (so Claude can SEE the design)
  const shot = await client.callTool({ name: 'screenshot', arguments: {} });
  const img = shot.content.find((c) => c.type === 'image');
  assert.ok(img, 'screenshot must return an image content block');
  assert.equal(img.mimeType, 'image/jpeg', 'image mime should be detected from the data URL');
  assert.ok(img.data && !img.data.startsWith('data:'), 'image block must carry raw base64, not the data: URL');
  ok('screenshot returns a real image block (base64 + mime) for Claude to view');

  // 4) tool errors come back flagged, not thrown
  const bad = await client.callTool({ name: 'add_primitive', arguments: { kind: 'box' } });
  assert.ok(!bad.isError, 'a successful tool should not be flagged as error');
  ok('successful tool calls are not flagged isError');

  await client.close();
  bridge.close();
  console.log(`\nAll ${passed} bridge/MCP checks passed.`);
}

main().catch((e) => { console.error('SMOKE FAILED:', e); bridge.close(); process.exit(1); });
