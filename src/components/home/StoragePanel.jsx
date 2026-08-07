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

  // This machine is the storage HOST when F3D_STORAGE drives are attached.
  const isHost = Boolean(st?.volumes?.length);
  const used = st?.usedBytes || 0;
  // customers fill against their plan grant; the operator against real hardware
  const cap = isHost ? (st.capacityBytes || 1) : (Math.min(entitlement, st?.capacityBytes || entitlement) || entitlement);
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const alertPct = isHost && st?.alertAtBytes ? Math.min(100, (st.alertAtBytes / cap) * 100) : null;

  return (
    <section className="hd-storage card">
      <div className="hd-storage-head">
        <h3>☁ F3D Storage</h3>
        {isHost
          ? <span className={'badge ' + (st.needsAnotherDrive ? '' : 'orc-badge-done')}>
              HOST · {st.volumes.length} drive{st.volumes.length > 1 ? 's' : ''} · {st.customers} customer{st.customers === 1 ? '' : 's'}
            </span>
          : hasPlan
            ? <span className="badge orc-badge-done">ACTIVE · {fmt(entitlement)}</span>
            : <span className="badge">$3/mo · 500GB</span>}
      </div>

      <div className="stor-meter">
        <div className="stor-fill" style={{ width: pct + '%' }} />
        {alertPct != null && <div className="stor-mark" style={{ left: alertPct + '%' }} title="Buy-another-drive alert at 96 GB" />}
      </div>
      <p className="muted small">
        {fmt(used)} used of {fmt(cap)}
        {isHost ? ` across ${st.volumes.map((v) => v.name).join(', ')}` : (st?.present ? '' : ' (hosted)')}
      </p>

      {/* OPERATOR: capacity alert — time to plug in another USB */}
      {isHost && st.needsAnotherDrive && (
        <div className="stor-setup" style={{ borderColor: 'var(--danger)' }}>
          <b>⚠ Drives are filling up — add another</b>
          <p className="muted small">
            You've passed {fmt(st.alertAtBytes)} across your drives. Plug in another USB and name it
            exactly <code>F3D_STORAGE_2</code> (then <code>_3</code>, and so on). New uploads
            automatically go to whichever drive has the most free space.
          </p>
        </div>
      )}

      {/* No drives attached: this Mac is not hosting */}
      {!isHost && (
        <div className="stor-setup">
          <b>Host F3D Storage on this Mac</b>
          <ol className="muted small">
            <li>Plug in the USB drive you want to dedicate.</li>
            <li>In <b>Disk Utility</b>, erase it and name it exactly <code>F3D_STORAGE</code>.</li>
            <li>Reopen this panel — Forge3D finds <code>/Volumes/F3D_STORAGE</code> automatically.</li>
          </ol>
          <p className="muted small">Forge3D never formats a drive for you — you stay in control of your disks.</p>
        </div>
      )}

      <div className="row">
        <button className="btn" disabled={busy || !st?.present} onClick={addFiles}>{busy ? 'Copying…' : '＋ Add files'}</button>
        {st?.present && <button className="btn" onClick={() => window.forge.storage.reveal()}>Reveal in Finder</button>}
        {!hasPlan && !isHost && <button className="btn primary" onClick={upgrade}>Get F3D Storage</button>}
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
      {isHost ? (
        <>
          <p className="muted small">
            Serve your customers' F3D Storage from this Mac. Their files land in isolated folders on
            your drives; they reach them at <a href="https://forge3d.design/storage" onClick={(e) => { e.preventDefault(); window.forge.openExternal?.('https://forge3d.design/storage'); }}>forge3d.design/storage</a>.
            Keep this Mac awake and online — when it's off, customers see "temporarily offline" and no data is lost.
          </p>
          <button className="btn" disabled={busy} onClick={toggleRemote}>
            {remote?.running ? 'Stop hosting' : 'Start hosting'}
          </button>
        </>
      ) : hasPlan ? (
        <p className="muted small">
          Your files are hosted for you — reach them from any device at{' '}
          <a href="https://forge3d.design/storage" onClick={(e) => { e.preventDefault(); window.forge.openExternal?.('https://forge3d.design/storage'); }}>forge3d.design/storage</a>. 10MB max per file.
        </p>
      ) : (
        <p className="muted small">Upgrade to get hosted storage you can reach from any device, anywhere.</p>
      )}

      {msg && <p className="onb-note">{msg}</p>}
    </section>
  );
}
