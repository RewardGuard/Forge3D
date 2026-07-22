// End-to-end smoke test for F3D Storage remote access — no real desktop, no real
// Stripe. Spins up a scratch cloud-api (accounts/billing) + a scratch cloud-mcp
// (storage relay) pointed at each other, then:
//   1. free account  → /storage/list is 402 upgrade_required (paywall works)
//   2. paid account  → simulates a paired "desktop" (a temp folder standing in
//      for the local F3D Storage volume) and proves list/get/put round-trip
//      end-to-end through the SAME relay protocol the real Electron app speaks
//   3. no token      → 401
// Run: node storage-smoke.mjs   (from server/cloud-mcp)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = 8911, MCP_PORT = 8912;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const MCP_BASE = `http://127.0.0.1:${MCP_PORT}`;
const WHSEC = 'whsec_storage_smoke';
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), 'f3d-storage-smoke-'));
const desktopFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'f3d-storage-desktop-')); // stands in for the local volume

let passed = 0;
const ok = (m) => { console.log('  ✓ ' + m); passed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiProc = spawn(process.execPath, [path.join(__dirname, '..', 'cloud-api', 'index.mjs')], {
  env: { ...process.env, PORT: String(API_PORT), DB_PATH: path.join(tmpDb, 'db.json'), JWT_SECRET: 'smoke-secret',
    MOCK_UPSTREAM: '1', GLM_KEY: 'x', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', STRIPE_STORAGE_PRICE_ID: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const mcpProc = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  env: { ...process.env, PORT: String(MCP_PORT), FORGE3D_NO_ENV_FILE: '1', FORGE3D_ACCOUNTS_API: API_BASE },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/health'); if (r.ok) return; } catch { /* retry */ } await sleep(100); }
  throw new Error(`${base} did not come up`);
}

function signWebhook(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
async function grantStorage(email) {
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: email, customer: 'cus_smoke', subscription: 'sub_smoke', metadata: { plan: 'storage' }, amount_total: 300 } } });
  const r = await fetch(API_BASE + '/billing/webhook', { method: 'POST', headers: { 'stripe-signature': signWebhook(payload) }, body: payload });
  assert.equal(r.status, 200, 'webhook should grant storage plan');
}

// ---- a fake "desktop": long-polls /storage/relay/next and serves the temp dir ----
function safeName(n) { return path.basename(String(n || '')); }
async function desktopLoop(token, stopFlag) {
  await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: '{}' }).catch(() => {});
  while (!stopFlag.stop) {
    let call;
    try {
      const r = await fetch(MCP_BASE + '/storage/relay/next', { headers: { authorization: 'Bearer ' + token } });
      if (r.status === 204) continue;
      if (!r.ok) { await sleep(200); continue; }
      call = await r.json();
    } catch { await sleep(200); continue; }
    let result;
    try {
      if (call.name === 'storage_list') {
        const files = fs.readdirSync(desktopFiles).map((n) => ({ name: n, size: fs.statSync(path.join(desktopFiles, n)).size }));
        result = { ok: true, result: { files } };
      } else if (call.name === 'storage_get') {
        const p = path.join(desktopFiles, safeName(call.args.name));
        result = { ok: true, result: { name: safeName(call.args.name), content_base64: fs.readFileSync(p).toString('base64') } };
      } else if (call.name === 'storage_put') {
        const p = path.join(desktopFiles, safeName(call.args.name));
        fs.writeFileSync(p, Buffer.from(call.args.content_base64, 'base64'));
        result = { ok: true, result: { name: safeName(call.args.name) } };
      } else result = { ok: false, error: 'unknown' };
    } catch (e) { result = { ok: false, error: String(e?.message || e) }; }
    await fetch(MCP_BASE + '/storage/relay/result', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ callId: call.callId, result }) }).catch(() => {});
  }
}

try {
  await waitUp(API_BASE);
  await waitUp(MCP_BASE);
  console.log('AUTH + PAYWALL');

  const su = await fetch(API_BASE + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'storage-smoke@test.com', password: 'smokepass123' }) }).then((r) => r.json());
  const freeToken = su.token;
  ok('free account signed up');

  const noAuth = await fetch(MCP_BASE + '/storage/list');
  assert.equal(noAuth.status, 401);
  ok('no token → 401');

  const freeList = await fetch(MCP_BASE + '/storage/list', { headers: { authorization: 'Bearer ' + freeToken } });
  assert.equal(freeList.status, 402);
  const freeBody = await freeList.json();
  assert.equal(freeBody.code, 'upgrade_required');
  ok('free account (no storage plan) → 402 upgrade_required');

  console.log('GRANT STORAGE PLAN (simulated Stripe webhook)');
  await grantStorage('storage-smoke@test.com');
  await sleep(5200); // outlast cloud-mcp's 5s /me cache so the next check sees the new plan
  ok('webhook granted storagePlan=storage');

  console.log('DESKTOP OFFLINE CASE');
  const offlineList = await fetch(MCP_BASE + '/storage/list', { headers: { authorization: 'Bearer ' + freeToken } });
  assert.equal(offlineList.status, 503);
  ok('paid but desktop not paired → 503 desktop_offline');

  console.log('PAIR THE (FAKE) DESKTOP + FULL ROUND-TRIP');
  const stopFlag = { stop: false };
  const loopPromise = desktopLoop(freeToken, stopFlag);
  await sleep(300); // let /storage/relay/hello land

  const online = await fetch(MCP_BASE + '/storage/online', { headers: { authorization: 'Bearer ' + freeToken } }).then((r) => r.json());
  assert.equal(online.online, true);
  ok('desktop shows online after hello');

  const emptyList = await fetch(MCP_BASE + '/storage/list', { headers: { authorization: 'Bearer ' + freeToken } }).then((r) => r.json());
  assert.deepEqual(emptyList.result.files, []);
  ok('list is empty before any upload');

  const content = 'hello from a remote device, ' + Date.now();
  const up = await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('note.txt'), { method: 'POST', headers: { authorization: 'Bearer ' + freeToken }, body: content });
  assert.equal(up.status, 200);
  ok('uploaded note.txt from the "remote client"');

  assert.ok(fs.existsSync(path.join(desktopFiles, 'note.txt')), 'file landed on the desktop-side folder');
  assert.equal(fs.readFileSync(path.join(desktopFiles, 'note.txt'), 'utf-8'), content);
  ok('uploaded bytes are byte-identical on the "local disk"');

  const list2 = await fetch(MCP_BASE + '/storage/list', { headers: { authorization: 'Bearer ' + freeToken } }).then((r) => r.json());
  assert.equal(list2.result.files.length, 1);
  assert.equal(list2.result.files[0].name, 'note.txt');
  ok('list now shows note.txt');

  const dl = await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('note.txt'), { headers: { authorization: 'Bearer ' + freeToken } });
  assert.equal(dl.status, 200);
  const dlText = await dl.text();
  assert.equal(dlText, content);
  ok('downloaded content matches exactly (round-trip proven)');

  // path traversal guard
  const traversal = await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('../../etc/passwd'), { headers: { authorization: 'Bearer ' + freeToken } });
  assert.notEqual(traversal.status, 200);
  ok('path traversal attempt is rejected (basename-only resolution)');

  stopFlag.stop = true;
  await loopPromise.catch(() => {});
} finally {
  apiProc.kill();
  mcpProc.kill();
  fs.rmSync(tmpDb, { recursive: true, force: true });
  fs.rmSync(desktopFiles, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
