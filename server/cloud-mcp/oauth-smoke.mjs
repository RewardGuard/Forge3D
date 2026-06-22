// Proves the OAuth 2.1 resource-server path WITHOUT a real IdP: it stands up a
// throwaway "identity provider" (generates an RSA key, serves a JWKS, mints a
// signed access token), points the cloud server at it, then checks:
//   - a valid signed token is accepted and its `sub` becomes the routing owner
//   - a bogus token is rejected (401)
//   - per-user routing: the token's `sub` reaches the desktop paired to that sub
// Run:  node oauth-smoke.mjs   (from server/cloud-mcp, after `npm install`)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8911, JWKS_PORT = 8912;
const ISSUER = 'https://idp.test.local/';
const AUDIENCE = `http://127.0.0.1:${PORT}`;
const SUB = 'user-abc-123';
const PAIR = 'pair-oauth-xyz';
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0; const ok = (m) => { console.log('  ✓ ' + m); passed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- throwaway IdP: key + JWKS endpoint + token minting ---
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
const jwksServer = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
const mintToken = (sub = SUB, aud = AUDIENCE) => new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-1' }).setIssuer(ISSUER).setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime('10m').sign(privateKey);

const srv = spawn(process.execPath, [path.join(__dirname, 'index.mjs')], {
  env: { ...process.env, PORT: String(PORT), FORGE3D_NO_ENV_FILE: '1',
    FORGE3D_OAUTH_ISSUER: ISSUER, FORGE3D_OAUTH_JWKS: `http://127.0.0.1:${JWKS_PORT}/jwks`, FORGE3D_OAUTH_AUDIENCE: AUDIENCE,
    FORGE3D_PAIR_TOKEN: PAIR, FORGE3D_PAIR_OWNER: SUB },
  stdio: ['ignore', 'ignore', 'inherit'],
});

function mcp(token) {
  const t = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), token ? { requestInit: { headers: { authorization: 'Bearer ' + token } } } : undefined);
  return { c: new Client({ name: 'oauth-smoke', version: '0' }, { capabilities: {} }), t };
}
const textOf = (r) => JSON.parse(r.content.find((x) => x.type === 'text').text);

let desktopRunning = true, desktopCalls = 0;
async function desktopLoop() {
  await fetch(BASE + '/relay/hello', { method: 'POST', headers: { authorization: 'Bearer ' + PAIR } }).catch(() => {});
  while (desktopRunning) {
    let call;
    try { const r = await fetch(BASE + `/relay/next?token=${PAIR}`); if (r.status === 204) continue; call = await r.json(); }
    catch { if (desktopRunning) await sleep(50); continue; }
    desktopCalls++;
    await fetch(BASE + '/relay/result', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + PAIR }, body: JSON.stringify({ callId: call.callId, result: { ok: true, result: { servedBy: 'desktop', forOwner: SUB, name: call.name } } }) }).catch(() => {});
  }
}

async function main() {
  await new Promise((res, rej) => { jwksServer.listen(JWKS_PORT, '127.0.0.1', res); jwksServer.once('error', rej); });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await sleep(100); }

  // discovery doc advertises the issuer
  const prm = await (await fetch(BASE + '/.well-known/oauth-protected-resource')).json();
  assert.equal(prm.authorization_servers[0], ISSUER);
  ok('serves OAuth protected-resource metadata pointing at the issuer');

  // bogus token → 401
  const bad = await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer not-a-real-jwt', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 401);
  ok('rejects an invalid/forged token (401)');

  // valid signed token → accepted, routes as the token subject
  const token = await mintToken();
  const { c, t } = mcp(token); await c.connect(t);
  const { tools } = await c.listTools();
  assert.ok(tools.length >= 32);
  const r = await c.callTool({ name: 'orchestrate', arguments: { goal: 'a desk gadget with 3 LEDs, a button and a motion sensor' } });
  assert.equal(textOf(r).status, 'done');
  ok('accepts a valid signed token, verifies sig+iss+aud, and runs Cloud Orchestra');
  await c.close();

  // per-user routing: token.sub === paired desktop owner → relays to that desktop
  desktopLoop();
  for (let i = 0; i < 40 && (await fetch(BASE + '/health').then((x) => x.json())).relays.every((s) => !s.online); i++) await sleep(50);
  const t2 = await mintToken();
  const { c: c2, t: tr2 } = mcp(t2); await c2.connect(tr2);
  const live = textOf(await c2.callTool({ name: 'look', arguments: { question: 'ok?' } }));
  assert.equal(live.servedBy, 'desktop');
  assert.equal(live.forOwner, SUB);
  ok('per-user routing: the token subject reaches THAT user\'s paired desktop');
  await c2.close();

  console.log(`\nAll ${passed} OAuth checks passed.`);
}

main()
  .then(() => { desktopRunning = false; srv.kill(); jwksServer.close(); setTimeout(() => process.exit(0), 100); })
  .catch((e) => { console.error('OAUTH SMOKE FAILED:', e); desktopRunning = false; srv.kill(); jwksServer.close(); process.exit(1); });
