import React, { useState } from 'react';
import { useStore } from '../../lib/store.js';
import { usePopover } from '../../lib/usePopover.js';

// Corner "Upgrade" button: opens a small plan popover offering F3D Cloud Pro
// ($5/mo — all cloud AIs) and F3D Storage ($3/mo — 500GB). Both route through
// the existing Stripe checkout in Electron main / the cloud-api server.
export default function UpgradeButton() {
  const me = useStore((s) => s.me);
  const { open, setOpen, ref } = usePopover();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [promo, setPromo] = useState('');

  const isPro = me?.plan === 'pro';
  const trial = me?.trial?.active;
  const hasStorage = me?.storage?.plan && me.storage.plan !== 'none';

  async function run(kind, promoCode) {
    setBusy(kind);
    setMsg('');
    try {
      if (!me?.hasAccount && !me?.email) throw new Error('Create a free account first (top-left of the welcome screen) to subscribe.');
      const res = kind === 'pro'
        ? await window.forge.account.checkout(promoCode ? { promoCode } : undefined)
        : await window.forge.account.checkoutStorage();
      setMsg(res?.opened ? 'Checkout opened in your browser — finish there and come back.' : 'Billing is not configured yet.');
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy('');
    }
  }

  async function manage() {
    setBusy('portal');
    try {
      const res = await window.forge.account.portal();
      setMsg(res?.opened ? 'Subscription portal opened in your browser.' : 'No subscription to manage yet.');
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setBusy(''); }
  }

  return (
    <div className="hd-connect" ref={ref}>
      <button className={'btn' + (isPro || trial ? '' : ' primary')} onClick={() => setOpen((o) => !o)}>
        {isPro ? '✦ Pro' : trial ? '✦ Trial active' : '✦ Upgrade'}
      </button>

      {open && (
        <div className="hd-pop">
          {trial && <p className="onb-note">Your free trial is active until {new Date(me.trial.endsAt).toLocaleDateString()}. Add a plan to keep the perks after it ends.</p>}

          <div className="hd-plan">
            <div>
              <b>F3D Cloud Pro</b> <span className="muted small">$5/month</span>
              <p className="muted small">All cloud AIs, generous cap, and no ads.</p>
            </div>
            {isPro
              ? <button className="btn" disabled={busy} onClick={manage}>Manage</button>
              : <button className="btn primary" disabled={busy === 'pro'} onClick={() => run('pro')}>{busy === 'pro' ? '…' : 'Upgrade'}</button>}
          </div>

          <div className="hd-plan">
            <div>
              <b>F3D Storage</b> <span className="muted small">$3/month · 500GB</span>
              <p className="muted small">Cloud space for projects and any files. More at the same rate.</p>
            </div>
            {hasStorage
              ? <button className="btn" disabled={busy} onClick={manage}>Manage</button>
              : <button className="btn primary" disabled={busy === 'storage'} onClick={() => run('storage')}>{busy === 'storage' ? '…' : 'Add'}</button>}
          </div>

          {!isPro && (
            <>
              <div className="divider" />
              <label className="lbl">Discount code</label>
              <div className="row">
                <input
                  className="onb-input" placeholder="e.g. LAUNCH90" value={promo}
                  onChange={(e) => setPromo(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && promo.trim() && run('pro', promo.trim())}
                />
                <button className="btn primary" disabled={busy === 'pro' || !promo.trim()} onClick={() => run('pro', promo.trim())}>
                  {busy === 'pro' ? '…' : 'Apply'}
                </button>
              </div>
              <p className="muted small" style={{ marginTop: 4 }}>Applies to F3D Cloud Pro at checkout.</p>
            </>
          )}

          {msg && <p className="onb-note">{msg}</p>}
        </div>
      )}
    </div>
  );
}
