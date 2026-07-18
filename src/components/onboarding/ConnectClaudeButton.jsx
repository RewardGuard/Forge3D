import React, { useState } from 'react';
import { useStore } from '../../lib/store.js';

// Corner "Connect to Claude" button. Leads with the EASIEST path — the one-click
// online connector from forge3d.design (Claude designs via the hosted server, no
// setup) — and keeps the localhost bridge as an advanced "drive this live app"
// option for people who want the build to appear in their open viewport.
export default function ConnectClaudeButton() {
  const bridgeEnabled = useStore((s) => s.bridgeEnabled);
  const bridgeRunning = useStore((s) => s.bridgeRunning);
  const bridgePort = useStore((s) => s.bridgePort);
  const setBridgeEnabled = useStore((s) => s.setBridgeEnabled);

  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function toggleBridge() {
    const next = !bridgeEnabled;
    const res = await window.forge.config.setBridgeEnabled(next);
    setBridgeEnabled(Boolean(res?.bridgeEnabled ?? next), Boolean(res?.running));
  }

  function getConnector() {
    window.forge.openExternal?.('https://forge3d.design/download/forge3d-cloud.mcpb');
  }

  return (
    <div className="hd-connect">
      <button className={'btn' + (bridgeRunning ? ' primary' : '')} onClick={() => setOpen((o) => !o)}>
        <span className={'hd-dot ' + (bridgeRunning ? 'on' : 'off')} />
        {bridgeRunning ? 'Connected (live app)' : 'Connect to Claude'}
      </button>

      {open && (
        <div className="hd-pop" onMouseLeave={() => setOpen(false)}>
          {/* EASIEST — the online one-click connector */}
          <div className="hd-pop-row"><b>Connect to Claude Desktop</b><span className="prov-tag free">EASIEST</span></div>
          <p className="muted small">
            Get the one-click connector and drop it into Claude Desktop — Claude designs for you
            through the Forge3D online server. No account, no API key, no setup.
          </p>
          <button className="btn primary full" onClick={getConnector}>⬇ Get the Claude connector</button>
          <p className="muted small" style={{ marginTop: 6 }}>
            Double-click the downloaded <code>.mcpb</code> → Install in Claude Desktop → it appears under <b>+ → Connectors</b>.
          </p>

          <div className="divider" />

          {/* ADVANCED — drive THIS live app via the localhost bridge */}
          <button className="linkish" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '▾' : '▸'} Advanced: drive THIS live app
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 6 }}>
              <p className="muted small">
                Opens a localhost-only bridge so Claude builds right in your open viewport.
                Turn it on, then use the connector above.
              </p>
              <div className="hd-pop-row">
                <span className={'tok ' + (bridgeRunning ? 'ok' : '')}>
                  {bridgeEnabled ? (bridgeRunning ? `listening · 127.0.0.1:${bridgePort}` : 'starting…') : 'off'}
                </span>
                <button className={'btn' + (bridgeEnabled ? ' danger' : ' primary')} onClick={toggleBridge}>
                  {bridgeEnabled ? 'Turn off' : 'Turn on'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
