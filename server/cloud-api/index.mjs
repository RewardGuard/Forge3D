// ============================================================================
// Forge3D Cloud — accounts, metering and billing for the shared AI proxy.
//
// Replaces the anonymous proxy: using F3D Cloud now requires a (free) account.
//   • Free plan   — 5,000 tokens/month across ANY cloud AI.
//   • Pro plan    — $5/month (Stripe subscription): all cloud AIs, generous cap.
//   • Or skip the cloud entirely by entering your own API keys in the app.
//
// Zero npm dependencies (Node 18+): hand-rolled HS256 JWT, scrypt passwords,
// Stripe via raw REST + manual webhook signature verification, and an atomic
// JSON file store (single process; tmp+rename writes).
//
// Endpoints:
//   GET  /health              → { ok, providers, billing }
//   POST /auth/signup         { email, password } → { token, account }
//   POST /auth/login          { email, password } → { token, account }
//   GET  /me                  (auth) → { email, plan, usage, billing }
//   POST /v1/chat             (auth) { system, user, maxTokens, provider? }
//   POST /billing/checkout    (auth) → { url }   Stripe Checkout ($5/mo)
//   POST /billing/portal      (auth) → { url }   Stripe customer portal
//   POST /billing/webhook     Stripe events (signature-verified)
//   GET  /billing/done        tiny thank-you page after checkout
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- .env (KEY=VALUE lines) ----
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* rely on real env vars */ }

const PORT = Number(process.env.PORT) || 8787;
const FREE_TOKENS = Number(process.env.FREE_TOKENS) || 5000;        // per month, free plan
const PRO_TOKENS = Number(process.env.PRO_TOKENS) || 2_000_000;     // per month courtesy cap, pro plan
const PRICE_USD = process.env.PRICE_USD || '5';

// JWT secret: env, else generated once and persisted next to the code.
const SECRET_FILE = path.join(__dirname, '.jwt-secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  try { JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf-8').trim(); } catch { /* generate below */ }
  if (!JWT_SECRET) {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, JWT_SECRET, { mode: 0o600 });
  }
}

// ---- cloud AI providers (server-held keys) ----
const PROVIDERS = [
  { id: 'claude',     env: 'ANTHROPIC_KEY',  kind: 'anthropic', model: process.env.CLAUDE_MODEL || 'claude-sonnet-5' },
  { id: 'glm',        env: 'GLM_KEY',        kind: 'openai', url: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-4.5-flash' },
  { id: 'groq',       env: 'GROQ_KEY',       kind: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' },
  { id: 'gemini',     env: 'GEMINI_KEY',     kind: 'openai', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
  { id: 'mistral',    env: 'MISTRAL_KEY',    kind: 'openai', url: 'https://api.mistral.ai/v1/chat/completions', model: 'codestral-latest' },
  { id: 'openrouter', env: 'OPENROUTER_KEY', kind: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free', extra: { 'HTTP-Referer': 'https://forge3d.app', 'X-Title': 'Forge3D' } },
];
const available = () => PROVIDERS.filter((p) => process.env[p.env]);
const pickProvider = (id) => (id ? available().find((p) => p.id === id) : available()[0]);

// ---- atomic JSON store ----
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'data.json');
let db = { accounts: {}, usage: {} }; // accounts[email] = {...}; usage[`${email}|${YYYY-MM}`] = tokens
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch { /* fresh */ }
function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
const period = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const usageOf = (email) => db.usage[`${email}|${period()}`] || 0;
function addUsage(email, tokens) {
  const k = `${email}|${period()}`;
  db.usage[k] = (db.usage[k] || 0) + Math.max(0, Math.round(tokens));
  saveDB();
}
const limitOf = (acct) => (acct.plan === 'pro' ? PRO_TOKENS : FREE_TOKENS);

// ---- passwords (scrypt) + JWT (HS256, no deps) ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}
function checkPassword(password, salt, hash) {
  const got = crypto.scryptSync(password, salt, 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function signToken(email) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ sub: email, exp: Math.floor(Date.now() / 1000) + 90 * 86400 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp < Date.now() / 1000) return null;
    return db.accounts[payload.sub] ? payload.sub : null;
  } catch { return null; }
}
const authOf = (req) => verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));

// ---- Stripe via raw REST (form-encoded) ----
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WHSEC = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE = process.env.STRIPE_PRICE_ID || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://18.222.194.21:${PORT}`).replace(/\/$/, '');
const billingConfigured = () => Boolean(STRIPE_KEY && STRIPE_PRICE);

async function stripe(pathname, params) {
  const body = new URLSearchParams();
  const flat = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === 'object') flat(v, key);
      else body.append(key, String(v));
    }
  };
  flat(params);
  const res = await fetch(`https://api.stripe.com${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${STRIPE_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

function verifyStripeSig(rawBody, header) {
  if (!STRIPE_WHSEC || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false; // 5 min tolerance
  const expected = crypto.createHmac('sha256', STRIPE_WHSEC).update(`${parts.t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- provider calls ----
function stripFences(t) {
  return String(t || '').replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
}
const estimate = (s) => Math.ceil(String(s || '').length / 4);

async function callProvider(p, { system, user, maxTokens }) {
  if (process.env.MOCK_UPSTREAM === '1') { // local test mode — no real AI spend
    return { text: `mock(${p.id}): ok`, tokens: Number(process.env.MOCK_TOKENS) || 2000 };
  }
  if (p.kind === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env[p.env], 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: p.model, max_tokens: Math.min(Number(maxTokens) || 2000, 4000),
        system: system || undefined, messages: [{ role: 'user', content: String(user || '') }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `claude error ${res.status}`);
    const text = stripFences((data.content || []).map((c) => c.text || '').join(''));
    const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0) || estimate(system) + estimate(user) + estimate(text);
    return { text, tokens };
  }
  // OpenAI-compatible
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env[p.env]}`, 'content-type': 'application/json', ...(p.extra || {}) },
    body: JSON.stringify({
      model: p.model, max_tokens: Math.min(Number(maxTokens) || 2000, 4000), temperature: 0.4,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: String(user || '') }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `${p.id} error ${res.status}`);
  const text = stripFences(data.choices?.[0]?.message?.content);
  const tokens = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0) || estimate(system) + estimate(user) + estimate(text);
  return { text, tokens };
}

// ---- per-IP rate limit (protects shared keys + auth endpoints) ----
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.RATE_PER_MIN) || 30;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return arr.length > MAX_PER_WINDOW;
}

// ---- http plumbing ----
function send(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}
const meOf = (email) => {
  const a = db.accounts[email];
  return {
    email, plan: a.plan || 'free',
    usage: { used: usageOf(email), limit: limitOf(a), period: period() },
    billing: { configured: billingConfigured(), subscriptionStatus: a.subStatus || null },
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '?';
  const url = new URL(req.url, 'http://x');

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, providers: available().map((p) => p.id), billing: billingConfigured(), accounts: true, provider: available()[0]?.id || null, configured: available().length > 0 });
    }

    if (req.method === 'GET' && url.pathname === '/billing/done') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<html><body style="font-family:system-ui;background:#0e1116;color:#d7dee8;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h1>✦ You are Pro now</h1><p>All F3D Cloud AIs are unlocked. Head back to Forge3D — no restart needed.</p></div></body></html>');
    }

    // ---- Stripe webhook (raw body BEFORE json parse; signature-verified) ----
    if (req.method === 'POST' && url.pathname === '/billing/webhook') {
      const raw = await readBody(req, 1024 * 1024);
      if (!verifyStripeSig(raw, req.headers['stripe-signature'])) return send(res, 400, { error: 'bad signature' });
      const event = JSON.parse(raw);
      const obj = event.data?.object || {};
      if (event.type === 'checkout.session.completed') {
        const email = obj.client_reference_id || obj.customer_details?.email;
        const a = db.accounts[email];
        if (a) { a.plan = 'pro'; a.stripeCustomer = obj.customer; a.stripeSub = obj.subscription; a.subStatus = 'active'; saveDB(); }
      } else if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
        const active = obj.status === 'active' || obj.status === 'trialing';
        const email = Object.keys(db.accounts).find((e) => db.accounts[e].stripeCustomer === obj.customer);
        if (email) { db.accounts[email].plan = active ? 'pro' : 'free'; db.accounts[email].subStatus = obj.status; saveDB(); }
      }
      return send(res, 200, { received: true });
    }

    if (rateLimited(ip)) return send(res, 429, { error: 'Rate limit exceeded — try again in a minute.' });

    const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};

    // ---- auth ----
    if (req.method === 'POST' && url.pathname === '/auth/signup') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
      if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      if (db.accounts[email]) return send(res, 409, { error: 'That email already has an account — sign in instead.' });
      const { salt, hash } = hashPassword(password);
      db.accounts[email] = { salt, hash, plan: 'free', createdAt: Date.now() };
      saveDB();
      return send(res, 200, { token: signToken(email), account: meOf(email) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const email = String(body.email || '').trim().toLowerCase();
      const a = db.accounts[email];
      if (!a || !checkPassword(String(body.password || ''), a.salt, a.hash)) return send(res, 401, { error: 'Wrong email or password.' });
      return send(res, 200, { token: signToken(email), account: meOf(email) });
    }

    // ---- everything below needs an account ----
    const email = authOf(req);
    if (!email) return send(res, 401, { error: 'F3D Cloud needs a free account now — create one in Forge3D Settings (or use your own API keys).', code: 'auth_required' });

    if (req.method === 'GET' && url.pathname === '/me') return send(res, 200, meOf(email));

    if (req.method === 'POST' && url.pathname === '/billing/checkout') {
      if (!billingConfigured()) return send(res, 503, { error: 'Billing is not configured on the server yet.' });
      const session = await stripe('/v1/checkout/sessions', {
        mode: 'subscription',
        'line_items[0][price]': STRIPE_PRICE,
        'line_items[0][quantity]': 1,
        client_reference_id: email,
        customer_email: email,
        success_url: `${PUBLIC_URL}/billing/done`,
        cancel_url: `${PUBLIC_URL}/billing/done`,
      });
      return send(res, 200, { url: session.url });
    }
    if (req.method === 'POST' && url.pathname === '/billing/portal') {
      const a = db.accounts[email];
      if (!billingConfigured() || !a.stripeCustomer) return send(res, 503, { error: 'No subscription to manage yet.' });
      const session = await stripe('/v1/billing_portal/sessions', { customer: a.stripeCustomer, return_url: `${PUBLIC_URL}/billing/done` });
      return send(res, 200, { url: session.url });
    }

    // ---- metered chat ----
    if (req.method === 'POST' && url.pathname === '/v1/chat') {
      const a = db.accounts[email];
      const used = usageOf(email), limit = limitOf(a);
      if (used >= limit) {
        return send(res, 402, {
          error: a.plan === 'pro'
            ? `You hit this month's fair-use cap (${limit.toLocaleString()} tokens). It resets on the 1st.`
            : `You used your ${FREE_TOKENS.toLocaleString()} free tokens this month. Upgrade to Pro ($${PRICE_USD}/month) for all F3D Cloud AIs, or add your own API key in Settings.`,
          code: 'upgrade_required', used, limit,
        });
      }
      const p = pickProvider(body.provider);
      if (!p) return send(res, 503, { error: body.provider ? `Provider "${body.provider}" is not available on F3D Cloud.` : 'No cloud provider configured.' });
      const t0 = Date.now();
      const { text, tokens } = await callProvider(p, { system: body.system, user: body.user, maxTokens: body.maxTokens });
      addUsage(email, tokens);
      console.log(`[chat] ${p.id} ${tokens}tok ${Date.now() - t0}ms plan=${a.plan}`);
      return send(res, 200, { text, provider: p.id, model: p.model, tokens, usage: { used: usageOf(email), limit } });
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`[f3d-cloud] accounts+billing proxy on :${PORT} — providers: ${available().map((p) => p.id).join(', ') || 'NONE'} — billing: ${billingConfigured() ? 'on' : 'off'}`);
});
