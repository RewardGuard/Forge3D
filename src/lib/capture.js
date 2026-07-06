// Grab a PNG/JPEG of the live 3D viewport so the Orchestra director can SEE its
// own work and confirm it before moving on. Reads the active WebGL canvas
// directly (both the Design and Life Sim Canvases run with
// preserveDrawingBuffer: true, required for toDataURL to return real pixels).
//
// Headroom: the image is downscaled and JPEG-compressed before it ever reaches a
// model. A 384–768px frame is plenty for "does this look like a car?" and keeps
// the vision call cheap — the whole point of letting users run Orchestra a lot.

const MAX_W = { eco: 384, balanced: 512, max: 768 };
const QUALITY = { eco: 0.55, balanced: 0.7, max: 0.82 };

// Find the canvas that's actually on screen. The app mounts one Canvas per tab,
// but a hidden/old one can linger — prefer the largest visible canvas.
function activeCanvas() {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  const visible = canvases.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && c.offsetParent !== null;
  });
  visible.sort((a, b) => b.width * b.height - a.width * a.height);
  return visible[0] || canvases[0] || null;
}

// Wait for a painted frame — but NEVER hang: rAF doesn't fire at all in a
// hidden/throttled page, so a timeout backstop degrades to "capture what's
// there" instead of blocking the caller forever.
const nextFrame = () => new Promise((resolve) => {
  const t = setTimeout(resolve, 120);
  try { requestAnimationFrame(() => { clearTimeout(t); resolve(); }); } catch { /* keep the timeout */ }
});

// Like captureViewport, but guarantees the pixels are CURRENT: nudges the
// renderer (resize invalidates react-three-fiber) and waits two painted frames
// before reading. Without this, a canvas that stopped painting (tab switch, or
// an occluded window) returns the same stale frame forever — the "frozen
// screenshot" a remote Claude hit while driving the app from behind its window.
export async function captureViewportFresh(headroom = 'balanced') {
  try { window.dispatchEvent(new Event('resize')); } catch { /* no-op */ }
  await nextFrame();
  await nextFrame();
  return captureViewport(headroom);
}

// Returns { dataUrl, w, h } or null when no canvas is available (e.g. browser
// preview before a Canvas mounts). headroom ∈ {eco, balanced, max}.
export function captureViewport(headroom = 'balanced') {
  const src = activeCanvas();
  if (!src) return null;
  try {
    const maxW = MAX_W[headroom] || MAX_W.balanced;
    const scale = Math.min(1, maxW / src.width);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    // flat backdrop so transparent areas don't read as black to the model
    ctx.fillStyle = '#0e1116';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const dataUrl = off.toDataURL('image/jpeg', QUALITY[headroom] || 0.7);
    return { dataUrl, w, h };
  } catch {
    // tainted canvas or context loss — fail soft, the director degrades to
    // text-only reasoning rather than crashing the run.
    return null;
  }
}
