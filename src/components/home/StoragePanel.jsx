import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.js';

const GB = 1024 ** 3;
const fmt = (b) => {
  if (!b || b < 0) return '0 GB';
  if (b < GB) return (b / 1024 ** 2).toFixed(0) + ' MB';
  return (b / GB).toFixed(b < 10 * GB ? 1 : 0) + ' GB';
};

// F3D Storage card. Two audiences share this panel:
//   • CUSTOMERS see their own quota and files, hosted on the operator's drives.
//   • the OPERATOR (whose Mac has the F3D_STORAGE USBs plugged in) additionally
//     sees total capacity across drives, how many customers are stored, and the
//     "plug in another USB" alert at 96 GB.
// Forge3D NEVER formats a drive — the operator prepares each one manually.
export default function StoragePanel() {
  const me = useStore((s) => s.me);
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [remote, setRemote] = useState(null); // { running, status } | null while loading

  const entitlement = me?.storage?.bytes || 500 * GB; // plan grant (default 500GB)
  const hasPlan = me?.storage?.plan && me.storage.plan !== 'none';

  async function refresh() {
    try { setSt(await window.forge.storage.status()); } catch (e) { setMsg(String(e?.message || e)); }
  }
  async function refreshRemote() {
    try { setRemote(await window.forge.storage.remoteStatus()); } catch { /* ignore */ }
  }
  useEffect(() => { refresh(); refreshRemote(); }, []);
  // poll remote status while the panel is open — the connection can flip while idle
  useEffect(() => {
    const id = setInterval(refreshRemote, 4000);
    return () => clearInterval(id);
  }, []);

  async function upgrade() {
    try {
      const res = await window.forge.account.checkoutStorage();
      setMsg(res?.opened ? 'Checkout opened in your browser.' : 'Billing is not configured yet.');
    } catch (e) { setMsg(String(e?.message || e)); }
  }

  // This machine is the storage HOST only when F3D_STORAGE drives are attached.
  // NOTHING about drives, hosting or local folders is ever shown to a customer —
  // they are buying space on someone else's hardware, exactly like any cloud
  // drive. Their view is: how much space you have, and where to reach it.
  const isHost = Boolean(st?.volumes?.length);
  const openWeb = (e) => { e?.preventDefault?.(); window.forge.openExternal?.('https://forge3d.design/storage'); };
  const openGuide = (e) => { e?.preventDefault?.(); window.forge.openExternal?.('https://forge3d.design/guide'); };

  // ---------------- OPERATOR (this Mac serves the customers) ----------------
  if (isHost) {
    const used = st.usedBytes || 0;
    const cap = st.capacityBytes || 1;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    const alertPct = st.alertAtBytes ? Math.min(100, (st.alertAtBytes / cap) * 100) : null;
    return (
      <section className="hd-storage card">
        <div className="hd-storage-head">
          <h3>☁ F3D Storage</h3>
          <span className={'badge ' + (st.needsAnotherDrive ? '' : 'orc-badge-done')}>
            HOST · {st.volumes.length} drive{st.volumes.length > 1 ? 's' : ''} · {st.customers} customer{st.customers === 1 ? '' : 's'}
          </span>
        </div>

        <div className="stor-meter">
          <div className="stor-fill" style={{ width: pct + '%' }} />
          {alertPct != null && <div className="stor-mark" style={{ left: alertPct + '%' }} title="Add-another-drive alert at 96 GB" />}
        </div>
        <p className="muted small">{fmt(used)} used of {fmt(cap)} across {st.volumes.map((v) => v.name).join(', ')}</p>

        {/* Status only. Every how-to (preparing drives, adding one, power-cut
            settings) lives in the operator guide on the site — the panel is not
            a manual. */}
        {st.needsAnotherDrive && (
          <p className="onb-note" style={{ color: 'var(--danger)' }}>
            ⚠ Running low on space — <a href="https://forge3d.design/guide" onClick={openGuide}>see the guide</a>
          </p>
        )}

        <p className="muted small" style={{ marginTop: 8 }}>
          <span className={'hd-dot ' + (remote?.status === 'hosting' ? 'on' : remote?.running ? 'wait' : 'off')} />
          {remote?.status === 'hosting' ? 'Serving customers'
            : remote?.status === 'unreachable' ? 'Reconnecting…'
            : remote?.status === 'signed-out' ? 'Sign in to serve customers'
            : 'Connecting…'}
        </p>

        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={refresh}>Refresh</button>
          <button className="btn" onClick={openGuide}>Operator guide →</button>
        </div>
        {msg && <p className="onb-note">{msg}</p>}
      </section>
    );
  }

  // ---------------- CUSTOMER (their space is hosted for them) ----------------
  return (
    <section className="hd-storage card">
      <div className="hd-storage-head">
        <h3>☁ F3D Storage</h3>
        {hasPlan
          ? <span className="badge orc-badge-done">ACTIVE · {fmt(entitlement)}</span>
          : <span className="badge">$3/mo · 500GB</span>}
      </div>

      {hasPlan ? (
        <>
          <p className="muted small">
            {fmt(entitlement)} of cloud storage for your projects and files, included with your plan.
          </p>
          <div className="row">
            <button className="btn primary" onClick={(e) => openWeb(e)}>Open my storage</button>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Reach your files from any device at{' '}
            <a href="https://forge3d.design/storage" onClick={openWeb}>forge3d.design/storage</a>.
          </p>
        </>
      ) : (
        <>
          <p className="muted small">
            Cloud storage for your projects, models and exports — reachable from any device,
            nothing to set up.
          </p>
          <div className="row">
            <button className="btn primary" onClick={upgrade}>Get F3D Storage — $3/mo</button>
          </div>
        </>
      )}

      {msg && <p className="onb-note">{msg}</p>}
    </section>
  );
}
