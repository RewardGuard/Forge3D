import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.js';

const GB = 1024 ** 3;
const fmt = (b) => {
  if (!b || b < 0) return '0 GB';
  if (b < GB) return (b / 1024 ** 2).toFixed(0) + ' MB';
  return (b / GB).toFixed(b < 10 * GB ? 1 : 0) + ' GB';
};

// F3D Storage card: local-volume backed cloud space (the "F3D Storage" USB). Shows
// a usage meter (used / entitlement), lets the user add files, and points at the
// $3/mo plan. NEVER formats the drive — setup instructions are manual.
export default function StoragePanel() {
  const me = useStore((s) => s.me);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
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

  async function toggleRemote() {
    setBusy(true);
    try {
      const next = !(remote?.running);
      const res = await window.forge.storage.setRemoteEnabled(next);
      setRemote(res);
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function addFiles() {
    setBusy(true);
    setMsg('');
    try {
      const res = await window.forge.storage.add();
      if (res?.ok) { setMsg(`Added ${res.count || 0} file(s) to F3D Storage.`); refresh(); }
      else if (res?.canceled) { /* no-op */ }
      else setMsg(res?.error || 'Could not add files.');
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  }

  async function upgrade() {
    try {
      const res = await window.forge.account.checkoutStorage();
      setMsg(res?.opened ? 'Checkout opened in your browser.' : 'Billing is not configured yet.');
    } catch (e) { setMsg(String(e?.message || e)); }
  }

  const used = st?.usedBytes || 0;
  // the meter fills against the plan grant, but can never exceed the physical disk
  const cap = Math.min(entitlement, st?.capacityBytes || entitlement) || entitlement;
  const pct = Math.min(100, Math.round((used / cap) * 100));

  return (
    <section className="hd-storage card">
      <div className="hd-storage-head">
        <h3>☁ F3D Storage</h3>
        {hasPlan
          ? <span className="badge orc-badge-done">ACTIVE · {fmt(entitlement)}</span>
          : <span className="badge">$3/mo · 500GB</span>}
      </div>

      <div className="stor-meter"><div className="stor-fill" style={{ width: pct + '%' }} /></div>
      <p className="muted small">{fmt(used)} used of {fmt(cap)} {st?.present ? '' : '(volume not connected)'}</p>

      {!st?.present && (
        <div className="stor-setup">
          <b>Set up your F3D Storage volume</b>
          <ol className="muted small">
            <li>Plug in the drive you want to dedicate.</li>
            <li>In <b>Disk Utility</b>, erase it and name it exactly <code>F3D Storage</code>.</li>
            <li>Reopen this panel — Forge3D detects <code>/Volumes/F3D Storage</code> automatically.</li>
          </ol>
          <p className="muted small">Forge3D never formats a drive for you — you stay in control of your disks.</p>
        </div>
      )}

      <div className="row">
        <button className="btn" disabled={busy || !st?.present} onClick={addFiles}>{busy ? 'Copying…' : '＋ Add files'}</button>
        {st?.present && <button className="btn" onClick={() => window.forge.storage.reveal()}>Reveal in Finder</button>}
        {!hasPlan && <button className="btn primary" onClick={upgrade}>Get F3D Storage</button>}
        <button className="btn" onClick={refresh}>Refresh</button>
      </div>

      <div className="divider" />
      <div className="hd-storage-head">
        <b>Remote access</b>
        {hasPlan ? (
          <span className={'badge ' + (remote?.running ? 'orc-badge-done' : '')}>
            {remote?.status === 'online' ? 'ONLINE' : remote?.running ? remote?.status?.toUpperCase() : 'OFF'}
          </span>
        ) : <span className="badge">included with the plan</span>}
      </div>
      {hasPlan ? (
        <>
          <p className="muted small">
            Turns THIS Mac into your personal cloud server — reach these files from your phone or
            any other device at <a href="https://forge3d.design/storage" onClick={(e) => { e.preventDefault(); window.forge.openExternal?.('https://forge3d.design/storage'); }}>forge3d.design/storage</a>.
            Files never leave your disk — this only opens a secure, sign-in-only tunnel to it. 10MB max per file.
          </p>
          <button className="btn" disabled={busy} onClick={toggleRemote}>
            {remote?.running ? 'Turn off remote access' : 'Turn on remote access'}
          </button>
        </>
      ) : (
        <p className="muted small">Upgrade to reach these files remotely from another device, from anywhere.</p>
      )}

      {msg && <p className="onb-note">{msg}</p>}
    </section>
  );
}
