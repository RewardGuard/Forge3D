// End-to-end test for F3D Storage — the HOSTED model:
//   the operator's Mac (with the F3D_STORAGE USB drives) is the single storage
//   HOST; paying customers get an isolated folder on it. This is what the $3/mo
//   actually buys — space on hardware the customer doesn't own.
//
// Spins up a scratch cloud-api (accounts/billing) + cloud-mcp (relay) pointed at
// each other, plus a fake "host" standing in for the operator's Mac + USB, and
// proves:
//   1. only the operator's account may register as the host  (403 for others)
//   2. a free customer is paywalled                          (402)
//   3. a paying customer round-trips files byte-identically  (upload/list/download)
//   4. CUSTOMER ISOLATION — customer B cannot see or read A's files
//   5. path traversal is rejected
//   6. host offline ⇒ a clear, non-destructive error
// Run: node storage-smoke.mjs   (from server/cloud-mcp)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// ---- host machine identity (mirrors electron/main.js hostProof) ----
function makeMachine(deviceId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    deviceId,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    proof(ts = Date.now()) {
      const sig = crypto.sign(null, Buffer.from(`${deviceId}.${ts}`), privateKey).toString('base64');
      return { deviceId, ts, signature: sig, publicKey: this.publicKeyPem };
    },
  };
}
const realMac = makeMachine('device-real-operator-mac');
const thiefMac = makeMachine('device-attacker-laptop');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = 8911, MCP_PORT = 8912;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const MCP_BASE = `http://127.0.0.1:${MCP_PORT}`;
const WHSEC = 'whsec_storage_smoke';
const HOST_EMAIL = 'operator@forge3d.test';
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), 'f3d-storage-smoke-'));
const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'f3d-fake-usb-')); // stands in for /Volumes/F3D_STORAGE

let passed = 0;
const ok = (m) => { console.log('  ✓ ' + m); passed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiProc = spawn(process.execPath, [path.join(__dirname, '..', 'cloud-api', 'index.mjs')], {
  env: { ...process.env, PORT: String(API_PORT), DB_PATH: path.join(tmpDb, 'db.json'), JWT_SECRET: 'smoke-secret',
    MOCK_UPSTREAM: '1', GLM_KEY: 'x', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', STRIPE_STORAGE_PRICE_ID: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const mcpProc = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  env: { ...process.env, PORT: String(MCP_PORT), FORGE3D_NO_ENV_FILE: '1', FORGE3D_ACCOUNTS_API: API_BASE,
    FORGE3D_STORAGE_HOST: HOST_EMAIL },
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitUp(base) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/health')).ok) return; } catch { /* retry */ } await sleep(100); }
  throw new Error(`${base} did not come up`);
}
const signup = async (email) =>
  (await fetch(API_BASE + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'smokepass123' }) })).json();
async function grantStorage(email) {
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: email, customer: 'cus_' + email, subscription: 'sub_x', metadata: { plan: 'storage' }, amount_total: 300 } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  const r = await fetch(API_BASE + '/billing/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: payload });
  assert.equal(r.status, 200);
}
const auth = (t) => ({ authorization: 'Bearer ' + t });

// ---- the fake HOST: the operator's Mac serving customer folders off the USB ----
const custDir = (email) => path.join(usb, 'customers', crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16));
async function hostLoop(token, stop) {
  let session = null;
  try {
    const r = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify(realMac.proof()) });
    session = (await r.json()).session;
  } catch { /* retried below */ }
  while (!stop.stop) {
    let call;
    try {
      const r = await fetch(MCP_BASE + '/storage/relay/next', { headers: { ...auth(token), 'x-f3d-host-session': session } });
      if (r.status === 204) continue;
      if (!r.ok) { await sleep(200); continue; }
      call = await r.json();
    } catch { await sleep(200); continue; }
    let result;
    try {
      const who = call.args?.customer;                 // injected by the server
      const dir = custDir(who);
      fs.mkdirSync(dir, { recursive: true });
      const safe = (n) => path.basename(String(n || ''));
      if (call.name === 'storage_list') {
        result = { ok: true, result: { files: fs.readdirSync(dir).map((n) => ({ name: n, size: fs.statSync(path.join(dir, n)).size })) } };
      } else if (call.name === 'storage_get') {
        const p = path.join(dir, safe(call.args.name));
        if (!fs.existsSync(p)) throw new Error('file not found');
        result = { ok: true, result: { name: safe(call.args.name), content_base64: fs.readFileSync(p).toString('base64') } };
      } else if (call.name === 'storage_put') {
        fs.writeFileSync(path.join(dir, safe(call.args.name)), Buffer.from(call.args.content_base64, 'base64'));
        result = { ok: true, result: { name: safe(call.args.name) } };
      } else result = { ok: false, error: 'unknown' };
    } catch (e) { result = { ok: false, error: String(e?.message || e) }; }
    await fetch(MCP_BASE + '/storage/relay/result', { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json', 'x-f3d-host-session': session }, body: JSON.stringify({ callId: call.callId, result }) }).catch(() => {});
  }
}

try {
  await waitUp(API_BASE); await waitUp(MCP_BASE);

  console.log('HOST REGISTRATION');
  const host = await signup(HOST_EMAIL);
  const custA = await signup('alice@customer.test');
  const custB = await signup('bob@customer.test');
  ok('operator + two customer accounts created');

  const notHost = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: auth(custA.token), body: JSON.stringify(thiefMac.proof()) });
  assert.equal(notHost.status, 403);
  ok('a customer CANNOT register as the storage host (403)');


  console.log('\nPAYWALL');
  assert.equal((await fetch(MCP_BASE + '/storage/list', { headers: auth(custA.token) })).status, 402);
  ok('unpaid customer is paywalled (402)');
  assert.equal((await fetch(MCP_BASE + '/storage/list')).status, 401);
  ok('no token → 401');

  console.log('\nHOST OFFLINE');
  await grantStorage('alice@customer.test');
  await grantStorage('bob@customer.test');
  await sleep(5200); // outlast the 5s /me cache
  const off = await fetch(MCP_BASE + '/storage/list', { headers: auth(custA.token) });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).code, 'host_offline');
  ok('paid customer + host offline → 503 host_offline (non-destructive message)');

  console.log('\nMACHINE PINNING — a stolen account token must NOT be enough');
  // the operator's real Mac registers first and gets pinned
  const first = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(host.token), 'content-type': 'application/json' }, body: JSON.stringify(realMac.proof()) });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).firstPin, true);
  ok('the operator\'s Mac registers and is PINNED on first use');

  // THE ATTACK: someone copied forge3d.config.json and holds a perfectly valid
  // operator token, but runs on a different machine with a different key.
  const stolen = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(host.token), 'content-type': 'application/json' }, body: JSON.stringify(thiefMac.proof()) });
  assert.equal(stolen.status, 403, 'a stolen token on another machine was allowed to host!');
  assert.equal((await stolen.json()).code, 'not_host_machine');
  ok('STOLEN OPERATOR TOKEN on another machine → 403 not_host_machine');

  // it can't replay the real Mac's captured signature later
  const replay = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(host.token), 'content-type': 'application/json' }, body: JSON.stringify(realMac.proof(Date.now() - 30 * 60_000)) });
  assert.equal(replay.status, 403);
  ok('a captured 30-min-old signature is refused (replay blocked)');

  // nor forge one under the real public key
  const forged = { ...realMac.proof(), signature: Buffer.from('not-a-real-signature').toString('base64') };
  const forgedRes = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(host.token), 'content-type': 'application/json' }, body: JSON.stringify(forged) });
  assert.equal(forgedRes.status, 403);
  ok('a forged signature under the real public key is refused');

  // A stolen token must not be able to SKIP /hello and poll the relay directly —
  // that would hand the attacker every customer's calls without any machine proof.
  const skipHello = await fetch(MCP_BASE + '/storage/relay/next', { headers: auth(host.token) });
  assert.equal(skipHello.status, 403, 'relay polling without a machine-verified session was allowed!');
  assert.equal((await skipHello.json()).code, 'host_session_required');
  ok('polling the relay WITHOUT a verified session → 403 host_session_required');

  const reReg = await fetch(MCP_BASE + '/storage/relay/hello', { method: 'POST', headers: { ...auth(host.token), 'content-type': 'application/json' }, body: JSON.stringify(realMac.proof()) });
  assert.equal(reReg.status, 200);
  const sess = (await reReg.json()).session;
  assert.ok(sess, 'no host session issued');
  ok('the genuine Mac registers and receives a host session');

  const wrongSess = await fetch(MCP_BASE + '/storage/relay/next', { headers: { ...auth(host.token), 'x-f3d-host-session': crypto.randomUUID() } });
  assert.equal(wrongSess.status, 403);
  ok('a guessed/forged session id is refused');

  console.log('\nHOSTED ROUND-TRIP');
  const stop = { stop: false };
  const loop = hostLoop(host.token, stop);
  await sleep(400);
  assert.equal((await (await fetch(MCP_BASE + '/storage/online', { headers: auth(custA.token) })).json()).online, true);
  ok('host is online for customers');

  const aData = 'alice private design ' + Date.now();
  assert.equal((await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('a.txt'), { method: 'POST', headers: auth(custA.token), body: aData })).status, 200);
  ok('customer A uploaded a file');

  assert.ok(fs.existsSync(path.join(custDir('alice@customer.test'), 'a.txt')), 'file did not land in A\'s folder on the USB');
  assert.equal(fs.readFileSync(path.join(custDir('alice@customer.test'), 'a.txt'), 'utf-8'), aData);
  ok('bytes landed byte-identical on the operator\'s USB, in A\'s own folder');

  const back = await (await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('a.txt'), { headers: auth(custA.token) })).text();
  assert.equal(back, aData);
  ok('customer A downloaded it back unchanged');

  console.log('\nCUSTOMER ISOLATION (the security property that matters)');
  const bList = await (await fetch(MCP_BASE + '/storage/list', { headers: auth(custB.token) })).json();
  assert.deepEqual(bList.result.files, [], `customer B can see A's files: ${JSON.stringify(bList.result.files)}`);
  ok('customer B\'s listing does NOT include A\'s file');

  const steal = await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('a.txt'), { headers: auth(custB.token) });
  assert.notEqual(steal.status, 200);
  ok('customer B CANNOT download A\'s file by name (404)');

  await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('b.txt'), { method: 'POST', headers: auth(custB.token), body: 'bob data' });
  assert.equal(fs.readFileSync(path.join(custDir('alice@customer.test'), 'a.txt'), 'utf-8'), aData, 'B\'s upload overwrote A\'s file!');
  ok('B\'s upload lands in B\'s own folder, leaving A untouched');

  const trav = await fetch(MCP_BASE + '/storage/file/' + encodeURIComponent('../../../etc/passwd'), { headers: auth(custB.token) });
  assert.notEqual(trav.status, 200);
  ok('path traversal is rejected');

  stop.stop = true;
  await loop.catch(() => {});
} finally {
  apiProc.kill(); mcpProc.kill();
  fs.rmSync(tmpDb, { recursive: true, force: true });
  fs.rmSync(usb, { recursive: true, force: true });
}

console.log(`\n${passed} passed`);
