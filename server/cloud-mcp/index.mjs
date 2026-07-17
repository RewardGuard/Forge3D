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
        '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
        '/terms': ['terms.html', 'text/html; charset=utf-8'],
        '/logo.png': ['logo.png', 'image/png'],
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
      // installer downloads → 302 to the newest GitHub release asset (fallback: releases page)
      if (url.pathname === '/download/mac' || url.pathname === '/download/windows') {
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
