import React, { useState } from 'react';
import { useStore } from '../../lib/store.js';
import markUrl from '../../assets/forge3d-mark.png';

// First screen on a fresh install: create an account or sign in — but skippable,
// because Forge3D is a local desktop tool and must keep working offline.
// Reuses window.forge.account.{signup,login} (same calls as SettingsButton).
export default function AuthGate() {
  const setMe = useStore((s) => s.setMe);
  const setShellView = useStore((s) => s.setShellView);
  const setOnboarding = useStore((s) => s.setOnboarding);

  const [mode, setMode] = useState('signup'); // signup | login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // After the gate, brand-new users go to the interactive tutorial. If they
  // somehow already finished it, skip straight ahead.
  function advance() {
    const seen = useStore.getState().tutorialSeen;
    setShellView(seen ? 'welcome' : 'tutorial');
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const fn = mode === 'signup' ? window.forge.account.signup : window.forge.account.login;
      const res = await fn({ email: email.trim(), password });
      // pull a fresh /me so plan + trial + storage land in the store
      const me = await window.forge.account.me().catch(() => res?.account ? { hasAccount: true, ...res.account } : null);
      setMe(me?.hasAccount ? me : (res?.account ? { hasAccount: true, ...res.account } : null));
      advance();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  function continueOffline() {
    setOnboarding({ authSkipped: true });
    window.forge.onboarding?.set({ authSkipped: true });
    setMe(null);
    advance();
  }

  return (
    <div className="onb-screen gate">
      <div className="onb-card">
        <img className="onb-logo" src={markUrl} alt="Forge3D" />
        <h1>Welcome to Forge3D</h1>
        <p className="onb-sub">Design 3D + electronics together, simulate, and export to fabricate.</p>

        <div className="seg onb-seg">
          <button className={'seg-btn' + (mode === 'signup' ? ' on' : '')} onClick={() => setMode('signup')}>Create account</button>
          <button className={'seg-btn' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>Sign in</button>
        </div>

        <label className="lbl">Email</label>
        <input className="onb-input" type="email" value={email} autoFocus
          placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <label className="lbl">Password</label>
        <input className="onb-input" type="password" value={password}
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />

        {error && <p className="onb-error">{error}</p>}

        <button className="btn primary full onb-primary" disabled={busy || !email || !password} onClick={submit}>
          {busy ? 'Please wait…' : (mode === 'signup' ? 'Create account →' : 'Sign in →')}
        </button>
        <p className="onb-note">
          A free account gives you <b>5,000 AI tokens/month</b>. You can also start a
          <b> 7-day free trial of everything</b> from the next screens.
        </p>

        <button className="onb-skip" onClick={continueOffline}>Continue offline — I'll sign in later</button>
      </div>
    </div>
  );
}
