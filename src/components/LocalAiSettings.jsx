// AI mode + local server settings. Cloud / Local / Hybrid, discovery of what
// is running on this machine, and the model to use.
import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';

const MODES = [
  { id: 'cloud',  label: 'Cloud',  detail: 'Forge3D Cloud or your own API keys. Nothing runs on this machine.' },
  { id: 'local',  label: 'Local',  detail: 'ONLY a model on this machine. No keys, no allowance, nothing leaves your computer. If it is down, AI is down.' },
  { id: 'hybrid', label: 'Hybrid', detail: 'Local first; if it is down or empty, the cloud/keyed model answers — and each result says which one did.' },
];

export default function LocalAiSettings() {
  const aiMode = useStore((s) => s.aiMode);
  const localAiUrl = useStore((s) => s.localAiUrl);
  const localAiModel = useStore((s) => s.localAiModel);
  const setLocalAi = useStore((s) => s.setLocalAi);
  const [servers, setServers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(localAiUrl);

  useEffect(() => { setUrl(localAiUrl); }, [localAiUrl]);

  async function save(patch) {
    const r = await window.forge.config.setLocalAi(patch);
    setLocalAi({ aiMode: r.aiMode, localAiUrl: r.localAiUrl, localAiModel: r.localAiModel });
  }
  async function detect() {
    setBusy(true);
    try {
      const d = await window.forge.localAi.discover();
      setServers(d.servers);
      const up = d.servers.find((s) => s.up);
      setLocalAi({ localAiUp: Boolean(up) });
      // zero-config: adopt the first live server if nothing is set to a live one
      if (up && !d.servers.some((s) => s.up && s.url === localAiUrl)) await save({ localAiUrl: up.url, localAiModel: up.models[0] || '' });
    } finally { setBusy(false); }
  }
  useEffect(() => { detect(); }, []);

  const live = servers?.find((s) => s.url === localAiUrl && s.up);
  const models = live?.models || [];

  return (
    <>
      <label className="lbl">AI mode</label>
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.id} className={'seg-btn' + (aiMode === m.id ? ' on' : '')} title={m.detail} onClick={() => save({ aiMode: m.id })}>{m.label}</button>
        ))}
      </div>
      <p className="muted small">{MODES.find((m) => m.id === aiMode)?.detail}</p>

      {(aiMode === 'local' || aiMode === 'hybrid') && (
        <div className="set-card">
          <div className="row">
            <b>Local server</b>
            <button className="btn ghost" disabled={busy} onClick={detect}>{busy ? 'Detecting…' : '⟳ Detect'}</button>
          </div>
          {servers && (
            <ul className="lai-list">
              {servers.map((s) => (
                <li key={s.id} className={s.up ? 'up' : 'down'}>
                  <button className="link" onClick={() => s.up && save({ localAiUrl: s.url, localAiModel: s.models[0] || '' })} disabled={!s.up}>
                    {s.up ? '●' : '○'} {s.name} <span className="muted small">{s.url}</span>
                  </button>
                  <span className="muted small">{s.up ? `${s.models.length} model${s.models.length === 1 ? '' : 's'} loaded` : 'not running'}</span>
                </li>
              ))}
            </ul>
          )}
          <label className="lbl">Endpoint <span className="muted">(OpenAI-compatible /v1)</span></label>
          <div className="row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== localAiUrl && save({ localAiUrl: url })} placeholder="http://localhost:1234/v1" style={{ flex: 1 }} />
          </div>
          <label className="lbl">Model</label>
          {models.length ? (
            <select value={localAiModel || models[0]} onChange={(e) => save({ localAiModel: e.target.value })}>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={localAiModel} onChange={(e) => setLocalAi({ localAiModel: e.target.value })} onBlur={() => save({ localAiModel })} placeholder="leave empty = first loaded model" />
          )}
          {!live && servers && (
            <p className="status error small">Nothing is answering at {localAiUrl}. Open LM Studio and start its server (Developer → Start Server), or run <code>ollama serve</code>.</p>
          )}
          {live && <p className="muted small">Using <b>{localAiModel || models[0]}</b> on {live.name}. No key, no allowance — every token is computed here.</p>}
          <p className="muted small">Small local models are weaker at strict JSON than Claude. The validators still check every result, so a bad plan is refused rather than applied — but expect more refusals.</p>
        </div>
      )}
    </>
  );
}
