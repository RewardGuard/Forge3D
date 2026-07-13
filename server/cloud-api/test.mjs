// Acceptance tests for the F3D Cloud accounts service — run locally with a MOCK
// upstream (no real AI spend):  node test.mjs
// Boots the server on a scratch port + scratch DB, then asserts the whole
// account lifecycle: signup/login, metering to the 5k cutoff, the Stripe
// webhook flipping a plan to Pro, and billing guards.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const WHSEC = 'whsec_testsecret_123';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f3dcloud-'));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`); }
};
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });
const post = (p, body, token) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(j);
const get = (p, token) => fetch(BASE + p, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(j);

const server = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  env: {
    ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'db.json'),
    JWT_SECRET: 'test-secret', MOCK_UPSTREAM: '1', MOCK_TOKENS: '2000',
    FREE_TOKENS: '5000', PRO_TOKENS: '2000000', GLM_KEY: 'x', ANTHROPIC_KEY: 'x',
    STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '',
  },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

try {
  console.log('AUTH');
  const h = await get('/health');
  ok('health lists providers + accounts mode', h.body.ok && h.body.accounts && h.body.providers.includes('claude') && h.body.providers.includes('glm'), JSON.stringify(h.body));
  const noauth = await post('/v1/chat', { user: 'hi' });
  ok('chat without account → 401 auth_required', noauth.status === 401 && noauth.body.code === 'auth_required');
  ok('bad email rejected', (await post('/auth/signup', { email: 'nope', password: 'longenough1' })).status === 400);
  ok('short password rejected', (await post('/auth/signup', { email: 'a@b.co', password: 'short' })).status === 400);
  const su = await post('/auth/signup', { email: 'maker@test.com', password: 'supersafe123' });
  ok('signup returns token + free plan', su.status === 200 && su.body.token && su.body.account.plan === 'free', JSON.stringify(su.body));
  ok('duplicate signup → 409', (await post('/auth/signup', { email: 'maker@test.com', password: 'supersafe123' })).status === 409);
  ok('wrong password → 401', (await post('/auth/login', { email: 'maker@test.com', password: 'wrongwrong' })).status === 401);
  const li = await post('/auth/login', { email: 'maker@test.com', password: 'supersafe123' });
  ok('login works', li.status === 200 && li.body.token);
  const T = li.body.token;

  console.log('METERING (free = 5,000 tokens/month, mock 2,000/call)');
  const me0 = await get('/me', T);
  ok('fresh account: 0/5000', me0.body.usage.used === 0 && me0.body.usage.limit === 5000);
  const c1 = await post('/v1/chat', { user: 'hola', provider: 'glm' }, T);
  ok('chat #1 ok on glm', c1.status === 200 && c1.body.provider === 'glm' && c1.body.usage.used === 2000, JSON.stringify(c1.body));
  const c2 = await post('/v1/chat', { user: 'hola', provider: 'claude' }, T);
  ok('chat #2 ok on claude (any AI on free)', c2.status === 200 && c2.body.provider === 'claude' && c2.body.usage.used === 4000);
  const c3 = await post('/v1/chat', { user: 'hola' }, T);
  ok('chat #3 still allowed (4000 < 5000 at call time)', c3.status === 200 && c3.body.usage.used === 6000);
  const c4 = await post('/v1/chat', { user: 'hola' }, T);
  ok('chat #4 → 402 upgrade_required (over 5k)', c4.status === 402 && c4.body.code === 'upgrade_required', JSON.stringify(c4.body));
  ok('402 message mentions $5 upgrade + own keys', /\$5/.test(c4.body.error) && /own API key/i.test(c4.body.error));
  ok('checkout without Stripe config → 503', (await post('/billing/checkout', {}, T)).status === 503);
  ok('unknown provider → 503', (await post('/v1/chat', { user: 'x', provider: 'nope' }, (await post('/auth/signup', { email: 'z@z.co', password: 'password123' })).body.token)).status === 503);

  console.log('STRIPE WEBHOOK → PRO');
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'maker@test.com', customer: 'cus_test1', subscription: 'sub_test1' } } });
  const badSig = await fetch(BASE + '/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: payload }).then(j);
  ok('webhook with bad signature → 400', badSig.status === 400);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  const goodSig = await fetch(BASE + '/billing/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}` }, body: payload }).then(j);
  ok('signed checkout.session.completed accepted', goodSig.status === 200);
  const mePro = await get('/me', T);
  ok('plan flipped to PRO with 2M cap', mePro.body.plan === 'pro' && mePro.body.usage.limit === 2000000, JSON.stringify(mePro.body));
  const c5 = await post('/v1/chat', { user: 'hola', provider: 'claude' }, T);
  ok('pro can chat again (past 5k)', c5.status === 200);

  const cancel = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_test1', status: 'canceled' } } });
  const v2 = crypto.createHmac('sha256', WHSEC).update(`${t}.${cancel}`).digest('hex');
  await fetch(BASE + '/billing/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v2}` }, body: cancel });
  const meBack = await get('/me', T);
  ok('subscription canceled → back to free', meBack.body.plan === 'free' && meBack.body.usage.limit === 5000);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
