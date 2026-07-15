import React, { useState } from 'react';
import { useStore } from '../../lib/store.js';
import markUrl from '../../assets/forge3d-mark.png';

const PERKS = [
  { icon: '✦', title: 'Orchestra AI director', body: 'Describe a project in one sentence — Orchestra plans it, builds the geometry, wires the electronics, and tests it in the sim.' },
  { icon: '◈', title: 'Design + electronics together', body: 'Model parts and lay out circuits side by side, at real millimetre scale.' },
  { icon: '▶', title: 'Simulate before you build', body: 'Power the circuit, run the firmware, and watch real-world physics in the Life Sim.' },
  { icon: '⤓', title: 'Export to fabricate', body: 'One click to STL for printing, a sticker-circuit SVG, and a bill of materials.' },
];

// Shown once, after the interactive tutorial: the pitch + a friction-free 7-day
// trial of everything (no card required — see startTrial in Electron main).
export default function WelcomeAnnouncement() {
  const setShellView = useStore((s) => s.setShellView);
  const setOnboarding = useStore((s) => s.setOnboarding);
  const setMe = useStore((s) => s.setMe);
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const alreadyEntitled = me?.plan === 'pro' || me?.trial?.active;

  function enter() {
    setOnboarding({ onboarded: true });
    window.forge.onboarding?.set({ onboarded: true });
    setShellView('home');
  }

  async function startTrial() {
    setBusy(true);
    setMsg('');
    try {
      const res = await window.forge.account.startTrial();
      const me2 = await window.forge.account.me().catch(() => null);
      setMe(me2?.hasAccount ? me2 : (res?.hasAccount ? res : me));
      setMsg('🎉 Your 7-day free trial of everything is active — enjoy!');
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onb-screen welcome">
      <div className="onb-hero">
        <img className="onb-logo" src={markUrl} alt="Forge3D" />
        <h1>Forge3D turns an idea into a printable, wired-up product.</h1>
        <p className="onb-sub">The maker studio where 3D design, electronics, simulation and AI live in one place.</p>
      </div>

      <div className="onb-perks">
        {PERKS.map((p) => (
          <div key={p.title} className="onb-perk">
            <span className="onb-perk-ico">{p.icon}</span>
            <div>
              <b>{p.title}</b>
              <p>{p.body}</p>
            </div>
          </div>
        ))}
      </div>

      {!alreadyEntitled && (
        <div className="onb-trial">
          <div>
            <b>Try everything free for 7 days</b>
            <p className="muted small">All cloud AIs, F3D Storage and no ads. No card, activates instantly.</p>
          </div>
          <button className="btn primary" disabled={busy} onClick={startTrial}>
            {busy ? 'Activating…' : 'Start free trial'}
          </button>
        </div>
      )}
      {msg && <p className="onb-note center">{msg}</p>}

      <button className="btn primary full onb-primary" onClick={enter}>Enter Forge3D →</button>
    </div>
  );
}
