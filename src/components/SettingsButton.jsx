import React, { useState, useEffect } from 'react';
import { useStore } from '../lib/store.js';

const GEN_PROVIDERS = [
  { id: 'mock', label: 'Mock' },
  { id: 'hf', label: 'Hugging Face' },
  { id: 'meshy', label: 'Meshy' },
];

const QUALITIES = [
  { id: 'low', label: 'Light' },
  { id: 'medium', label: 'Balanced' },
  { id: 'high', label: 'High' },
];

export default function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [meshyKey, setMeshyKey] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [thingiToken, setThingiToken] = useState('');
  const [keyInputs, setKeyInputs] = useState({}); // code-provider id -> typed key
  const [usage, setUsage] = useState(null);       // per-provider remaining credits

  // refresh credit balances whenever the panel opens
  useEffect(() => {
    if (!open) return;
    setUsage(null);
    window.forge.usage?.get().then(setUsage).catch(() => setUsage([]));
    setCloudUrlInput(useStore.getState().cloudPairUrl || '');
  }, [open]);

  const provider = useStore((s) => s.provider);
  const codeProvider = useStore((s) => s.codeProvider);
  const orchestraDirector = useStore((s) => s.orchestraDirector);
  const orchestraHeadroom = useStore((s) => s.orchestraHeadroom);
  const setOrchestraDirector = useStore((s) => s.setOrchestraDirector);
  const setOrchestraHeadroom = useStore((s) => s.setOrchestraHeadroom);
  const bridgeEnabled = useStore((s) => s.bridgeEnabled);
  const bridgeRunning = useStore((s) => s.bridgeRunning);
  const bridgePort = useStore((s) => s.bridgePort);
  const bridgeToken = useStore((s) => s.bridgeToken);
  const bridgeServerPath = useStore((s) => s.bridgeServerPath);
  const setBridgeEnabled = useStore((s) => s.setBridgeEnabled);
  const setBridgeToken = useStore((s) => s.setBridgeToken);
  const cloudPairEnabled = useStore((s) => s.cloudPairEnabled);
  const cloudPairUrl = useStore((s) => s.cloudPairUrl);
  const hasCloudPairToken = useStore((s) => s.hasCloudPairToken);
  const cloudPairStatus = useStore((s) => s.cloudPairStatus);
  const setCloudPair = useStore((s) => s.setCloudPair);
  const [cloudUrlInput, setCloudUrlInput] = useState('');
  const [cloudTokenInput, setCloudTokenInput] = useState('');
  const hasMeshyKey = useStore((s) => s.hasMeshyKey);
  const hasHfToken = useStore((s) => s.hasHfToken);
  const hasThingiverseToken = useStore((s) => s.hasThingiverseToken);
  const hasAnthropicKey = useStore((s) => s.hasAnthropicKey);
  const hasGeminiKey = useStore((s) => s.hasGeminiKey);
  const hasGroqKey = useStore((s) => s.hasGroqKey);
  const hasMistralKey = useStore((s) => s.hasMistralKey);
  const hasOpenrouterKey = useStore((s) => s.hasOpenrouterKey);
  const hasGlmKey = useStore((s) => s.hasGlmKey);
  const exportQuality = useStore((s) => s.exportQuality);
  const uiZoom = useStore((s) => s.uiZoom);
  const setUiZoom = useStore((s) => s.setUiZoom);
  const lightLevel = useStore((s) => s.lightLevel);
  const setLightLevel = useStore((s) => s.setLightLevel);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  const setProvider = useStore((s) => s.setProvider);
  const setCodeProvider = useStore((s) => s.setCodeProvider);
  const setHasMeshyKey = useStore((s) => s.setHasMeshyKey);
  const setHasHfToken = useStore((s) => s.setHasHfToken);
  const setHasThingiverseToken = useStore((s) => s.setHasThingiverseToken);
  const setHasAnthropicKey = useStore((s) => s.setHasAnthropicKey);
  const setHasGeminiKey = useStore((s) => s.setHasGeminiKey);
  const setHasGroqKey = useStore((s) => s.setHasGroqKey);
  const setHasMistralKey = useStore((s) => s.setHasMistralKey);
  const setHasOpenrouterKey = useStore((s) => s.setHasOpenrouterKey);
  const setHasGlmKey = useStore((s) => s.setHasGlmKey);
  const setExportQuality = useStore((s) => s.setExportQuality);

  // --- code (AI) providers, data-driven ---
  const CODE_PROVIDERS = [
    {
      id: 'base', name: 'Forge3D Cloud', tag: 'FREE', model: 'base model · no key',
      note: 'Use the built-in base model — works out of the box, no account or API key. Powered by a shared Forge3D server. Pick a provider below to use your own model instead.',
      noKey: true,
    },
    {
      id: 'gemini', name: 'Google Gemini', tag: 'FREE', model: 'Gemini 2.0 Flash',
      placeholder: 'AIza…', url: 'https://aistudio.google.com/app/apikey', urlLabel: 'aistudio.google.com',
      note: 'Best free balance — ~15 req/min, 1500/day. No credit card needed.',
      has: hasGeminiKey, setHas: setHasGeminiKey, save: (k) => window.forge.config.setGeminiKey(k), resKey: 'hasGeminiKey',
    },
    {
      id: 'groq', name: 'Groq', tag: 'FREE', model: 'Llama 3.3 70B',
      placeholder: 'gsk_…', url: 'https://console.groq.com/keys', urlLabel: 'console.groq.com',
      note: 'Extremely fast inference, generous free tier. Great for quick iteration.',
      has: hasGroqKey, setHas: setHasGroqKey, save: (k) => window.forge.config.setGroqKey(k), resKey: 'hasGroqKey',
    },
    {
      id: 'mistral', name: 'Mistral', tag: 'FREE', model: 'Codestral',
      placeholder: 'mistral key…', url: 'https://console.mistral.ai/api-keys/', urlLabel: 'console.mistral.ai',
      note: 'Codestral is purpose-built for code. Free tier on La Plateforme.',
      has: hasMistralKey, setHas: setHasMistralKey, save: (k) => window.forge.config.setMistralKey(k), resKey: 'hasMistralKey',
    },
    {
      id: 'openrouter', name: 'OpenRouter', tag: 'FREE', model: 'Llama 3.3 70B (:free)',
      placeholder: 'sk-or-…', url: 'https://openrouter.ai/keys', urlLabel: 'openrouter.ai',
      note: 'One key, many models — several are completely free.',
      has: hasOpenrouterKey, setHas: setHasOpenrouterKey, save: (k) => window.forge.config.setOpenrouterKey(k), resKey: 'hasOpenrouterKey',
    },
    {
      id: 'glm', name: 'GLM (Zhipu)', tag: 'FREE', model: 'GLM-4.5-Flash',
      placeholder: 'glm key…', url: 'https://z.ai/manage-apikey/apikey-list', urlLabel: 'z.ai',
      note: 'Zhipu GLM — GLM-4.5-Flash is free. Strong at code. Paste your z.ai API key below.',
      has: hasGlmKey, setHas: setHasGlmKey, save: (k) => window.forge.config.setGlmKey(k), resKey: 'hasGlmKey',
    },
    {
      id: 'anthropic', name: 'Claude', tag: 'PAID', model: 'Sonnet',
      placeholder: 'sk-ant-…', url: 'https://console.anthropic.com/settings/keys', urlLabel: 'console.anthropic.com',
      note: 'Highest quality, but the Anthropic API needs prepaid credits (Plans & Billing).',
      has: hasAnthropicKey, setHas: setHasAnthropicKey, save: (k) => window.forge.config.setAnthropicKey(k), resKey: 'hasAnthropicKey',
    },
    {
      id: 'mock', name: 'Mock', tag: 'FREE', model: 'placeholder',
      note: 'No account — generates a placeholder sketch so you can test the flow.',
      noKey: true,
    },
  ];

  const activeCode = CODE_PROVIDERS.find((p) => p.id === codeProvider) || CODE_PROVIDERS[0];
  const codeReady = activeCode.noKey || activeCode.has;

  async function chooseGenProvider(id) {
    await window.forge.config.setProvider(id);
    setProvider(id);
  }
  async function chooseCodeProvider(id) {
    await window.forge.config.setCodeProvider(id);
    setCodeProvider(id);
  }
  async function chooseOrchestraDirector(id) {
    await window.forge.config.setOrchestraDirector(id);
    setOrchestraDirector(id);
  }
  async function chooseHeadroom(id) {
    await window.forge.config.setOrchestraHeadroom(id);
    setOrchestraHeadroom(id);
  }
  async function toggleBridge() {
    const next = !bridgeEnabled;
    const res = await window.forge.config.setBridgeEnabled(next);
    setBridgeEnabled(Boolean(res?.bridgeEnabled ?? next), Boolean(res?.running));
  }
  async function generateToken() {
    const res = await window.forge.config.setBridgeToken('__generate__');
    setBridgeToken(res?.bridgeToken || '');
  }
  async function clearToken() {
    const res = await window.forge.config.setBridgeToken('');
    setBridgeToken(res?.bridgeToken || '');
  }
  function copyText(text) {
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  }
  async function applyCloudPairing(enabled) {
    const url = cloudUrlInput.trim();
    const token = cloudTokenInput.trim();
    const res = await window.forge.config.setCloudPairing({ enabled, url, ...(token ? { token } : {}) });
    setCloudPair({
      cloudPairEnabled: Boolean(res?.cloudPairEnabled),
      cloudPairUrl: res?.cloudPairUrl ?? url,
      hasCloudPairToken: Boolean(res?.hasCloudPairToken),
      cloudPairStatus: res?.status || 'off',
    });
    setCloudTokenInput('');
  }
  async function saveCodeKey(p) {
    const val = (keyInputs[p.id] || '').trim();
    const res = await p.save(val);
    p.setHas(Boolean(res?.[p.resKey]));
    setKeyInputs((k) => ({ ...k, [p.id]: '' }));
  }
  async function saveMeshy() {
    const res = await window.forge.config.setMeshyKey(meshyKey);
    setHasMeshyKey(Boolean(res.hasMeshyKey)); setMeshyKey('');
  }
  async function saveHf() {
    const res = await window.forge.config.setHfToken(hfToken);
    setHasHfToken(Boolean(res.hasHfToken)); setHfToken('');
  }
  async function saveThingi() {
    const res = await window.forge.config.setThingiverseToken(thingiToken);
    setHasThingiverseToken(Boolean(res.hasThingiverseToken)); setThingiToken('');
  }

  function openLink(e, url) {
    e.preventDefault();
    window.forge?.openExternal ? window.forge.openExternal(url) : window.open(url, '_blank');
  }

  return (
    <div className="settings">
      <button className={'pill' + (codeReady ? ' ok' : '')} onClick={() => setOpen(true)} title="Settings & API keys">
        <span className="gear">⚙</span> Settings
        <span className={'pill-dot' + (codeReady ? ' ok' : '')} />
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Settings</h3>
              <button className="modal-x" onClick={() => setOpen(false)} title="Close">✕</button>
            </div>

            <div className="modal-body">
              {/* ============ AI CODE GENERATION ============ */}
              <section className="set-section">
                <h4>AI code generation</h4>
                <p className="muted small">
                  Use the <b>Forge3D Cloud base model</b> (no key, works instantly) — or pick any provider
                  below to use <b>your own model</b> (Gemini, Groq, Mistral, OpenRouter and GLM are free; paste a key).
                </p>

                <div className="prov-grid">
                  {CODE_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={'prov-card' + (codeProvider === p.id ? ' on' : '')}
                      onClick={() => chooseCodeProvider(p.id)}
                    >
                      <span className="prov-name">{p.name}</span>
                      <span className={'prov-tag ' + (p.tag === 'PAID' ? 'paid' : 'free')}>{p.tag}</span>
                      <span className="prov-model">{p.model}</span>
                      {(p.noKey || p.has) && <span className="prov-check">{p.noKey ? '•' : '✓ key'}</span>}
                    </button>
                  ))}
                </div>

                <div className="set-card">
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <b>{activeCode.name}</b>
                    <span className={'prov-tag ' + (activeCode.tag === 'PAID' ? 'paid' : 'free')}>{activeCode.tag}</span>
                    <span className="spacer" />
                    {!activeCode.noKey && (
                      <span className={'tok ' + (activeCode.has ? 'ok' : '')}>
                        {activeCode.has ? 'key saved ✓' : 'no key yet'}
                      </span>
                    )}
                  </div>
                  <p className="muted small">{activeCode.note}</p>

                  {activeCode.noKey ? (
                    <p className="muted small">Nothing to configure — switch to a real provider above for working code.</p>
                  ) : (
                    <>
                      <a className="link-btn" href={activeCode.url} onClick={(e) => openLink(e, activeCode.url)}>
                        ↗ Get a free key at {activeCode.urlLabel}
                      </a>
                      <div className="key-row">
                        <input
                          type="password"
                          placeholder={activeCode.placeholder}
                          value={keyInputs[activeCode.id] || ''}
                          onChange={(e) => setKeyInputs((k) => ({ ...k, [activeCode.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveCodeKey(activeCode); }}
                        />
                        <button className="btn primary" onClick={() => saveCodeKey(activeCode)}>Save key</button>
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* ============ ORCHESTRA AI ============ */}
              <section className="set-section">
                <h4>Orchestra AI (the director)</h4>
                <p className="muted small">
                  Orchestra builds whole projects: it plans, then conducts the other AIs and tests
                  the result in the Life Sim. Pick the <b>director</b> model that does the planning —
                  the free Forge3D Cloud base model works with no key.
                </p>
                <label className="lbl">Director model (reasoning)</label>
                <div className="prov-grid">
                  {CODE_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={'prov-card' + (orchestraDirector === p.id ? ' on' : '')}
                      onClick={() => chooseOrchestraDirector(p.id)}
                    >
                      <span className="prov-name">{p.name}</span>
                      <span className={'prov-tag ' + (p.tag === 'PAID' ? 'paid' : 'free')}>{p.tag}</span>
                      <span className="prov-model">{p.model}</span>
                      {(p.noKey || p.has) && <span className="prov-check">{p.noKey ? '•' : '✓ key'}</span>}
                    </button>
                  ))}
                </div>

                <label className="lbl">Vision (sees the 3D viewport)</label>
                <div className="set-card">
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <b>GLM-4.5V</b>
                    <span className="prov-tag free">FREE</span>
                    <span className="spacer" />
                    <span className={'tok ' + (hasHfToken ? 'ok' : '')}>{hasHfToken ? 'HF token ✓' : 'no HF token'}</span>
                  </div>
                  <p className="muted small">
                    Orchestra captures the viewport and asks GLM-4.5V "does this look right?" before moving on.
                    It runs through the Hugging Face router using your free HF token (set it under <b>3D model generator → Hugging Face</b> below).
                  </p>
                  {!hasHfToken && <p className="status">Without a token, Orchestra still builds — it just can't visually confirm steps.</p>}
                </div>

                <label className="lbl">Token headroom</label>
                <p className="muted small">Caps how much each run may spend so you can run Orchestra often. Eco = fewest tokens, Max = longest builds.</p>
                <div className="seg">
                  {[{ id: 'eco', l: 'Eco' }, { id: 'balanced', l: 'Balanced' }, { id: 'max', l: 'Max' }].map((o) => (
                    <button key={o.id} className={'seg-btn' + (orchestraHeadroom === o.id ? ' on' : '')} onClick={() => chooseHeadroom(o.id)}>{o.l}</button>
                  ))}
                </div>

                <label className="lbl">Let Claude control Forge3D (MCP plugin)</label>
                <p className="muted small">
                  Opens a <b>localhost-only</b> bridge so the Claude desktop/chat app can drive Forge3D
                  through the <code>forge3d-orchestra</code> MCP plugin — design 3D parts, wire circuits,
                  write firmware and run the Life Sim by chatting with Claude. Off by default.
                </p>
                <div className="set-card">
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <b>Control bridge</b>
                    <span className={'prov-tag ' + (bridgeEnabled ? 'free' : 'paid')}>{bridgeEnabled ? 'ON' : 'OFF'}</span>
                    <span className="spacer" />
                    <span className={'tok ' + (bridgeRunning ? 'ok' : '')}>
                      {bridgeEnabled ? (bridgeRunning ? `listening · 127.0.0.1:${bridgePort}` : 'starting…') : 'disabled'}
                    </span>
                  </div>
                  <div className="seg">
                    <button className={'seg-btn' + (!bridgeEnabled ? ' on' : '')} onClick={() => bridgeEnabled && toggleBridge()}>Off</button>
                    <button className={'seg-btn' + (bridgeEnabled ? ' on' : '')} onClick={() => !bridgeEnabled && toggleBridge()}>On</button>
                  </div>

                  {bridgeEnabled && (
                    <>
                      <p className="muted small" style={{ marginTop: 8 }}>
                        Add this to Claude Desktop's <code>claude_desktop_config.json</code> (or a project <code>.mcp.json</code>), then restart Claude:
                      </p>
                      <pre className="code-snippet" style={{ whiteSpace: 'pre-wrap', userSelect: 'all' }}>{
`"forge3d-orchestra": {
  "command": "node",
  "args": ["${bridgeServerPath || '<path-to-forge3d>/server/orchestra-mcp/index.mjs'}"]${bridgeToken ? `,
  "env": { "FORGE3D_BRIDGE_TOKEN": "${bridgeToken}" }` : ''}
}`}</pre>

                      <label className="lbl">Shared token (optional)</label>
                      <p className="muted small">
                        The bridge is already restricted to your machine. Add a token for an extra lock — both
                        sides must match (set <code>FORGE3D_BRIDGE_TOKEN</code> in the plugin config above).
                      </p>
                      {bridgeToken ? (
                        <div className="key-row">
                          <input type="text" readOnly value={bridgeToken} onFocus={(e) => e.target.select()} />
                          <button className="btn" onClick={() => copyText(bridgeToken)}>Copy</button>
                          <button className="btn" onClick={clearToken}>Clear</button>
                        </div>
                      ) : (
                        <button className="btn primary" onClick={generateToken}>Generate token</button>
                      )}
                    </>
                  )}
                </div>

                <label className="lbl">Forge3D Cloud — pair this app with the remote connector</label>
                <p className="muted small">
                  Lets the <b>hosted</b> Forge3D connector (the one listed in Claude's directory) drive <b>this</b>
                  running app — live 3D + Life Sim — from anywhere. The app dials <b>out</b> to your cloud server,
                  so there's no port to open. Without pairing, the cloud connector still designs in the cloud and
                  returns files. Off by default.
                </p>
                <div className="set-card">
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <b>Cloud pairing</b>
                    <span className={'prov-tag ' + (cloudPairEnabled ? 'free' : 'paid')}>{cloudPairEnabled ? 'ON' : 'OFF'}</span>
                    <span className="spacer" />
                    <span className={'tok ' + (cloudPairStatus === 'online' ? 'ok' : '')}>{cloudPairEnabled ? cloudPairStatus : 'disabled'}</span>
                  </div>
                  <label className="lbl">Cloud server URL</label>
                  <input type="text" placeholder="https://your-forge3d-cloud.example.com" value={cloudUrlInput} onChange={(e) => setCloudUrlInput(e.target.value)} />
                  <label className="lbl">Pairing token {hasCloudPairToken && <span className="muted small">— saved ✓ (leave blank to keep)</span>}</label>
                  <div className="key-row">
                    <input type="password" placeholder={hasCloudPairToken ? '•••••••• (unchanged)' : 'FORGE3D_PAIR_TOKEN'} value={cloudTokenInput} onChange={(e) => setCloudTokenInput(e.target.value)} />
                    {cloudPairEnabled ? (
                      <button className="btn" onClick={() => applyCloudPairing(false)}>Disconnect</button>
                    ) : (
                      <button className="btn primary" onClick={() => applyCloudPairing(true)}>Save &amp; connect</button>
                    )}
                  </div>
                  {cloudPairEnabled && <button className="btn" style={{ marginTop: 6 }} onClick={() => applyCloudPairing(true)}>Reconnect / apply changes</button>}
                </div>
              </section>

              {/* ============ APPEARANCE ============ */}
              <section className="set-section">
                <h4>Appearance</h4>
                <label className="lbl">Theme</label>
                <div className="seg">
                  {[{ id: 'dark', label: '🌙 Dark' }, { id: 'light', label: '☀️ Light' }].map((t) => (
                    <button key={t.id} className={'seg-btn' + (theme === t.id ? ' on' : '')} onClick={() => setTheme(t.id)}>{t.label}</button>
                  ))}
                </div>
                <label className="lbl">Interface size</label>
                <div className="seg">
                  {[{ v: 0.9, l: 'Compact' }, { v: 1, l: 'Default' }, { v: 1.1, l: 'Large' }, { v: 1.25, l: 'XL' }].map((o) => (
                    <button key={o.v} className={'seg-btn' + (uiZoom === o.v ? ' on' : '')} onClick={() => setUiZoom(o.v)}>{o.l}</button>
                  ))}
                </div>
                <label className="lbl">3D lighting — {Math.round(lightLevel * 100)}%</label>
                <input type="range" min="0.5" max="1.5" step="0.05" value={lightLevel}
                  onChange={(e) => setLightLevel(parseFloat(e.target.value))} />
                <p className="muted small">Affects the 3D Design viewport and the Life Simulator. Settings persist between sessions.</p>
              </section>

              {/* ============ API CREDITS ============ */}
              <section className="set-section">
                <h4>API credits remaining</h4>
                <p className="muted small">Free providers are unlimited (∞). Paid ones show your remaining balance where the provider exposes it.</p>
                <div className="credit-list">
                  {!usage ? (
                    <p className="muted small">Checking balances…</p>
                  ) : usage.length === 0 ? (
                    <p className="muted small">No providers to report.</p>
                  ) : (
                    usage.map((u) => (
                      <div key={u.id} className="credit-row">
                        <span className="credit-name">
                          {u.name}{!u.hasKey && <span className="muted"> · no key</span>}
                        </span>
                        <span className={'credit-val' + (u.remaining === '∞' ? ' inf' : '')}>{u.remaining}</span>
                        <span className="credit-note">{u.note}</span>
                        {u.url && <a className="link-btn credit-link" href={u.url} onClick={(e) => openLink(e, u.url)}>↗ console</a>}
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* ============ 3D MODEL GENERATOR ============ */}
              <section className="set-section">
                <h4>3D model generator</h4>
                <div className="seg">
                  {GEN_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={'seg-btn' + (provider === p.id ? ' on' : '')}
                      onClick={() => chooseGenProvider(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {provider === 'mock' && (
                  <p className="muted small">Free placeholder meshes — no account needed.</p>
                )}
                {provider === 'hf' && (
                  <div className="set-card">
                    <p className="muted small">
                      Free text-to-3D via the Shap-E Space. Needs a <b>free</b> Hugging Face token (read scope).
                    </p>
                    <a className="link-btn" href="https://huggingface.co/settings/tokens" onClick={(e) => openLink(e, 'https://huggingface.co/settings/tokens')}>
                      ↗ Get a token at huggingface.co
                    </a>
                    <div className="key-row">
                      <input type="password" placeholder="hf_…" value={hfToken} onChange={(e) => setHfToken(e.target.value)} />
                      <button className="btn primary" onClick={saveHf}>Save</button>
                    </div>
                    <span className={'tok ' + (hasHfToken ? 'ok' : '')}>{hasHfToken ? 'token saved ✓' : 'no token'}</span>
                  </div>
                )}
                {provider === 'meshy' && (
                  <div className="set-card">
                    <p className="muted small">High-quality, but Meshy's API is a paid plan ($20/mo+).</p>
                    <a className="link-btn" href="https://www.meshy.ai/api" onClick={(e) => openLink(e, 'https://www.meshy.ai/api')}>
                      ↗ Get a key at meshy.ai
                    </a>
                    <div className="key-row">
                      <input type="password" placeholder="msy_…" value={meshyKey} onChange={(e) => setMeshyKey(e.target.value)} />
                      <button className="btn primary" onClick={saveMeshy}>Save</button>
                    </div>
                    <span className={'tok ' + (hasMeshyKey ? 'ok' : '')}>{hasMeshyKey ? 'key saved ✓' : 'no key'}</span>
                  </div>
                )}
              </section>

              {/* ============ THINGIVERSE ============ */}
              <section className="set-section">
                <h4>Thingiverse search</h4>
                <div className="set-card">
                  <p className="muted small">Free model search & STL import. Needs a <b>free</b> Thingiverse app token.</p>
                  <a className="link-btn" href="https://www.thingiverse.com/developers" onClick={(e) => openLink(e, 'https://www.thingiverse.com/developers')}>
                    ↗ Register an app at thingiverse.com/developers
                  </a>
                  <div className="key-row">
                    <input type="password" placeholder="thingiverse app token" value={thingiToken} onChange={(e) => setThingiToken(e.target.value)} />
                    <button className="btn primary" onClick={saveThingi}>Save</button>
                  </div>
                  <span className={'tok ' + (hasThingiverseToken ? 'ok' : '')}>{hasThingiverseToken ? 'token saved ✓' : 'no token'}</span>
                </div>
              </section>

              {/* ============ EXPORT QUALITY ============ */}
              <section className="set-section">
                <h4>3D export quality</h4>
                <p className="muted small">Higher quality keeps more geometry detail (bigger files).</p>
                <div className="seg">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.id}
                      className={'seg-btn' + (exportQuality === q.id ? ' on' : '')}
                      onClick={() => setExportQuality(q.id)}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="modal-foot">
              <button className="btn primary" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
