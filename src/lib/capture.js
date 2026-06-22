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
