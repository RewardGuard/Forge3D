// Forge3D Cloud proxy — holds the AI provider keys SERVER-SIDE so app users can
// use the "base model" without their own key. Zero dependencies (Node 18+).
//
// Keys live in a local .env (NEVER committed). Configure at least one provider.
// Start:  node index.mjs   (or via systemd — see DEPLOY.md)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- load .env (KEY=VALUE lines) ----
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — rely on real env vars */ }

const PORT = Number(process.env.PORT) || 8787;

// OpenAI-compatible providers, tried in priority order (first with a key wins).
const PROVIDERS = [
  { id: 'glm',        env: 'GLM_KEY',        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  { id: 'groq',       env: 'GROQ_KEY',       url: 'https://api.groq.com/openai/v1/chat/completions',       model: 'llama-3.3-70b-versatile' },
  { id: 'gemini',     env: 'GEMINI_KEY',     url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
  { id: 'mistral',    env: 'MISTRAL_KEY',    url: 'https://api.mistral.ai/v1/chat/completions',            model: 'codestral-latest' },
  { id: 'openrouter', env: 'OPENROUTER_KEY', url: 'https://openrouter.ai/api/v1/chat/completions',         model: 'meta-llama/llama-3.3-70b-instruct:free', extra: { 'HTTP-Referer': 'https://forge3d.app', 'X-Title': 'Forge3D' } },
];
const activeProvider = () => PROVIDERS.find((p) => process.env[p.env]);

// ---- tiny per-IP rate limit (protects the shared keys from abuse) ----
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.RATE_PER_MIN) || 20;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return arr.length > MAX_PER_WINDOW;
}

function stripFences(t) {
  return String(t || '').replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') {
    const p = activeProvider();
    return send(res, 200, { ok: true, provider: p ? p.id : null, configured: Boolean(p) });
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat') return send(res, 404, { error: 'not found' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return send(res, 429, { error: 'Rate limit — slow down a moment.' });

  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
    const provider = activeProvider();
    if (!provider) return send(res, 503, { error: 'No provider key configured on the server.' });
    try {
      const r = await fetch(provider.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env[provider.env]}`, 'content-type': 'application/json', ...(provider.extra || {}) },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: Math.min(8000, Number(body.maxTokens) || 2000),
          temperature: 0.3,
          messages: [
            { role: 'system', content: String(body.system || 'You are a helpful assistant.') },
            { role: 'user', content: String(body.user || '') },
          ],
        }),
      });
      const data = await r.json();
      if (!r.ok) return send(res, 502, { error: data?.error?.message || `${provider.id} error ${r.status}` });
      send(res, 200, { text: stripFences(data?.choices?.[0]?.message?.content || ''), provider: provider.id });
    } catch (e) {
      send(res, 502, { error: String(e?.message || e) });
    }
  });
});

server.listen(PORT, () => console.log(`Forge3D proxy on :${PORT} — provider: ${activeProvider()?.id || 'NONE (set a *_KEY in .env)'}`));
