// Proof of the local-AI adapter against a mock OpenAI-compatible server —
// the same /v1/models and /v1/chat/completions LM Studio and Ollama serve.
// `npm run test:local-ai`
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../electron/localAi.cjs');

const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ${C.g}✓${C.x} ${name}`); pass++; }
  catch (e) { console.log(`  ${C.r}✗${C.x} ${name}\n     ${C.d}${e.message}${C.x}`); fail++; }
};

// a mock "LM Studio"
let received = null;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c);
  req.on('end', () => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder-7b' }, { id: 'llama-3.2-3b' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      received = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: received.model, choices: [{ message: { role: 'assistant', content: `echo:${received.messages[1].content}` } }], usage: { total_tokens: 42 } }));
      return;
    }
    res.statusCode = 404; res.end('nope');
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${mock.address().port}/v1`;
const dead = 'http://127.0.0.1:1/v1';

console.log(`\n${C.b}LOCAL AI ADAPTER${C.x} — mock server at ${base}\n`);

await check('probe reports a live server and its loaded models', async () => {
  const p = await L.probe(base);
  assert.ok(p.up); assert.deepEqual(p.models, ['qwen2.5-coder-7b', 'llama-3.2-3b']);
});

await check('probe reports a dead server without throwing, fast', async () => {
  const t0 = performance.now();
  const p = await L.probe(dead, { timeoutMs: 800 });
  assert.equal(p.up, false); assert.ok(p.error);
  assert.ok(performance.now() - t0 < 1500, 'must not hang');
});

await check('discover probes the known servers plus a custom one in parallel', async () => {
  const t0 = performance.now();
  const d = await L.discover({ customUrl: base });
  assert.ok(d.servers.some((s) => s.id === 'custom' && s.up), 'custom endpoint found');
  assert.ok(d.servers.some((s) => s.id === 'lmstudio'), 'known candidates listed');
  assert.ok(performance.now() - t0 < 4000, 'parallel, not serial');
  assert.equal(d.anyUp, true);
});

await check('chat with no model configured picks the first loaded one', async () => {
  const r = await L.chat({ base, model: '', system: 'sys', user: 'hello' });
  assert.equal(r.model, 'qwen2.5-coder-7b');
  assert.equal(r.text, 'echo:hello');
  assert.equal(received.messages[0].content, 'sys');
});

await check('chat with an explicit model sends exactly that model', async () => {
  await L.chat({ base, model: 'llama-3.2-3b', system: 's', user: 'u', maxTokens: 77 });
  assert.equal(received.model, 'llama-3.2-3b'); assert.equal(received.max_tokens, 77);
});

await check('a down server yields an actionable message, not ECONNREFUSED', async () => {
  await assert.rejects(() => L.chat({ base: dead, model: '', system: 's', user: 'u' }), (e) => /Start LM Studio or Ollama|switch AI mode/i.test(e.message));
});

await check('a server with no model loaded says so', async () => {
  const empty = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [] })); });
  await new Promise((r) => empty.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${empty.address().port}/v1`;
  await assert.rejects(() => L.chat({ base: b2, model: '', system: 's', user: 'u' }), /no model loaded/i);
  empty.close();
});

await check('trailing slashes and whitespace in the URL are tolerated', async () => {
  const r = await L.chat({ base: `  ${base}///  `, model: 'llama-3.2-3b', system: 's', user: 'x' });
  assert.equal(r.text, 'echo:x');
});

await check('a 5xx from the server surfaces the status and body', async () => {
  const bad = http.createServer((req, res) => { if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'm' }] })); return; } res.statusCode = 500; res.end('out of memory'); });
  await new Promise((r) => bad.listen(0, '127.0.0.1', r));
  const b3 = `http://127.0.0.1:${bad.address().port}/v1`;
  await assert.rejects(() => L.chat({ base: b3, model: '', system: 's', user: 'u' }), /500.*out of memory/);
  bad.close();
});

mock.close();
console.log('');
if (fail) { console.log(`${C.r}${C.b}${fail} FAILED${C.x}, ${pass} passed\n`); process.exit(1); }
console.log(`${C.g}${C.b}${pass} passed, 0 failed${C.x} — one adapter serves every OpenAI-compatible local server.\n`);
