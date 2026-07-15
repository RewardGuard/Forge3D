import React, { useEffect, useState } from 'react';
import { useStore } from '../../lib/store.js';

// A very small strip pinned to the bottom. Local "house ads" only (no external ad
// network — no tracking, no network calls). Vanishes the moment the user is
// entitled (Pro or an active trial).
const ADS = [
  { text: '✦ Go Pro — every cloud AI, zero ads.', cta: 'Upgrade $5/mo', plan: 'pro' },
  { text: '☁ F3D Storage — 500GB for your builds.', cta: 'Get storage $3/mo', plan: 'storage' },
  { text: '🤖 Let Claude build for you — Connect to Claude.', cta: 'Learn how', plan: null },
];

export default function AdStrip() {
  const entitled = useStore((s) => s.entitled);
  const adsEnabled = useStore((s) => s.adsEnabled);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (entitled || !adsEnabled) return;
    const id = setInterval(() => setI((n) => (n + 1) % ADS.length), 9000);
    return () => clearInterval(id);
  }, [entitled, adsEnabled]);

  if (entitled || !adsEnabled) return null;
  const ad = ADS[i];

  async function act() {
    if (ad.plan === 'pro') { try { await window.forge.account.checkout(); } catch { /* no-op */ } }
    else if (ad.plan === 'storage') { try { await window.forge.account.checkoutStorage(); } catch { /* no-op */ } }
  }

  return (
    <div className="ad-strip" title="This strip disappears with F3D Cloud Pro">
      <span className="ad-label">AD</span>
      <span className="ad-text">{ad.text}</span>
      <button className="ad-cta" onClick={act}>{ad.cta}</button>
    </div>
  );
}
