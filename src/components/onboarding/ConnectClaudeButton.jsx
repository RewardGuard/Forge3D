import React, { useState } from 'react';
import { useStore } from '../../lib/store.js';

// Corner button that opens the localhost MCP bridge so the Claude desktop/chat
// app can drive Forge3D. Mirrors the bridge control in SettingsButton, surfaced
// on the Home dashboard as a one-click "Connect to Claude".
export default function ConnectClaudeButton() {
  const bridgeEnabled = useStore((s) => s.bridgeEnabled);
  const bridgeRunning = useStore((s) => s.bridgeRunning);
  const bridgePort = useStore((s) => s.bridgePort);
  const bridgeToken = useStore((s) => s.bridgeToken);
  const bridgeServerPath = useStore((s) => s.bridgeServerPath);
  const setBridgeEnabled = useStore((s) => s.setBridgeEnabled);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    const next = !bridgeEnabled;
    const res = await window.forge.config.setBridgeEnabled(next);
    setBridgeEnabled(Boolean(res?.bridgeEnabled ?? next), Boolean(res?.running));
    if (next) setOpen(true);
  }

  const snippet = `{
  "mcpServers": {
    "forge3d": {
      "command": "node",
      "args": ["${bridgeServerPath || '<path-to-forge3d>/server/orchestra-mcp/index.mjs'}"]${bridgeToken ? `,
      "env": { "FORGE3D_BRIDGE_TOKEN": "${bridgeToken}" }` : ''}
    }
  }
}`;

  function copy() {
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="hd-connect">
      <button className={'btn' + (bridgeRunning ? ' primary' : '')} onClick={() => (bridgeEnabled ? setOpen((o) => !o) : toggle())}>
        <span className={'hd-dot ' + (bridgeRunning ? 'on' : bridgeEnabled ? 'wait' : 'off')} />
        {bridgeRunning ? 'Connected to Claude' : bridgeEnabled ? 'Starting…' : 'Connect to Claude'}
      </button>

      {open && (
        <div className="hd-pop" onMouseLeave={() => setOpen(false)}>
          <div className="hd-pop-row">
            <b>Claude control bridge</b>
            <span className={'prov-tag ' + (bridgeEnabled ? 'free' : 'paid')}>{bridgeEnabled ? 'ON' : 'OFF'}</span>
          </div>
          <p className="muted small">
            {bridgeEnabled
              ? `Listening on 127.0.0.1:${bridgePort}. Add this to your Claude MCP config, then ask Claude to “design a sumo robot”.`
              : 'Opens a localhost-only bridge so Claude can build in your live app.'}
          </p>
          {bridgeEnabled && (
            <>
              <pre className="hd-code">{snippet}</pre>
              <div className="row">
                <button className="btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy config'}</button>
                <button className="btn danger" onClick={toggle}>Turn off</button>
              </div>
            </>
          )}
          {!bridgeEnabled && <button className="btn primary full" onClick={toggle}>Turn on the bridge</button>}
        </div>
      )}
    </div>
  );
}
