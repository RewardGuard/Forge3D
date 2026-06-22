// End-to-end smoke test for the Forge3D Cloud remote connector. Proves BOTH
// routes with no real desktop and no real Claude:
//   1) Cloud Orchestra  — `orchestrate` over MCP-Streamable-HTTP returns a
//      validated headless design; a live-only tool reports "needs the desktop".
//   2) Relay            — a simulated paired desktop (long-poll loop) comes
//      online and the SAME live-only tool now routes to it.
// Run:  node smoke.mjs   (from server/cloud-mcp, after `npm install`)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8910;
const PAIR = 'pair-smoke-123';
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0; const ok = (m) => { console.log('  ✓ ' + m); passed++; };

const srv = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  env: { ...process.env, PORT: String(PORT), FORGE3D_PAIR_TOKEN: PAIR, FORGE3D_NO_ENV_FILE: '1' }, // open MCP auth + pairing on, ignore any local .env
  stdio: ['ignore', 'ignore', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/health'); if (r.ok) return r.json(); } catch {} await sleep(100); }
  throw new Error('server did not come up');
}
function mcp() {
  const t = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'));
  const c = new Client({ name: 'cloud-smoke', version: '0.0.0' }, { capabilities: {} });
  return { c, t };
}
const textOf = (r) => JSON.parse(r.content.find((x) => x.type === 'text').text);

let desktopRunning = true, desktopCalls = 0;
async function desktopLoop() {
  await fetch(BASE + '/relay/hello', { method: 'POST', headers: { authorization: 'Bearer ' + PAIR } }).catch(() => {});
  while (desktopRunning) {
    let call;
    try {
      const r = await fetch(BASE + `/relay/next?token=${PAIR}`);
      if (r.status === 204) continue;
      call = await r.json();
    } catch { if (desktopRunning) await sleep(50); continue; }
    desktopCalls++;
    // stand in for window.__orchestraRunTool on the live desktop
    const result = { ok: true, result: { servedBy: 'desktop', name: call.name, echo: call.args } };
    await fetch(BASE + '/relay/result', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + PAIR }, body: JSON.stringify({ callId: call.callId, result }) }).catch(() => {});
  }
}

async function main() {
  const health = await waitHealth();
  assert.equal(health.service, 'forge3d-cloud');
  ok(`server healthy, advertises ${health.tools} tools`);

  // ---------- 1) CLOUD path (no desktop online) ----------
  {
    const { c, t } = mcp(); await c.connect(t);
    const { tools } = await c.listTools();
    assert.ok(tools.length >= 32, 'full tool vocabulary served remotely');
    ok(`MCP over Streamable HTTP works; ${tools.length} tools`);

    const r = await c.callTool({ name: 'orchestrate', arguments: { goal: 'a sumo robot with ultrasonic, 4 motors and an arduino' } });
    const o = textOf(r);
    assert.equal(o.status, 'done', 'cloud orchestrate should finish a valid sumo robot');
    assert.ok(o.report && o.report.bom && o.report.bom.parts > 0, 'returns a BOM');
    assert.ok(o.design.circuit.nodes.length > 0 && o.design.meshes.length > 0, 'returns geometry + circuit');
    assert.ok(o.conforms, 'design conforms to the goal');
    ok(`Cloud Orchestra built it headless: ${o.design.meshes.length} meshes, ${o.design.circuit.nodes.length} parts, BOM ${o.report.bom.parts} ($${o.report.bom.total_usd})`);

    const live = await c.callTool({ name: 'look', arguments: { question: 'ok?' } });
    assert.ok(textOf(live).error?.includes('needs the live Forge3D'), 'live-only tool guides to pairing');
    assert.equal(live.isError, true);
    ok('live-only tool (look) returns a clear "pair your desktop" message in cloud mode');
    await c.close();
  }

  // ---------- 2) RELAY path (paired desktop online) ----------
  {
    desktopLoop();
    for (let i = 0; i < 40 && (await fetch(BASE + '/health').then((r) => r.json())).relays.every((s) => !s.online); i++) await sleep(50);
    const { c, t } = mcp(); await c.connect(t);
    const r = await c.callTool({ name: 'get_sim_report', arguments: {} }); // live-only, but desktop is up
    const o = textOf(r);
    assert.equal(o.servedBy, 'desktop', 'with a desktop paired, calls relay to the live app');
    assert.ok(desktopCalls >= 1, 'desktop actually received the call');
    ok(`relay works: get_sim_report routed to the live desktop (desktop handled ${desktopCalls} call/s)`);
    await c.close();
  }

  console.log(`\nAll ${passed} cloud-connector checks passed.`);
}

main()
  .then(() => { desktopRunning = false; srv.kill(); setTimeout(() => process.exit(0), 100); })
  .catch((e) => { console.error('CLOUD SMOKE FAILED:', e); desktopRunning = false; srv.kill(); process.exit(1); });
