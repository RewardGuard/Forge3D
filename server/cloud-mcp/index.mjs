#!/usr/bin/env node
// ============================================================================
// Forge3D Cloud — REMOTE MCP server (directory-listable connector).
//
//   Claude ──HTTPS (Streamable HTTP MCP)──▶  this server
//                                              ├─ desktop paired & online?  ──▶ relay to the LIVE app
//                                              └─ otherwise                  ──▶ Cloud Orchestra (headless engine)
//
// Same tool vocabulary as the local plugin (server/orchestra-mcp/tools.mjs). The
// difference is reach: with no install you still get a validated design back; with
// your desktop paired you drive the real 3D viewport + Life Sim.
//
// Run:  node index.mjs   (PORT, FORGE3D_API_TOKEN, FORGE3D_PAIR_TOKEN — see README/DEPLOY)
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Load ./.env (written by `npm run setup`) without a dependency. Real env vars
// win; FORGE3D_NO_ENV_FILE=1 skips the file entirely (used by the smoke test).
if (!process.env.FORGE3D_NO_ENV_FILE) {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    for (const line of fs.readFileSync(path.join(dir, '.env'), 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env — use real env vars */ }
}
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { TOOL_DEFS } from '../orchestra-mcp/tools.mjs';
import { runCloudTool } from './cloudOrchestra.mjs';
import { isOnline, relayCall, nextCall, submitResult, markSeen, relayStats } from './desktopRelay.mjs';

const PORT = Number(process.env.PORT) || 8788;
const PUBLIC_URL = process.env.FORGE3D_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
// OAuth 2.1 (directory mode). When ISSUER+JWKS are set, the server verifies the
// access token's signature and returns its subject so each user routes to their
// own paired desktop. When unset, it falls back to single-tenant token auth.
const ISSUER = process.env.FORGE3D_OAUTH_ISSUER || '';
const JWKS_URL = process.env.FORGE3D_OAUTH_JWKS || (ISSUER ? ISSUER.replace(/\/$/, '') + '/.well-known/jwks.json' : '');
const AUDIENCE = process.env.FORGE3D_OAUTH_AUDIENCE || PUBLIC_URL;
const OAUTH_ON = Boolean(ISSUER && JWKS_URL);
const jwks = OAUTH_ON ? createRemoteJWKSet(new URL(JWKS_URL)) : null;

// Per-IP rate limit for the expensive /mcp path (orchestrate is real CPU work).
// Mirrors server/proxy/index.mjs. Tune with FORGE3D_RATE_PER_MIN.
const RL_WINDOW_MS = 60_000;
const RL_MAX = Number(process.env.FORGE3D_RATE_PER_MIN) || 30;
const rlHits = new Map();
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (rlHits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(ip, arr);
  if (rlHits.size > 5000) for (const [k, v] of rlHits) if (!v.some((t) => now - t < RL_WINDOW_MS)) rlHits.delete(k);
  return arr.length > RL_MAX;
}

// ---------------------------------------------------------------------------
// Auth seam → returns the request's `owner` (routing key), or null = 401.
//   OAuth mode:   verify JWT (sig + iss + aud), owner = token subject.
//   token mode:   FORGE3D_API_TOKEN must match, owner = "self".
//   open:         nothing configured → owner = "self" (private network/dev).
// ---------------------------------------------------------------------------
const bearer = (req) => (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
async function authOwner(req) {
  if (OAUTH_ON) {
    const tok = bearer(req);
    if (!tok) return null;
    try {
      const { payload } = await jwtVerify(tok, jwks, { issuer: ISSUER, audience: AUDIENCE });
      return payload.sub || null; // per-user owner
    } catch { return null; }
  }
  const want = process.env.FORGE3D_API_TOKEN;
  if (want) return bearer(req) === want ? 'self' : null;
  if (process.env.FORGE3D_REQUIRE_AUTH === '1') return null;
  return 'self';
}
// Desktop pairing identity → which owner this desktop serves. The pairing token
// maps to FORGE3D_PAIR_OWNER (set this to your OAuth subject in directory mode so
// your Claude identity reaches your desktop); defaults to "self" single-tenant.
function pairOwner(req) {
  const want = process.env.FORGE3D_PAIR_TOKEN;
  if (!want) return null; // pairing disabled until a token is set
  const tok = bearer(req) || new URL(req.url, PUBLIC_URL).searchParams.get('token');
  return tok === want ? (process.env.FORGE3D_PAIR_OWNER || 'self') : null;
}

// ---------------------------------------------------------------------------
// F3D Storage remote access — per-ACCOUNT auth (separate from the single-tenant
// pairing above). Verifies the caller's Forge3D Cloud account token against the
// billing service's own /me (same box, called over loopback) and only allows
// through if that account's paid plan includes storage. The files themselves
// NEVER touch this server — this only brokers relay calls to the user's own
// paired Mac (server/cloud-mcp/desktopRelay.mjs), keyed by their account email.
// ---------------------------------------------------------------------------
const ACCOUNTS_API = process.env.FORGE3D_ACCOUNTS_API || 'http://127.0.0.1:8787';
const meCache = new Map(); // token -> { at, data }
const ME_TTL = 5000, ME_CACHE_MAX = 500;
async function accountMe(token) {
  const cached = meCache.get(token);
  if (cached && Date.now() - cached.at < ME_TTL) return cached.data;
  let data = null;
  try {
    const r = await fetch(ACCOUNTS_API + '/me', { headers: { authorization: 'Bearer ' + token } });
    if (r.ok) data = await r.json();
  } catch { /* accounts API unreachable — treat as unauthenticated */ }
  // Evict expired entries (and hard-cap the map): every distinct token used to
  // add an entry that was never removed — an unbounded leak on a 1GB box.
  if (meCache.size >= ME_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of meCache) if (now - v.at >= ME_TTL) meCache.delete(k);
    if (meCache.size >= ME_CACHE_MAX) meCache.clear(); // all fresh: safe to drop, it's only a cache
  }
  meCache.set(token, { at: Date.now(), data });
  return data;
}
// ONE storage host serves every customer: the operator's Mac with the
// F3D_STORAGE USB drives attached. Customers don't host their own files (they'd
// have nothing to pay for) — they get a folder on the host's drives. The host
// authenticates with the operator's own account, identified by FORGE3D_STORAGE_HOST.
const STORAGE_HOST_OWNER = 'storage:host';
const HOST_EMAIL = (process.env.FORGE3D_STORAGE_HOST || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// HOST PINNING — the operator's account is necessary but NOT sufficient.
//
// The account token lives in a file on the operator's Mac, so a stolen copy
// would otherwise let an attacker host from their own machine and receive every
// customer's uploads. The first successful registration therefore PINS that
// machine's Ed25519 public key + device fingerprint to disk; from then on the
// server requires a fresh, valid signature from that exact key. Wrong machine,
// wrong key, or a replayed old signature ⇒ 403, even with perfect credentials.
// Re-pinning is deliberately a manual, physical act: delete host-pin.json on
// the server (see PIN_FILE below).
// ---------------------------------------------------------------------------
const PIN_FILE = process.env.FORGE3D_HOST_PIN || path.join(path.dirname(fileURLToPath(import.meta.url)), 'host-pin.json');
const PROOF_SKEW_MS = 5 * 60_000; // reject signatures older/newer than 5 minutes
let hostPin = null;
try { hostPin = JSON.parse(fs.readFileSync(PIN_FILE, 'utf-8')); } catch { /* not pinned yet */ }

// A verified /hello mints a short-lived session. /relay/next and /relay/result
// require it — otherwise a stolen token could skip the machine proof entirely by
// polling the relay directly, which would hand that attacker every customer call.
const HOST_SESSION_MS = 10 * 60_000;
let hostSession = null; // { id, exp }
function newHostSession() {
  hostSession = { id: crypto.randomUUID(), exp: Date.now() + HOST_SESSION_MS };
  return hostSession.id;
}
function validHostSession(req) {
  const id = req.headers['x-f3d-host-session'];
  if (!hostSession || !id) return false;
  if (Date.now() > hostSession.exp) { hostSession = null; return false; }
  const a = Buffer.from(String(id)), b = Buffer.from(hostSession.id);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns { ok } or { ok:false, reason }. `proof` = { deviceId, ts, signature, publicKey }.
function verifyHostProof(proof) {
  const { deviceId, ts, signature, publicKey } = proof || {};
  if (!deviceId || !ts || !signature || !publicKey) return { ok: false, reason: 'missing device proof' };
  if (Math.abs(Date.now() - Number(ts)) > PROOF_SKEW_MS) return { ok: false, reason: 'stale device proof' };
  // the signature must be over THIS deviceId+timestamp, made by the presented key
  let signatureOk = false;
  try {
    signatureOk = crypto.verify(null, Buffer.from(`${deviceId}.${ts}`), crypto.createPublicKey(publicKey), Buffer.from(signature, 'base64'));
  } catch { return { ok: false, reason: 'malformed device key' }; }
  if (!signatureOk) return { ok: false, reason: 'bad device signature' };

  if (!hostPin) { // trust on first use, then immutable
    hostPin = { deviceId, publicKey, pinnedAt: Date.now() };
    try { fs.writeFileSync(PIN_FILE, JSON.stringify(hostPin, null, 2), { mode: 0o600 }); } catch { /* best effort */ }
    console.error(`[f3d-storage] host machine PINNED (device ${deviceId.slice(0, 12)}…). Delete ${PIN_FILE} to re-pin.`);
    return { ok: true, firstPin: true };
  }
  // constant-time compare of the pinned key, and an exact device match
  const a = Buffer.from(hostPin.publicKey), b = Buffer.from(publicKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'this is not the pinned host machine' };
  if (hostPin.deviceId !== deviceId) return { ok: false, reason: 'device fingerprint changed' };
  return { ok: true };
}

async function storageAuth(req) {
  const tok = bearer(req);
  if (!tok) return null;
  const me = await accountMe(tok);
  if (!me?.email) return null;
  const email = String(me.email).toLowerCase();
  return {
    email,
    isHost: Boolean(HOST_EMAIL) && email === HOST_EMAIL,
    // every customer's traffic is relayed to the SAME host session
    owner: STORAGE_HOST_OWNER,
    entitled: Boolean(me.storage?.plan && me.storage.plan !== 'none'),
  };
}
function readBodyBuffer(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// MCP server (one per request — stateless). Routes each tool call to the live
// desktop if paired, else to the headless cloud engine.
// ---------------------------------------------------------------------------
function formatToolResult(out) {
  const content = [{ type: 'text', text: JSON.stringify(out?.result ?? out, null, 2) }];
  const img = out?.result?.image;
  if (typeof img === 'string' && img.startsWith('data:')) {
    const [meta, b64] = img.split(',');
    content.push({ type: 'image', data: b64, mimeType: (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' });
  }
  return { content, isError: out?.ok === false };
}

function makeServer(owner) {
  const server = new Server({ name: 'forge3d-cloud', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    let out;
    try {
      out = isOnline(owner)
        ? await relayCall(owner, name, args || {})   // drive the live desktop
        : await runCloudTool(name, args || {});       // headless cloud design
    } catch (e) {
      out = { ok: false, error: String(e?.message || e) };
    }
    return formatToolResult(out);
  });
  return server;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'mcp-session-id',
};
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 16e6) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => resolve(b)); req.on('error', reject);
  });
}

// Resolve the newest installer from the GitHub release (10-min cache) so the
// forge3d.design/download/{mac,windows} links always point at the latest .dmg/.exe.
const GH_RELEASE = 'https://api.github.com/repos/RewardGuard/Forge3D/releases/latest';
let _rel = { at: 0, assets: [] };
async function latestAssetUrl(re) {
  if (Date.now() - _rel.at > 600000) {
    const r = await fetch(GH_RELEASE, { headers: { 'user-agent': 'forge3d-cloud', accept: 'application/vnd.github+json' } });
    const j = await r.json();
    _rel = { at: Date.now(), assets: j.assets || [] };
  }
  const a = _rel.assets.find((x) => re.test(x.name));
  if (!a) throw new Error('no matching asset');
  return a.browser_download_url;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    // ---- health ----
    if (req.method === 'GET' && url.pathname === '/health')
      return sendJson(res, 200, { ok: true, service: 'forge3d-cloud', tools: TOOL_DEFS.length, relays: relayStats() });

    // ---- static site: landing page, legal pages, logo, bundle download ----
    if (req.method === 'GET') {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const STATIC = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/about': ['about.html', 'text/html; charset=utf-8'],
        '/storage': ['storage.html', 'text/html; charset=utf-8'],
        '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
        '/terms': ['terms.html', 'text/html; charset=utf-8'],
        '/logo.png': ['logo.png', 'image/png'],
        // Favicons: small F3 marks (a few KB) — logo.png is 1.2MB and would be
        // re-fetched on every page view if used as the icon.
        '/favicon.ico': ['favicon.ico', 'image/x-icon'],
        '/favicon-16.png': ['favicon-16.png', 'image/png'],
        '/favicon-32.png': ['favicon-32.png', 'image/png'],
        '/apple-touch-icon.png': ['favicon-180.png', 'image/png'],
        '/install.sh': ['install.sh', 'text/x-shellscript; charset=utf-8'],
        '/download/forge3d-cloud.mcpb': ['forge3d-cloud.mcpb', 'application/octet-stream'],
      };
      const hit = STATIC[url.pathname];
      if (hit) {
        try {
          const buf = fs.readFileSync(path.join(dir, 'public', hit[0]));
          const headers = { 'content-type': hit[1], ...CORS };
          if (hit[1] === 'application/octet-stream') headers['content-disposition'] = 'attachment; filename="forge3d-cloud.mcpb"';
          res.writeHead(200, headers);
          return res.end(buf);
        } catch { return sendJson(res, 404, { error: 'not found' }); }
      }
      // installer downloads
      if (url.pathname === '/download/mac' || url.pathname === '/download/windows') {
        // macOS: serve the locally-hosted, Apple-signed + notarized .dmg directly.
        if (url.pathname.endsWith('mac')) {
          try {
            const buf = fs.readFileSync(path.join(dir, 'public', 'download', 'Forge3D-arm64.dmg'));
            res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="Forge3D-arm64.dmg"', ...CORS });
            return res.end(buf);
          } catch { /* fall through to the GitHub redirect below */ }
        }
        // Windows (or a mac fallback): 302 to the newest GitHub release asset.
        const re = url.pathname.endsWith('mac') ? /arm64\.dmg$/ : /\.exe$/i;
        const target = await latestAssetUrl(re).catch(() => 'https://github.com/RewardGuard/Forge3D/releases/latest');
        res.writeHead(302, { location: target, ...CORS });
        return res.end();
      }
    }

    // ---- OAuth discovery (only when an issuer is configured) ----
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      if (!ISSUER) return sendJson(res, 404, { error: 'oauth not configured' });
      return sendJson(res, 200, { resource: PUBLIC_URL, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
    }

    // ---- desktop relay (the live app dials in here) ----
    if (url.pathname === '/relay/next' && req.method === 'GET') {
      const owner = pairOwner(req); if (!owner) return sendJson(res, 401, { error: 'bad pairing token' });
      const call = await nextCall(owner);
      return call ? sendJson(res, 200, call) : sendJson(res, 204, {});
    }
    if (url.pathname === '/relay/result' && req.method === 'POST') {
      const owner = pairOwner(req); if (!owner) return sendJson(res, 401, { error: 'bad pairing token' });
      const { callId, result } = JSON.parse((await readBody(req)) || '{}');
      return sendJson(res, 200, { delivered: submitResult(owner, callId, result) });
    }
    if (url.pathname === '/relay/hello' && req.method === 'POST') {
      const owner = pairOwner(req); if (!owner) return sendJson(res, 401, { error: 'bad pairing token' });
      markSeen(owner); return sendJson(res, 200, { ok: true, owner });
    }

    // ---- F3D Storage — HOST side. Only the operator's machine (the one with the
    // F3D_STORAGE drives) may register here and serve everyone's files. ----
    if (url.pathname === '/storage/relay/hello' && req.method === 'POST') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.isHost) return sendJson(res, 403, { error: 'this account is not the F3D Storage host', code: 'not_host' });
      // Right account is not enough — prove it's the pinned MACHINE.
      const proof = verifyHostProof(JSON.parse((await readBody(req)) || '{}'));
      if (!proof.ok) {
        console.error(`[f3d-storage] host registration REFUSED: ${proof.reason}`);
        return sendJson(res, 403, { error: `F3D Storage can only be hosted from the pinned machine (${proof.reason}).`, code: 'not_host_machine' });
      }
      markSeen(acc.owner);
      return sendJson(res, 200, { ok: true, host: acc.email, firstPin: Boolean(proof.firstPin), session: newHostSession() });
    }
    if (url.pathname === '/storage/relay/next' && req.method === 'GET') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.isHost) return sendJson(res, 403, { error: 'not the storage host', code: 'not_host' });
      // account alone is not enough here either — require the session minted by a
      // machine-verified /hello, so a stolen token can't poll the relay directly
      if (!validHostSession(req)) return sendJson(res, 403, { error: 're-register from the pinned host machine', code: 'host_session_required' });
      const call = await nextCall(acc.owner);
      return call ? sendJson(res, 200, call) : sendJson(res, 204, {});
    }
    if (url.pathname === '/storage/relay/result' && req.method === 'POST') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.isHost || !validHostSession(req)) return sendJson(res, 403, { error: 'not the pinned host machine', code: 'host_session_required' });
      const { callId, result } = JSON.parse((await readBody(req)) || '{}');
      return sendJson(res, 200, { delivered: submitResult(acc.owner, callId, result) });
    }

    // ---- F3D Storage — CUSTOMER side (their app, or the web UI on any device).
    // Every request is relayed to the single host; `customer` is taken from the
    // VERIFIED account token, never from the request body, so one customer can
    // never address another's folder. ----
    const HOST_DOWN = { error: 'F3D Storage is temporarily offline — the storage host is not connected. Your files are safe.', code: 'host_offline' };
    if (url.pathname === '/storage/online' && req.method === 'GET') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.entitled) return sendJson(res, 402, { error: 'F3D Storage needs the $3/mo plan', code: 'upgrade_required' });
      return sendJson(res, 200, { online: isOnline(acc.owner) });
    }
    if (url.pathname === '/storage/list' && req.method === 'GET') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.entitled) return sendJson(res, 402, { error: 'F3D Storage needs the $3/mo plan', code: 'upgrade_required' });
      if (!isOnline(acc.owner)) return sendJson(res, 503, HOST_DOWN);
      try { return sendJson(res, 200, await relayCall(acc.owner, 'storage_list', { customer: acc.email }, 20000)); }
      catch (e) { return sendJson(res, 504, { error: String(e?.message || e) }); }
    }
    if (url.pathname.startsWith('/storage/file/') && req.method === 'GET') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.entitled) return sendJson(res, 402, { error: 'upgrade required', code: 'upgrade_required' });
      if (!isOnline(acc.owner)) return sendJson(res, 503, HOST_DOWN);
      const name = decodeURIComponent(url.pathname.slice('/storage/file/'.length));
      try {
        const out = await relayCall(acc.owner, 'storage_get', { name, customer: acc.email }, 30000);
        if (!out?.ok) return sendJson(res, 404, { error: out?.error || 'not found' });
        const buf = Buffer.from(out.result.content_base64, 'base64');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${out.result.name.replace(/"/g, '')}"`, 'content-length': buf.length, ...CORS });
        return res.end(buf);
      } catch (e) { return sendJson(res, 504, { error: String(e?.message || e) }); }
    }
    if (url.pathname.startsWith('/storage/file/') && req.method === 'POST') {
      const acc = await storageAuth(req);
      if (!acc) return sendJson(res, 401, { error: 'sign in required' });
      if (!acc.entitled) return sendJson(res, 402, { error: 'upgrade required', code: 'upgrade_required' });
      if (!isOnline(acc.owner)) return sendJson(res, 503, HOST_DOWN);
      const name = decodeURIComponent(url.pathname.slice('/storage/file/'.length));
      try {
        const raw = await readBodyBuffer(req);
        const out = await relayCall(acc.owner, 'storage_put', { name, content_base64: raw.toString('base64'), customer: acc.email }, 30000);
        return sendJson(res, out?.ok ? 200 : 500, out);
      } catch (e) { return sendJson(res, 504, { error: String(e?.message || e) }); }
    }
    // Operator-only: total capacity across the F3D_STORAGE drives.
    if (url.pathname === '/storage/capacity' && req.method === 'GET') {
      const acc = await storageAuth(req);
      if (!acc?.isHost) return sendJson(res, 403, { error: 'operator only' });
      if (!isOnline(acc.owner)) return sendJson(res, 503, HOST_DOWN);
      try { return sendJson(res, 200, await relayCall(acc.owner, 'storage_capacity', {}, 20000)); }
      catch (e) { return sendJson(res, 504, { error: String(e?.message || e) }); }
    }

    // ---- MCP (Claude connects here) ----
    if (url.pathname === '/mcp') {
      if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: `rate limit — max ${RL_MAX}/min, slow down a moment` });
      const owner = await authOwner(req);
      if (!owner) { res.writeHead(401, { 'www-authenticate': ISSUER ? `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"` : 'Bearer', ...CORS }); return res.end(JSON.stringify({ error: 'unauthorized' })); }
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : undefined;
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = makeServer(owner);
      res.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      return transport.handleRequest(req, res, body);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  const mode = OAUTH_ON ? `oauth(${ISSUER})` : process.env.FORGE3D_API_TOKEN ? 'token' : 'open';
  console.error(`Forge3D Cloud MCP on :${PORT}  (auth=${mode}, pairing=${process.env.FORGE3D_PAIR_TOKEN ? 'on' : 'off'})`);
});
