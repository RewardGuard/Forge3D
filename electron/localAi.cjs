// Local AI abstraction — point 9 of the spec.
//
// Every local model server worth running speaks the OpenAI /v1 API: LM
// Studio, Ollama, llama.cpp's server, vLLM, Jan, GPT4All. So Forge3D has ONE
// adapter, and "connect a different model" means pointing it at a different
// URL — no rewrite. This module is pure Node (no Electron) so it can be
// tested against a mock server, which is how it was verified.
//
// A local model is still a model: its output goes through the same validated
// CAD operations as a cloud model's. Nothing here touches app state.

const CANDIDATES = [
  { id: 'lmstudio', name: 'LM Studio', url: 'http://localhost:1234/v1' },
  { id: 'ollama',   name: 'Ollama',    url: 'http://localhost:11434/v1' },
  { id: 'llamacpp', name: 'llama.cpp', url: 'http://localhost:8080/v1' },
];

const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

/** GET /models with a short timeout. Never generates. */
async function probe(base, { timeoutMs = 2500, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${clean(base)}/models`, { signal: ac.signal });
    if (!res.ok) return { up: false, status: res.status };
    const data = await res.json().catch(() => ({}));
    const models = (data?.data || []).map((m) => m?.id).filter(Boolean);
    return { up: true, models };
  } catch (e) {
    return { up: false, error: String(e?.message || e).slice(0, 80) };
  } finally { clearTimeout(t); }
}

/** Probe the known servers plus a custom URL, in parallel. */
async function discover({ customUrl = null, fetchImpl = fetch } = {}) {
  const list = [...CANDIDATES];
  const c = clean(customUrl);
  if (c && !list.some((x) => x.url === c)) list.push({ id: 'custom', name: 'Custom endpoint', url: c });
  const results = await Promise.all(list.map(async (s) => ({ ...s, ...(await probe(s.url, { fetchImpl })) })));
  return { servers: results, anyUp: results.some((r) => r.up) };
}

/**
 * One chat completion against a local server. Resolves the model if none is
 * configured (first loaded), and turns the failure modes into messages that
 * tell the user what to do rather than a bare ECONNREFUSED.
 */
async function chat({ base, model, system, user, maxTokens = 1200, temperature = 0.3, fetchImpl = fetch }) {
  const b = clean(base) || CANDIDATES[0].url;
  let m = model;
  if (!m) {
    const p = await probe(b, { fetchImpl });
    if (!p.up) throw new Error(`Local AI at ${b} is not responding${p.error ? ` (${p.error})` : p.status ? ` (HTTP ${p.status})` : ''}. Start LM Studio or Ollama, or switch AI mode to Cloud.`);
    m = p.models[0];
    if (!m) throw new Error(`Local AI at ${b} is running but has no model loaded. Load one in LM Studio / pull one in Ollama.`);
  }
  const res = await fetchImpl(`${b}/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
    body: JSON.stringify({ model: m, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Local AI ${b} returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  const text = data?.choices?.[0]?.message?.content ?? '';
  return { text, model: data?.model || m, usage: data?.usage || null };
}

module.exports = { CANDIDATES, probe, discover, chat, clean };
