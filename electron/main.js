import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { measureSTL } from './stlMeasure.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development';

// The live app window — the control bridge needs it to reach the renderer.
let mainWindow = null;
const BRIDGE_PORT = Number(process.env.FORGE3D_BRIDGE_PORT) || 8765;

// ---- Config (Meshy API key) stored in userData, never bundled ----
function configPath() {
  return path.join(app.getPath('userData'), 'forge3d.config.json');
}
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0e1116',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // CRITICAL for MCP-driven use: when Claude drives Forge3D, this window
      // sits BEHIND Claude's — Chromium normally pauses rAF for occluded
      // windows, which froze the 3D canvas (and thus every screenshot/look
      // capture) for the whole session. Keep rendering in the background.
      backgroundThrottling: false,
    },
  });

  // Trackpad gestures must never zoom the page or navigate history —
  // otherwise a two-finger scroll on a canvas can blank the whole window.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    win.webContents.setZoomFactor(1);
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('swipe', (e) => e.preventDefault());

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
}

// ============================================================================
// Control bridge — lets the Claude MCP plugin (server/orchestra-mcp) drive the
// live app. A localhost-only HTTP server receives { name, args } and runs it
// through the renderer's window.__orchestraRunTool (src/lib/orchestraBridge.js),
// which is the same execution point the in-app Orchestra director uses.
//
// Security: bound to 127.0.0.1, OFF by default behind an explicit Settings
// toggle, and optionally gated by a shared bearer token (cfg.bridgeToken). See
// server/orchestra-mcp/BRIDGE.md.
// ============================================================================
let bridgeServer = null;

function bridgeStatus() {
  return { running: Boolean(bridgeServer && bridgeServer.listening), port: BRIDGE_PORT };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 8 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Ask the renderer to execute one tool and wait for its JSON result. The payload
// is passed as a single JSON string so we never interpolate raw values into the
// evaluated source; \u2028/\u2029 are escaped because they're legal in JSON but
// terminate a JS string literal.
async function runToolInRenderer(name, args) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
    return { ok: false, error: 'Forge3D window is not open.' };
  }
  const payload = JSON.stringify({ name, args: args || {} })
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const expr = `window.__orchestraRunTool && window.__orchestraRunTool(${JSON.stringify(payload)})`;
  const out = await mainWindow.webContents.executeJavaScript(expr, true);
  if (out == null) return { ok: false, error: 'bridge not registered in renderer yet (app still loading?)' };
  return out;
}

function startBridge() {
  if (bridgeServer) return bridgeStatus();
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
        return send(200, { ok: true, app: 'forge3d', version: app.getVersion(), tokenRequired: Boolean(readConfig().bridgeToken) });
      }
      if (req.method !== 'POST' || req.url !== '/tool') return send(404, { ok: false, error: 'not found' });

      const token = readConfig().bridgeToken;
      if (token) {
        const auth = req.headers['authorization'] || '';
        const got = auth.replace(/^Bearer\s+/i, '');
        if (got !== token) return send(401, { ok: false, error: 'unauthorized — bad or missing bridge token' });
      }

      const body = await readBody(req);
      const { name, args } = JSON.parse(body || '{}');
      if (!name) return send(400, { ok: false, error: 'missing tool name' });
      const out = await runToolInRenderer(name, args);
      return send(200, out);
    } catch (e) {
      return send(500, { ok: false, error: String(e?.message || e) });
    }
  });
  server.on('error', (e) => {
    console.error('[bridge] listen error:', e?.message || e);
    bridgeServer = null;
  });
  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.error(`[bridge] Forge3D control bridge on http://127.0.0.1:${BRIDGE_PORT}`);
  });
  bridgeServer = server;
  return bridgeStatus();
}

function stopBridge() {
  if (bridgeServer) { try { bridgeServer.close(); } catch {} bridgeServer = null; }
  return bridgeStatus();
}

// ============================================================================
// Cloud pairing — dial OUT to the Forge3D Cloud relay so the remote directory
// connector (server/cloud-mcp) can drive THIS live app. Outbound long-poll only,
// so no inbound port / firewall change is needed. Off by default; opt in from
// Settings → Forge3D Cloud. Tool calls run through the same runToolInRenderer
// path the local bridge uses.
// ============================================================================
let cloudPair = { running: false, abort: false, status: 'off' };
const cloudPairStatus = () => ({ running: cloudPair.running, status: cloudPair.status });

async function cloudPairLoop() {
  const cfg = readConfig();
  const base = (cfg.cloudPairUrl || '').replace(/\/$/, '');
  const token = cfg.cloudPairToken || '';
  if (!base || !token) { cloudPair.status = 'misconfigured'; cloudPair.running = false; return; }
  cloudPair.running = true; cloudPair.abort = false; cloudPair.status = 'connecting';
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
  try { await post('/relay/hello', {}); cloudPair.status = 'online'; } catch { cloudPair.status = 'unreachable'; }
  while (!cloudPair.abort) {
    let call = null;
    try {
      const r = await fetch(`${base}/relay/next?token=${encodeURIComponent(token)}`);
      if (r.status === 401) { cloudPair.status = 'unauthorized'; break; }
      if (r.status === 204) { cloudPair.status = 'online'; continue; }
      if (!r.ok) { cloudPair.status = `error ${r.status}`; await sleep(2000); continue; }
      call = await r.json();
    } catch { cloudPair.status = 'unreachable'; await sleep(2000); continue; }
    cloudPair.status = 'online';
    let result;
    try { result = await runToolInRenderer(call.name, call.args); }
    catch (e) { result = { ok: false, error: String(e?.message || e) }; }
    try { await post('/relay/result', { callId: call.callId, result }); } catch {}
  }
  cloudPair.running = false;
  if (cloudPair.status !== 'unauthorized') cloudPair.status = 'off';
}
function startCloudPairing() { if (!cloudPair.running) cloudPairLoop(); return cloudPairStatus(); }
function stopCloudPairing() { cloudPair.abort = true; cloudPair.running = false; cloudPair.status = 'off'; return cloudPairStatus(); }

// ---- IPC: config ----
ipcMain.handle('config:get', () => {
  const cfg = readConfig();
  return {
    hasMeshyKey: Boolean(cfg.meshyApiKey),
    hasHfToken: Boolean(cfg.hfToken),
    hasThingiverseToken: Boolean(cfg.thingiverseToken),
    hasAnthropicKey: Boolean(cfg.anthropicKey),
    hasGeminiKey: Boolean(cfg.geminiKey),
    hasGroqKey: Boolean(cfg.groqKey),
    hasMistralKey: Boolean(cfg.mistralKey),
    hasOpenrouterKey: Boolean(cfg.openrouterKey),
    hasGlmKey: Boolean(cfg.glmKey),
    provider: cfg.provider || 'mock',
    codeProvider: cfg.codeProvider || (cfg.anthropicKey ? 'anthropic' : 'mock'),
    circuitProvider: cfg.circuitProvider || cfg.codeProvider || (cfg.anthropicKey ? 'anthropic' : 'mock'),
    orchestraDirector: cfg.orchestraDirector || 'base',
    orchestraVision: cfg.orchestraVision || 'hf-glm45v',
    orchestraHeadroom: cfg.orchestraHeadroom || 'balanced',
    // ---- Claude control bridge ----
    bridgeEnabled: Boolean(cfg.bridgeEnabled),
    bridgePort: BRIDGE_PORT,
    bridgeRunning: bridgeStatus().running,
    hasBridgeToken: Boolean(cfg.bridgeToken),
    bridgeToken: cfg.bridgeToken || '', // localhost-only; shown so it can be pasted into the MCP config
    bridgeServerPath: path.join(__dirname, '..', 'server', 'orchestra-mcp', 'index.mjs'), // for the copy-paste MCP snippet
    // ---- Forge3D Cloud pairing (drive this live app from the remote connector) ----
    cloudPairEnabled: Boolean(cfg.cloudPairEnabled),
    cloudPairUrl: cfg.cloudPairUrl || '',
    hasCloudPairToken: Boolean(cfg.cloudPairToken),
    cloudPairStatus: cloudPairStatus().status,
    // ---- F3D Cloud account (free 5k tokens/month, or Pro $5/month) ----
    hasAccount: Boolean(cfg.accountToken),
    accountEmail: cfg.accountEmail || '',
    cloudAi: cfg.cloudAi || 'glm', // which cloud AI 'base' uses (glm free-tier default)
    // ---- first-run onboarding flags ----
    onboarded: Boolean(cfg.onboarded),
    tutorialSeen: Boolean(cfg.tutorialSeen),
    authSkipped: Boolean(cfg.authSkipped),
  };
});

// ---- F3D Cloud account: signup / login / usage / billing ----
async function cloudApi(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${PROXY_URL}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `F3D Cloud error ${res.status}`);
  return data;
}
ipcMain.handle('account:signup', async (_e, { email, password } = {}) => {
  const data = await cloudApi('/auth/signup', { method: 'POST', body: { email, password } });
  const cfg = readConfig();
  cfg.accountToken = data.token; cfg.accountEmail = data.account?.email || email;
  writeConfig(cfg);
  return { hasAccount: true, accountEmail: cfg.accountEmail, account: data.account };
});
ipcMain.handle('account:login', async (_e, { email, password } = {}) => {
  const data = await cloudApi('/auth/login', { method: 'POST', body: { email, password } });
  const cfg = readConfig();
  cfg.accountToken = data.token; cfg.accountEmail = data.account?.email || email;
  writeConfig(cfg);
  return { hasAccount: true, accountEmail: cfg.accountEmail, account: data.account };
});
ipcMain.handle('account:logout', () => {
  const cfg = readConfig();
  delete cfg.accountToken; delete cfg.accountEmail;
  writeConfig(cfg);
  return { hasAccount: false };
});
ipcMain.handle('account:me', async () => {
  const cfg = readConfig();
  if (!cfg.accountToken) return { hasAccount: false };
  try {
    const me = await cloudApi('/me', { token: cfg.accountToken });
    return { hasAccount: true, ...me };
  } catch (e) {
    return { hasAccount: true, error: String(e?.message || e) };
  }
});
ipcMain.handle('account:checkout', async () => {
  const cfg = readConfig();
  if (!cfg.accountToken) throw new Error('Sign in first.');
  const { url } = await cloudApi('/billing/checkout', { method: 'POST', body: {}, token: cfg.accountToken });
  if (url) await shell.openExternal(url);
  return { opened: Boolean(url) };
});
ipcMain.handle('account:portal', async () => {
  const cfg = readConfig();
  if (!cfg.accountToken) throw new Error('Sign in first.');
  const { url } = await cloudApi('/billing/portal', { method: 'POST', body: {}, token: cfg.accountToken });
  if (url) await shell.openExternal(url);
  return { opened: Boolean(url) };
});
// F3D Storage subscription ($3/mo · 500GB) — separate Stripe price from Pro.
ipcMain.handle('account:checkoutStorage', async () => {
  const cfg = readConfig();
  if (!cfg.accountToken) throw new Error('Sign in first.');
  const { url } = await cloudApi('/billing/checkout-storage', { method: 'POST', body: {}, token: cfg.accountToken });
  if (url) await shell.openExternal(url);
  return { opened: Boolean(url) };
});
// Start the 7-day free trial. Sends this machine's fingerprint so the server can
// refuse a second trial after a delete-and-recreate-account cycle.
ipcMain.handle('account:startTrial', async () => {
  const cfg = readConfig();
  if (!cfg.accountToken) throw new Error('Create a free account first to start the trial.');
  const deviceId = deviceFingerprint();
  const data = await cloudApi('/trial/start', { method: 'POST', body: { deviceId }, token: cfg.accountToken });
  writeTrialLock({ deviceId, startedAt: Date.now() });
  return { hasAccount: true, ...data };
});

// ---- Onboarding flags (first-run screens) ----
const ONBOARD_KEYS = ['onboarded', 'tutorialSeen', 'authSkipped'];
const onboardingOf = (cfg) => Object.fromEntries(ONBOARD_KEYS.map((k) => [k, Boolean(cfg[k])]));
ipcMain.handle('onboarding:get', () => onboardingOf(readConfig()));
ipcMain.handle('onboarding:set', (_e, patch = {}) => {
  const cfg = readConfig();
  for (const k of ONBOARD_KEYS) if (patch[k] !== undefined) cfg[k] = Boolean(patch[k]);
  writeConfig(cfg);
  return onboardingOf(cfg);
});

// ---- Device fingerprint + persistent trial "cookie" (anti-abuse) ----
// A stable id derived from hardware: it recomputes identically even after the
// app config is deleted, so wiping the account can't grant a fresh free trial.
function deviceFingerprint() {
  let mac = '';
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  const raw = [mac, os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || ''].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
// The local "cookie": written to userData AND (if mounted) the F3D Storage volume
// so it survives a config wipe. The server ledger is the real guard; this is a hint.
function trialLockPaths() {
  const paths = [path.join(app.getPath('userData'), 'trial.lock')];
  const vol = storageRoot();
  if (vol.present) paths.push(path.join(vol.root, '.f3d-trial.lock'));
  return paths;
}
function writeTrialLock(data) {
  for (const p of trialLockPaths()) {
    try { fs.writeFileSync(p, JSON.stringify(data)); } catch { /* volume absent/read-only */ }
  }
}
ipcMain.handle('device:fingerprint', () => ({ deviceId: deviceFingerprint() }));
ipcMain.handle('config:setCloudAi', (_e, cloudAi) => {
  const cfg = readConfig();
  cfg.cloudAi = String(cloudAi || 'glm');
  writeConfig(cfg);
  return { cloudAi: cfg.cloudAi };
});
// Enable/disable + configure cloud pairing. Pass { enabled, url, token } — token
// is only overwritten when a non-empty value is provided (so the UI can toggle
// without re-typing it).
ipcMain.handle('config:setCloudPairing', (_e, { enabled, url, token } = {}) => {
  const cfg = readConfig();
  if (url !== undefined) cfg.cloudPairUrl = (url || '').trim();
  if (token) cfg.cloudPairToken = String(token).trim();
  if (enabled !== undefined) cfg.cloudPairEnabled = Boolean(enabled);
  writeConfig(cfg);
  if (cfg.cloudPairEnabled) startCloudPairing(); else stopCloudPairing();
  return { cloudPairEnabled: Boolean(cfg.cloudPairEnabled), cloudPairUrl: cfg.cloudPairUrl || '', hasCloudPairToken: Boolean(cfg.cloudPairToken), ...cloudPairStatus() };
});
// Turn the Claude control bridge on/off (off by default). Starting it opens a
// localhost-only HTTP listener the MCP plugin connects to.
ipcMain.handle('config:setBridgeEnabled', (_e, enabled) => {
  const cfg = readConfig();
  cfg.bridgeEnabled = Boolean(enabled);
  writeConfig(cfg);
  if (cfg.bridgeEnabled) startBridge(); else stopBridge();
  return { bridgeEnabled: cfg.bridgeEnabled, ...bridgeStatus() };
});
// Set/clear/generate the optional shared bearer token. Pass '__generate__' to
// mint a fresh random token, '' to clear it (localhost gate only).
ipcMain.handle('config:setBridgeToken', (_e, token) => {
  const cfg = readConfig();
  if (token === '__generate__') cfg.bridgeToken = crypto.randomBytes(24).toString('hex');
  else cfg.bridgeToken = (token || '').trim();
  writeConfig(cfg);
  return { hasBridgeToken: Boolean(cfg.bridgeToken), bridgeToken: cfg.bridgeToken || '' };
});
ipcMain.handle('config:setAnthropicKey', (_e, key) => {
  const cfg = readConfig();
  cfg.anthropicKey = (key || '').trim();
  writeConfig(cfg);
  return { hasAnthropicKey: Boolean(cfg.anthropicKey) };
});
ipcMain.handle('config:setGeminiKey', (_e, key) => {
  const cfg = readConfig();
  cfg.geminiKey = (key || '').trim();
  writeConfig(cfg);
  return { hasGeminiKey: Boolean(cfg.geminiKey) };
});
ipcMain.handle('config:setGroqKey', (_e, key) => {
  const cfg = readConfig();
  cfg.groqKey = (key || '').trim();
  writeConfig(cfg);
  return { hasGroqKey: Boolean(cfg.groqKey) };
});
ipcMain.handle('config:setMistralKey', (_e, key) => {
  const cfg = readConfig();
  cfg.mistralKey = (key || '').trim();
  writeConfig(cfg);
  return { hasMistralKey: Boolean(cfg.mistralKey) };
});
ipcMain.handle('config:setGlmKey', (_e, key) => {
  const cfg = readConfig();
  cfg.glmKey = (key || '').trim();
  writeConfig(cfg);
  return { hasGlmKey: Boolean(cfg.glmKey) };
});
ipcMain.handle('config:setOpenrouterKey', (_e, key) => {
  const cfg = readConfig();
  cfg.openrouterKey = (key || '').trim();
  writeConfig(cfg);
  return { hasOpenrouterKey: Boolean(cfg.openrouterKey) };
});
ipcMain.handle('config:setCodeProvider', (_e, codeProvider) => {
  const cfg = readConfig();
  cfg.codeProvider = codeProvider;
  writeConfig(cfg);
  return { codeProvider };
});
ipcMain.handle('config:setCircuitProvider', (_e, circuitProvider) => {
  const cfg = readConfig();
  cfg.circuitProvider = circuitProvider;
  writeConfig(cfg);
  return { circuitProvider };
});
ipcMain.handle('config:setOrchestraDirector', (_e, orchestraDirector) => {
  const cfg = readConfig();
  cfg.orchestraDirector = orchestraDirector;
  writeConfig(cfg);
  return { orchestraDirector };
});
ipcMain.handle('config:setOrchestraVision', (_e, orchestraVision) => {
  const cfg = readConfig();
  cfg.orchestraVision = orchestraVision;
  writeConfig(cfg);
  return { orchestraVision };
});
ipcMain.handle('config:setOrchestraHeadroom', (_e, orchestraHeadroom) => {
  const cfg = readConfig();
  cfg.orchestraHeadroom = orchestraHeadroom;
  writeConfig(cfg);
  return { orchestraHeadroom };
});
ipcMain.handle('config:setMeshyKey', (_e, key) => {
  const cfg = readConfig();
  cfg.meshyApiKey = (key || '').trim();
  writeConfig(cfg);
  return { hasMeshyKey: Boolean(cfg.meshyApiKey) };
});
ipcMain.handle('config:setHfToken', (_e, token) => {
  const cfg = readConfig();
  cfg.hfToken = (token || '').trim();
  writeConfig(cfg);
  return { hasHfToken: Boolean(cfg.hfToken) };
});
ipcMain.handle('config:setThingiverseToken', (_e, token) => {
  const cfg = readConfig();
  cfg.thingiverseToken = (token || '').trim();
  writeConfig(cfg);
  return { hasThingiverseToken: Boolean(cfg.thingiverseToken) };
});
ipcMain.handle('config:setProvider', (_e, provider) => {
  const cfg = readConfig();
  cfg.provider = provider;
  writeConfig(cfg);
  return { provider };
});

// ---- IPC: Meshy proxy (keeps the key in main process) ----
const MESHY_BASE = 'https://api.meshy.ai/openapi';

ipcMain.handle('meshy:createTextTo3D', async (_e, payload) => {
  const cfg = readConfig();
  if (!cfg.meshyApiKey) return { mock: true, taskId: 'mock-' + Date.now() };
  const res = await fetch(`${MESHY_BASE}/v2/text-to-3d`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.meshyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'preview',
      prompt: payload.prompt,
      art_style: payload.artStyle || 'realistic',
      ai_model: 'meshy-4',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Meshy error ${res.status}`);
  return { mock: false, taskId: data.result };
});

ipcMain.handle('meshy:getTask', async (_e, taskId) => {
  const cfg = readConfig();
  if (!cfg.meshyApiKey || String(taskId).startsWith('mock-')) {
    return { mock: true, status: 'SUCCEEDED', progress: 100, model_urls: {} };
  }
  const res = await fetch(`${MESHY_BASE}/v2/text-to-3d/${taskId}`, {
    headers: { Authorization: `Bearer ${cfg.meshyApiKey}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Meshy error ${res.status}`);
  return { mock: false, ...data };
});

// ---- IPC: Hugging Face Space proxy (free text-to-3D via Shap-E) ----
// Uses the public gradio REST API. The HF token (if set) is forwarded so the
// request draws on the user's free ZeroGPU daily quota instead of the anon pool.
const HF_SPACE = 'https://hysts-shap-e.hf.space';
const HF_FN = '/gradio_api/call/text-to-3d';

function parseGradioSse(text) {
  const lines = text.split('\n');
  let lastEvent = null;
  let result = null;
  let error = null;
  for (const line of lines) {
    if (line.startsWith('event:')) lastEvent = line.slice(6).trim();
    else if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (lastEvent === 'complete') {
        try { result = JSON.parse(payload); } catch { /* ignore */ }
      } else if (lastEvent === 'error') {
        error = payload || 'Space error';
      }
    }
  }
  if (error) throw new Error(`HF Space error: ${error}`);
  if (!result) throw new Error('No result returned from the Space (it may be busy or out of free GPU quota).');
  const item = Array.isArray(result) ? result[0] : result;
  const url = item?.url || (item?.path ? `${HF_SPACE}/gradio_api/file=${item.path}` : null);
  if (!url) throw new Error('Result had no model URL.');
  return { modelUrl: url };
}

ipcMain.handle('hf:generate', async (_e, payload) => {
  const cfg = readConfig();
  const token = cfg.hfToken;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // 1) submit the job -> event_id
  const post = await fetch(`${HF_SPACE}${HF_FN}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: [payload.prompt, payload.seed ?? 0, payload.guidance ?? 15.0, payload.steps ?? 32] }),
  });
  if (!post.ok) throw new Error(`HF submit failed (${post.status}). Check your token.`);
  const { event_id } = await post.json();
  if (!event_id) throw new Error('No event_id from the Space.');

  // 2) stream the result (the connection closes once complete/error arrives)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 240000);
  try {
    const res = await fetch(`${HF_SPACE}${HF_FN}/${event_id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: ac.signal,
    });
    const text = await res.text();
    return parseGradioSse(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Generation timed out (Space too slow or quota exhausted).');
    throw err;
  } finally {
    clearTimeout(timer);
  }
});

// ---- IPC: AI code generation proxy (multi-provider) ----
// Keeps API keys in the main process (avoids CORS + bundling the key).
// Supported providers: anthropic, gemini, groq, mistral, openrouter, mock.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=100';
// Fallback only. The real model id is resolved live from the account's model
// list so a retired/renamed id never breaks codegen.
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
let anthropicModelCache = null; // resolved model id (cached for the session)

// Ask Anthropic which models THIS key can use, and pick a good default
// (prefer a Sonnet, else the newest listed). Caches the result.
async function resolveAnthropicModel(key) {
  if (anthropicModelCache) return anthropicModelCache;
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (res.ok) {
      const data = await res.json();
      const ids = (data.data || []).map((m) => m.id); // newest-first
      anthropicModelCache =
        ids.find((id) => /sonnet/i.test(id)) ||
        ids.find((id) => /haiku/i.test(id)) ||
        ids[0] ||
        CLAUDE_MODEL;
    } else {
      anthropicModelCache = CLAUDE_MODEL;
    }
  } catch {
    anthropicModelCache = CLAUDE_MODEL;
  }
  return anthropicModelCache;
}
// All of these expose OpenAI-compatible chat-completions endpoints.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'codestral-latest'; // purpose-built code model
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free'; // free tier
const GLM_URL = 'https://api.z.ai/api/paas/v4/chat/completions'; // Zhipu GLM (z.ai)
const GLM_MODEL = 'glm-4.5-flash'; // free tier model
// Hugging Face inference router (OpenAI-compatible). Used for the Orchestra
// VISION check: GLM-4.5V can read a screenshot of the 3D viewport and judge it.
const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_VISION_MODEL = 'zai-org/GLM-4.5V';
// Forge3D Cloud proxy — the "base model": keys live on our server, no user key.
const PROXY_URL = process.env.FORGE3D_PROXY || 'https://forge3d.design/f3d-api';

// Call the cloud proxy (server holds the key). Returns generated text.
async function proxyGenerate({ system, userText, maxTokens = 2000 }) {
  const cfg = readConfig();
  if (!cfg.accountToken) {
    throw new Error('F3D Cloud needs a free account: open Settings → F3D Cloud Account to sign up (5,000 free tokens/month), or enter your own API key.');
  }
  const res = await fetch(`${PROXY_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.accountToken}` },
    body: JSON.stringify({ system, user: userText, maxTokens, provider: cfg.cloudAi || 'glm' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Forge3D Cloud error ${res.status}`);
  return data.text || '';
}

// Maps a provider id -> the config key field that holds its API key.
const CODE_KEYS = {
  anthropic: 'anthropicKey',
  gemini: 'geminiKey',
  groq: 'groqKey',
  mistral: 'mistralKey',
  openrouter: 'openrouterKey',
  glm: 'glmKey',
};

// Resolve a desired provider id to one that actually has a key, else 'mock'.
// 'base' (Forge3D Cloud) needs no local key — the server holds it.
function providerWithKey(want, cfg) {
  if (!want || want === 'mock') return 'mock';
  if (want === 'base') return 'base';
  const keyField = CODE_KEYS[want];
  return keyField && cfg[keyField] ? want : 'mock';
}
// Provider used for code generation (sketch / Python).
function codeProviderFor(cfg) {
  return providerWithKey(cfg.codeProvider || (cfg.anthropicKey ? 'anthropic' : 'mock'), cfg);
}
// Provider used for the circuit-debug agent (can be a different model).
function circuitProviderFor(cfg) {
  return providerWithKey(cfg.circuitProvider || cfg.codeProvider || (cfg.anthropicKey ? 'anthropic' : 'mock'), cfg);
}

function stripFences(text) {
  return String(text || '')
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Turn a raw HTTP status into a clear, human message. `detail` is the provider's
// own error text (kept visible — it often explains the *real* cause, e.g. a
// quota/region problem vs. an actual rate limit).
function friendlyHttpError(status, provider, detail) {
  const extra = detail ? ` — ${detail}` : '';
  if (status === 429)
    return `${provider}: quota/rate limit hit. If this is your first try, the free tier may be unavailable in your region or not enabled on the key — try Groq instead, or check the key.${extra}`;
  if (status === 401 || status === 403)
    return `${provider} rejected the API key. Double-check it in Settings (wrong, expired, or lacks permissions).${extra}`;
  if (status === 402)
    return `${provider} needs billing/credits on your account.${extra}`;
  if (status >= 500)
    return `${provider} server error (${status}). It's temporary — try again shortly.${extra}`;
  return detail || `${provider} error ${status}`;
}

// Call an OpenAI-compatible chat-completions endpoint (Gemini / Groq / Mistral / OpenRouter).
// Retries automatically on 429/503 with exponential backoff so transient free-tier
// rate limits don't surface as a hard error.
async function openAICompatGenerate({ url, key, model, system, userText, extraHeaders, provider = model, maxTokens = 2000 }) {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return stripFences(data?.choices?.[0]?.message?.content || '');
    }
    // Retry transient overload errors (rate limit / server busy).
    if ((res.status === 429 || res.status === 503) && i < attempts - 1) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1500 * Math.pow(2, i); // 1.5s, 3s
      await sleep(wait);
      continue;
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }
    throw new Error(friendlyHttpError(res.status, provider, data?.error?.message));
  }
}

function mockSketch(prompt, target) {
  if (target === 'rpi5') {
    return `#!/usr/bin/env python3
# Mock Python program for Raspberry Pi OS (no provider key — add one in Settings).
# Request: ${String(prompt || '').slice(0, 120)}
from gpiozero import LED
from time import sleep

led = LED(17)  # TODO: set your real BCM GPIO pin

while True:
    led.toggle()
    print("tick")
    sleep(1)`;
  }
  return `// Mock Arduino sketch (no provider key — add one in Settings).
// Request: ${String(prompt || '').slice(0, 120)}
void setup() {
  Serial.begin(9600);
  // TODO: configure your pins here
}

void loop() {
  // TODO: your logic here
  delay(1000);
}`;
}

// Shared provider router: takes a system + user prompt and returns generated text.
// Returns { text, mock, provider }. When no key is configured, mock is true and
// text is null so the caller can substitute its own placeholder.
async function generateText({ cfg, system, userText, provider: forced, maxTokens = 2000 }) {
  const provider = forced || codeProviderFor(cfg);
  if (provider === 'mock') return { text: null, mock: true, provider: 'mock' };
  if (provider === 'base') {
    const text = await proxyGenerate({ system, userText, maxTokens });
    return { text, mock: false, provider: 'base' };
  }

  if (provider === 'gemini') {
    const text = await openAICompatGenerate({
      url: GEMINI_URL, key: cfg.geminiKey, model: GEMINI_MODEL, system, userText, provider: 'Gemini', maxTokens,
    });
    return { text, mock: false, provider };
  }
  if (provider === 'groq') {
    const text = await openAICompatGenerate({
      url: GROQ_URL, key: cfg.groqKey, model: GROQ_MODEL, system, userText, provider: 'Groq', maxTokens,
    });
    return { text, mock: false, provider };
  }
  if (provider === 'mistral') {
    const text = await openAICompatGenerate({
      url: MISTRAL_URL, key: cfg.mistralKey, model: MISTRAL_MODEL, system, userText, provider: 'Mistral', maxTokens,
    });
    return { text, mock: false, provider };
  }
  if (provider === 'openrouter') {
    const text = await openAICompatGenerate({
      url: OPENROUTER_URL, key: cfg.openrouterKey, model: OPENROUTER_MODEL, system, userText,
      extraHeaders: { 'HTTP-Referer': 'https://forge3d.app', 'X-Title': 'Forge3D' }, provider: 'OpenRouter', maxTokens,
    });
    return { text, mock: false, provider };
  }
  if (provider === 'glm') {
    const text = await openAICompatGenerate({
      url: GLM_URL, key: cfg.glmKey, model: GLM_MODEL, system, userText, provider: 'GLM', maxTokens,
    });
    return { text, mock: false, provider };
  }

  // anthropic (default) — resolve a valid model id from the account
  const claudeModel = await resolveAnthropicModel(cfg.anthropicKey);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: claudeModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(friendlyHttpError(res.status, 'Claude', data?.error?.message));
  const text = stripFences((data.content || []).map((b) => b.text || '').join(''));
  return { text, mock: false, provider: 'anthropic' };
}

ipcMain.handle('claude:generate', async (_e, { prompt, context, target, provider: providerOverride } = {}) => {
  const cfg = readConfig();
  const system =
    target === 'rpi5'
      ? 'You are an expert Raspberry Pi / Linux engineer. The board is a Raspberry Pi 5 running ' +
        'Raspberry Pi OS (Linux) — it is a full computer, NOT an Arduino. Write a single, complete, ' +
        'runnable Python 3 program for the described task and wiring. Prefer the gpiozero library ' +
        '(fall back to RPi.GPIO) for GPIO, and standard Python libraries otherwise. Use the exact ' +
        'BCM GPIO pin numbers provided. Add brief inline comments and a shebang. ' +
        'Respond with ONLY the Python code — no markdown fences, no prose.'
      : 'You are an expert Arduino/embedded engineer. Generate a single, complete, ' +
        'compilable Arduino sketch (C++) for the described board and wiring. ' +
        'Use the exact pin names/numbers provided. Add brief inline comments. ' +
        'Respond with ONLY the code — no markdown fences, no prose.';
  const userText =
    (context ? `Circuit context:\n${context}\n\n` : '') +
    `Task: ${prompt || (target === 'rpi5' ? 'Blink an LED on a GPIO pin.' : 'Blink the onboard LED.')}`;

  // Orchestra passes its director provider so all its delegated work uses ONE
  // model the user actually has a key for — not the separate (possibly stale)
  // codeProvider setting.
  const want = providerOverride ? providerWithKey(providerOverride, cfg) : codeProviderFor(cfg);
  const { text, mock, provider } = await generateText({ cfg, system, userText, provider: want });
  if (mock) return { code: mockSketch(prompt, target), mock: true, provider: 'mock' };
  return { code: text, mock: false, provider };
});

// ---- IPC: circuit debugging agent ----
// Receives a text netlist + the parts catalog and returns a JSON proposal of
// concrete edits (add/remove wires & parts). The renderer asks the user to
// approve before applying anything to the canvas.
ipcMain.handle('claude:circuit', async (_e, { prompt, netlist, catalog, provider: providerOverride } = {}) => {
  const cfg = readConfig();
  const system =
    'You are an expert electronics engineer debugging an Arduino/breadboard circuit. ' +
    'You are given a NETLIST (parts with their pins, and the wires between them) and a user request. ' +
    'Diagnose issues (missing power/ground, unpowered parts, wrong/missing connections) and propose concrete edits. ' +
    'Reference pins EXACTLY as "nodeId.pin" from the netlist, e.g. "n1.+", "n2.VIN". ' +
    'To add a new part, use op "addPart" with a valid partId from the AVAILABLE PARTS list and an optional "ref" alias; ' +
    'you may then wire that alias, e.g. ref "x1" -> "x1.+". ' +
    'Respond with ONLY valid JSON (no markdown, no prose) in EXACTLY this shape: ' +
    '{"summary": string, "actions": [{"op": "addWire"|"removeWire"|"addPart"|"removePart", ' +
    '"from"?: string, "to"?: string, "partId"?: string, "ref"?: string, "node"?: string, "why"?: string}]}. ' +
    'Keep summary short and plain. Keep "why" under 8 words or omit it. ' +
    'If nothing should change, return an empty actions array and say why in summary.';
  const userText =
    `NETLIST:\n${netlist || '(empty circuit)'}\n\n` +
    `AVAILABLE PARTS (partId — name — pins):\n${catalog || '(none)'}\n\n` +
    `USER REQUEST: ${prompt || 'Find and fix problems in this circuit.'}`;

  // Building a whole circuit can take many actions — give the model plenty of
  // room so the JSON never gets cut off mid-array (truncation = unreadable).
  // An override (from Orchestra) routes this through the user's Orchestra model.
  const want = providerOverride ? providerWithKey(providerOverride, cfg) : circuitProviderFor(cfg);
  const { text, mock, provider } = await generateText({ cfg, system, userText, provider: want, maxTokens: 6000 });
  if (mock) {
    return {
      raw: JSON.stringify({
        summary: 'Mock agent — no real analysis. Add a provider key in Settings (Groq is free) to debug your circuit.',
        actions: [],
      }),
      mock: true,
      provider: 'mock',
    };
  }
  return { raw: text, mock: false, provider };
});

// ---- IPC: free-form Q&A with the circuit agent (just answers, no edits) ----
ipcMain.handle('claude:ask', async (_e, { question, netlist } = {}) => {
  const cfg = readConfig();
  const system =
    'You are a friendly electronics & embedded-systems assistant inside a circuit simulator. ' +
    'Answer the user\'s question clearly and concisely in plain text (no markdown headings). ' +
    'Use the circuit netlist for context when relevant.';
  const userText =
    (netlist ? `Circuit netlist:\n${netlist}\n\n` : '') + `Question: ${question || ''}`;
  const { text, mock, provider } = await generateText({ cfg, system, userText, provider: circuitProviderFor(cfg), maxTokens: 3000 });
  if (mock) return { answer: 'Mock mode — choose a circuit agent (Groq is free) and add its key in Settings to ask real questions.', mock: true, provider: 'mock' };
  return { answer: text, mock: false, provider };
});

// ---- IPC: Orchestra director — text reasoning step ----
// The conductor model plans the build and emits a single tool call as JSON.
// It routes through the SAME provider router as codegen, so the director can be
// the free Forge3D Cloud base model, GLM, Gemini, Groq, etc. Kept cheap on
// purpose (low max_tokens) — Orchestra issues one action at a time.
ipcMain.handle('orchestra:think', async (_e, { system, userText, maxTokens = 1200 } = {}) => {
  const cfg = readConfig();
  const want = providerWithKey(cfg.orchestraDirector || 'base', cfg);
  const { text, mock, provider } = await generateText({ cfg, system, userText, provider: want, maxTokens });
  return { text: text || '', mock, provider };
});

// ---- IPC: Orchestra vision — let the director SEE the viewport ----
// Sends a downscaled screenshot to GLM-4.5V via the Hugging Face router so the
// model can confirm the design before the next step ("does this look like a
// car? are the wheels on the ground?"). Needs the user's free HF token.
ipcMain.handle('orchestra:vision', async (_e, { prompt, imageDataUrl } = {}) => {
  const cfg = readConfig();
  if (!cfg.hfToken) {
    return {
      text: 'Vision check skipped — add a free Hugging Face token in Settings so Orchestra can SEE the design with GLM-4.5V.',
      model: 'none', mock: true,
    };
  }
  if (!imageDataUrl) throw new Error('orchestra:vision needs an image');
  const res = await fetch(HF_ROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.hfToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: HF_VISION_MODEL,
      max_tokens: 600,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || 'Describe the image and whether it matches the described goal.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(friendlyHttpError(res.status, 'GLM-4.5V (Hugging Face)', data?.error?.message || data?.error));
  let content = data?.choices?.[0]?.message?.content ?? '';
  // some vision/reasoning models return content as an array of parts
  if (Array.isArray(content)) content = content.map((c) => c?.text || '').join('').trim();
  return { text: String(content || '(no answer)'), model: HF_VISION_MODEL };
});

// ---- IPC: per-provider remaining API credits ----
// Free tiers report ∞. OpenRouter exposes real credits; Anthropic has no balance
// API, so we link to the console instead.
ipcMain.handle('usage:get', async () => {
  const cfg = readConfig();
  const out = [
    { id: 'base', name: 'Forge3D Cloud (base)', hasKey: true, free: true, remaining: '∞', note: 'Shared server key — no setup needed' },
    { id: 'gemini', name: 'Gemini', hasKey: !!cfg.geminiKey, free: true, remaining: '∞', note: 'Free tier' },
    { id: 'groq', name: 'Groq', hasKey: !!cfg.groqKey, free: true, remaining: '∞', note: 'Free tier' },
    { id: 'mistral', name: 'Mistral', hasKey: !!cfg.mistralKey, free: true, remaining: '∞', note: 'Free tier (Codestral)' },
    { id: 'glm', name: 'GLM (Zhipu)', hasKey: !!cfg.glmKey, free: true, remaining: '∞', note: 'Free tier (GLM-4-Flash)' },
  ];

  const or = { id: 'openrouter', name: 'OpenRouter', hasKey: !!cfg.openrouterKey, free: false, remaining: '—', note: 'No key' };
  if (cfg.openrouterKey) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${cfg.openrouterKey}` },
      });
      if (res.ok) {
        const d = (await res.json()).data || {};
        if (d.limit == null) { or.remaining = '∞'; or.free = true; or.note = 'No spend limit / free models'; }
        else {
          const rem = Math.max(0, (d.limit || 0) - (d.usage || 0));
          or.remaining = '$' + rem.toFixed(2);
          or.note = `Used $${(d.usage || 0).toFixed(2)} of $${(d.limit || 0).toFixed(2)}`;
        }
      } else {
        or.note = `Couldn't read (HTTP ${res.status})`;
      }
    } catch {
      or.note = 'Network error';
    }
  }
  out.push(or);

  out.push({
    id: 'anthropic', name: 'Claude (Anthropic)', hasKey: !!cfg.anthropicKey, free: false,
    remaining: cfg.anthropicKey ? 'see console' : '—',
    note: 'Pay-as-you-go — balance is shown in the Anthropic console',
    url: 'https://console.anthropic.com/settings/billing',
  });
  return out;
});

// ---- IPC: Thingiverse search proxy (keeps the app token in main process) ----
// Free API: register an app at thingiverse.com/developers to get an App Token.
const THINGI_BASE = 'https://api.thingiverse.com';

function thingiAuth() {
  const cfg = readConfig();
  if (!cfg.thingiverseToken) throw new Error('No Thingiverse token set. Add one in Settings.');
  return { Authorization: `Bearer ${cfg.thingiverseToken}` };
}

// Search "things" by term -> list of cards with thumbnail + public_url.
ipcMain.handle('thingiverse:search', async (_e, { term, page = 1, perPage = 24 } = {}) => {
  const q = encodeURIComponent((term || '').trim());
  if (!q) return { hits: [], total: 0 };
  const url = `${THINGI_BASE}/search/${q}?type=things&per_page=${perPage}&page=${page}`;
  const res = await fetch(url, { headers: thingiAuth() });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Thingiverse error ${res.status}`);
  const hits = (data.hits || []).map((h) => ({
    id: h.id,
    name: h.name,
    thumbnail: h.thumbnail || h.preview_image || null,
    publicUrl: h.public_url,
    creator: h.creator?.name || '',
  }));
  return { hits, total: data.total ?? hits.length };
});

// Download the first STL of a thing to a local cache file and return its path.
ipcMain.handle('thingiverse:import', async (_e, { thingId } = {}) => {
  if (!thingId) throw new Error('Missing thingId.');
  const headers = thingiAuth();
  // 1) list files, pick the first STL
  const fres = await fetch(`${THINGI_BASE}/things/${thingId}/files`, { headers });
  const files = await fres.json();
  if (!fres.ok) throw new Error(files?.error || `Thingiverse error ${fres.status}`);
  const stl = (Array.isArray(files) ? files : []).find((f) => /\.stl$/i.test(f.name || ''));
  if (!stl) throw new Error('This model has no STL file to import.');

  // 2) resolve the (auth-protected) download url -> follows redirect to storage
  const dlUrl = stl.download_url || `${THINGI_BASE}/files/${stl.id}/download`;
  const dres = await fetch(dlUrl, { headers });
  if (!dres.ok) throw new Error(`Download failed (${dres.status}).`);
  const buf = Buffer.from(await dres.arrayBuffer());

  // 3) cache to userData (for reuse) and return the raw bytes so the renderer
  //    can build a Blob URL — avoids file:// webSecurity restrictions.
  const cacheDir = path.join(app.getPath('userData'), 'thingiverse-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safe = String(stl.name || `thing-${thingId}.stl`).replace(/[^\w.\-]+/g, '_');
  const filePath = path.join(cacheDir, `${thingId}-${safe}`);
  fs.writeFileSync(filePath, buf);
  // Native bounding box (mm by STL convention) so the importer can place the
  // part at its REAL size — a 157×121×29 mm radiator lands at 157×121×29 mm.
  const dims_mm = measureSTL(buf);
  return { name: stl.name, filePath, bytes: buf, dims_mm }; // buf arrives as Uint8Array in the renderer
});

// ---- IPC: save exported files (SVG / BOM) ----
// Remembers the last saved project file so code can be written alongside it.
let lastProjectFile = null;

// ---- in-app project library (no Finder digging) ----
// Drafts live in Documents/Forge3D/Projects (.f3d); production packages in
// Documents/Forge3D/Production (one folder per export, USB-ready).
const LIBRARY_ROOT = () => path.join(app.getPath('documents'), 'Forge3D');
const PROJECTS_DIR = () => path.join(LIBRARY_ROOT(), 'Projects');
const PRODUCTION_DIR = () => path.join(LIBRARY_ROOT(), 'Production');
const USB_CAPACITY_BYTES = 128 * 1024 ** 3; // the user's 128 GB workstation USB

function dirSize(p) {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    total += e.isDirectory() ? dirSize(fp) : fs.statSync(fp).size;
  }
  return total;
}

// ---- F3D Storage: a dedicated local volume named "F3D Storage" (the USB), with
// a graceful fallback to Documents/Forge3D/Storage when the drive isn't mounted.
// Forge3D NEVER formats or renames a disk — the user prepares the volume manually.
const STORAGE_VOLUME = '/Volumes/F3D Storage';
function storageRoot() {
  const cfg = readConfig();
  for (const c of [cfg.storageRoot, STORAGE_VOLUME].filter(Boolean)) {
    try { if (fs.statSync(c).isDirectory()) return { root: c, present: true }; } catch { /* next */ }
  }
  return { root: path.join(LIBRARY_ROOT(), 'Storage'), present: false };
}
ipcMain.handle('storage:status', () => {
  const { root, present } = storageRoot();
  let capacityBytes = 0, freeBytes = 0, usedBytes = 0;
  try { if (fs.existsSync(root)) usedBytes = dirSize(root); } catch { /* ignore */ }
  try {
    const s = fs.statfsSync(present ? root : path.dirname(root));
    capacityBytes = s.blocks * s.bsize;
    freeBytes = s.bavail * s.bsize;
  } catch { /* statfsSync unavailable */ }
  return { root, present, capacityBytes, freeBytes, usedBytes };
});
ipcMain.handle('storage:add', async () => {
  const { root, present } = storageRoot();
  fs.mkdirSync(root, { recursive: true });
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Add files to F3D Storage',
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths?.length) return { canceled: true };
  let count = 0;
  for (const fp of filePaths) {
    try { fs.copyFileSync(fp, path.join(root, path.basename(fp))); count++; } catch { /* skip */ }
  }
  return { ok: true, count, root, present };
});
ipcMain.handle('storage:list', () => {
  const { root, present } = storageRoot();
  if (!fs.existsSync(root)) return { files: [], root, present };
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => {
      const p = path.join(root, e.name);
      const st = fs.statSync(p);
      return { name: e.name, path: p, size: e.isDirectory() ? null : st.size, isDir: e.isDirectory(), mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return { files, root, present };
});
ipcMain.handle('storage:reveal', (_e, { filePath } = {}) => {
  const target = filePath || storageRoot().root;
  const ok = fs.existsSync(target);
  if (ok) shell.showItemInFolder(target);
  return { ok };
});

ipcMain.handle('projects:list', () => {
  const listDir = (dir, wantExt) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => (wantExt ? e.isFile() && wantExt.test(e.name) : true) && !e.name.startsWith('.'))
      .map((e) => {
        const p = path.join(dir, e.name);
        const st = fs.statSync(p);
        return { name: e.name, path: p, mtime: st.mtimeMs, isDir: e.isDirectory(), size: e.isDirectory() ? null : st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  };
  return {
    projects: listDir(PROJECTS_DIR(), /\.(f3d|json)$/i),
    production: listDir(PRODUCTION_DIR(), null),
  };
});

ipcMain.handle('projects:openPath', (_e, { filePath } = {}) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (/\.(f3d|json)$/i.test(filePath)) lastProjectFile = filePath;
  return { opened: true, filePath, content };
});

ipcMain.handle('projects:reveal', (_e, { filePath } = {}) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

// Write a production package: every file lands in Production/<name>/. If the
// folder somehow exceeds the USB capacity (128 GB) it gets zipped instead.
ipcMain.handle('production:export', async (_e, { name, files } = {}) => {
  const safe = String(name || 'project').replace(/[^\w.\- ]+/g, '_').trim() || 'project';
  const dir = path.join(PRODUCTION_DIR(), safe);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files || []) {
    const fp = path.join(dir, String(f.name).replace(/[^\w.\- ]+/g, '_'));
    if (f.encoding === 'base64') fs.writeFileSync(fp, Buffer.from(f.content, 'base64'));
    else fs.writeFileSync(fp, f.content ?? '', 'utf-8');
  }
  let size = dirSize(dir);
  let finalPath = dir;
  let zipped = false;
  if (size > USB_CAPACITY_BYTES) {
    // bigger than the USB: compress (ditto preserves Mac metadata)
    const zipPath = dir + '.zip';
    await new Promise((resolve, reject) => {
      execFile('ditto', ['-c', '-k', '--sequesterRsrc', dir, zipPath], (err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(dir, { recursive: true, force: true });
    finalPath = zipPath;
    size = fs.statSync(zipPath).size;
    zipped = true;
  }
  return { ok: true, path: finalPath, size, zipped };
});

ipcMain.handle('file:save', async (_e, { defaultName, content, filters, encoding }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(os.homedir(), 'Desktop', defaultName || 'export.txt'),
    filters: filters || [{ name: 'All', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { saved: false };
  if (encoding === 'base64') {
    fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
  } else {
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  if (/\.(f3d|json)$/i.test(filePath)) lastProjectFile = filePath;
  return { saved: true, filePath };
});

// The folder that holds a project's companion files (sketches, exports…).
function projectFilesDir() {
  if (!lastProjectFile) return null;
  const base = path.basename(lastProjectFile).replace(/\.(f3d|json)$/i, '');
  return path.join(path.dirname(lastProjectFile), base + '_files');
}

// Save a generated code file INTO the current project's folder. Falls back to a
// Save dialog if no project has been saved yet.
ipcMain.handle('code:save', async (_e, { filename, content } = {}) => {
  const safe = (filename || 'sketch.txt').replace(/[^\w.\-]+/g, '_');
  const dir = projectFilesDir();
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, safe);
    fs.writeFileSync(filePath, content ?? '', 'utf-8');
    return { saved: true, filePath, inProject: true };
  }
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(os.homedir(), 'Desktop', safe),
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, content ?? '', 'utf-8');
  return { saved: true, filePath, inProject: false };
});

ipcMain.handle('file:open', async (_e, { filters } = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters || [{ name: 'Forge3D Project', extensions: ['f3d', 'json'] }],
  });
  if (canceled || !filePaths?.length) return { opened: false };
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  if (/\.(f3d|json)$/i.test(filePaths[0])) lastProjectFile = filePaths[0];
  return { opened: true, filePath: filePaths[0], content };
});

// Save the project IN PLACE: overwrite the file it was opened from / last
// saved to. Only falls back to a dialog when there's no current file yet.
ipcMain.handle('project:save', async (_e, { content, forceDialog } = {}) => {
  if (lastProjectFile && !forceDialog) {
    fs.writeFileSync(lastProjectFile, content ?? '', 'utf-8');
    return { saved: true, filePath: lastProjectFile, inPlace: true };
  }
  fs.mkdirSync(PROJECTS_DIR(), { recursive: true });
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(PROJECTS_DIR(), 'project.f3d'),
    filters: [{ name: 'Forge3D Project', extensions: ['f3d', 'json'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, content ?? '', 'utf-8');
  lastProjectFile = filePath;
  return { saved: true, filePath, inPlace: false };
});

// Headless save for the control bridge / MCP: writes straight into the project
// library (Documents/Forge3D/Projects) with NO dialog, so a remote Claude can
// persist its work as a real .f3d file and tell the user where it is.
ipcMain.handle('project:saveAs', async (_e, { name, content } = {}) => {
  fs.mkdirSync(PROJECTS_DIR(), { recursive: true });
  const safe = String(name || 'project').replace(/\.f3d$/i, '').replace(/[^\w.\- ]+/g, '_').trim() || 'project';
  const filePath = path.join(PROJECTS_DIR(), `${safe}.f3d`);
  fs.writeFileSync(filePath, content ?? '', 'utf-8');
  lastProjectFile = filePath;
  return { saved: true, filePath };
});

// Open an external URL (e.g. "Get a free key") in the system browser.
ipcMain.handle('app:openExternal', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { opened: true };
  }
  return { opened: false };
});

app.whenReady().then(() => {
  // Dev Dock icon (packaged builds use build/icon.icns from the app bundle).
  if (process.platform === 'darwin' && isDev && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {}
  }
  createWindow();
  // Bring the control bridge up if the user left it enabled last session.
  if (readConfig().bridgeEnabled) startBridge();
  if (readConfig().cloudPairEnabled) startCloudPairing();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopBridge(); stopCloudPairing(); });
