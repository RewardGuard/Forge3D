// The lit face of a display part: a texture rendered from the firmware's
// display calls, laid on the part's top surface. This is what point 2 of the
// professional-CAD spec asked for — a screen should show what it would show.
//
// Values come from the firmware's own declarations and the sim's inputs.
// Anything unresolvable renders as [name], and the material carries the
// "display simulation" note so nobody mistakes it for an emulator.
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../lib/store.js';
import { renderScreen, framebufferToImageData, extractDeclaredValues, hasScreen, screenSpec } from '../lib/screenSim.js';

// Nearest-neighbour upscale so a 128×64 OLED reads as pixels, not a blur.
function scaleFor(spec) {
  if (spec.mode !== 'gfx') return 4;
  const longest = Math.max(spec.w, spec.h);
  return longest <= 64 ? 8 : longest <= 160 ? 4 : longest <= 400 ? 2 : 1;
}

export function useScreenTexture(mesh) {
  const codeByNode = useStore((s) => s.codeByNode);
  const inputs = useStore((s) => s.inputs);
  const partId = mesh?.partId;

  return useMemo(() => {
    if (!partId || !hasScreen(partId)) return null;
    // One MCU drives the display; use the first sketch that mentions it, else any.
    const spec = screenSpec(partId);
    const objRe = new RegExp(`\\b(${spec.obj.join('|')})\\s*[.\\-]`);
    const sketches = Object.values(codeByNode || {}).filter(Boolean);
    const code = sketches.find((c) => objRe.test(c)) || sketches[0] || '';

    const values = { ...extractDeclaredValues(code) };
    for (const [id, v] of Object.entries(inputs || {})) {
      if (typeof v === 'number') values[id] = v;
      else if (v && typeof v === 'object') for (const [k, n] of Object.entries(v)) if (typeof n === 'number') values[`${id}_${k}`] = n;
    }

    const r = renderScreen(partId, code, values);
    if (!r.ok) return null;
    const scale = scaleFor(r.spec);
    const img = framebufferToImageData(r.fb, scale);
    const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.flipY = true;
    tex.needsUpdate = true;
    return { tex, note: r.note, calls: r.calls, unsupported: r.unsupported, hasCode: Boolean(code) };
  }, [partId, codeByNode, inputs]);
}

export default function ScreenFace({ mesh }) {
  const screen = useScreenTexture(mesh);
  if (!screen) return null;
  const [w, h, d] = mesh.size || [0.1, 0.02, 0.1];
  // Active area is ~92% of the module — the rest is bezel/PCB.
  const aw = w * 0.92, ad = d * 0.92;
  return (
    <mesh position={[0, h / 2 + 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[aw, ad]} />
      <meshBasicMaterial map={screen.tex} toneMapped={false} />
    </mesh>
  );
}

// Inspector preview: the same framebuffer on a 2D canvas, plus the note that
// says what this is and what it is not.
export function ScreenPreview({ mesh }) {
  const codeByNode = useStore((s) => s.codeByNode);
  const inputs = useStore((s) => s.inputs);
  const ref = React.useRef(null);
  const partId = mesh?.partId;

  const result = useMemo(() => {
    if (!partId || !hasScreen(partId)) return null;
    const spec = screenSpec(partId);
    const objRe = new RegExp(`\\b(${spec.obj.join('|')})\\s*[.\\-]`);
    const sketches = Object.values(codeByNode || {}).filter(Boolean);
    const code = sketches.find((c) => objRe.test(c)) || sketches[0] || '';
    const values = { ...extractDeclaredValues(code) };
    for (const [id, v] of Object.entries(inputs || {})) if (typeof v === 'number') values[id] = v;
    const r = renderScreen(partId, code, values);
    return r.ok ? { ...r, hasCode: Boolean(code) } : null;
  }, [partId, codeByNode, inputs]);

  React.useEffect(() => {
    if (!ref.current || !result) return;
    const scale = scaleFor(result.spec);
    const img = framebufferToImageData(result.fb, Math.min(scale, 4));
    const c = ref.current;
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  }, [result]);

  if (!result) return null;
  return (
    <>
      <div className="divider" />
      <label className="lbl">Screen <span className="muted">(display simulation)</span></label>
      <canvas ref={ref} style={{ width: '100%', imageRendering: 'pixelated', border: '1px solid var(--line)', borderRadius: 4, background: '#000' }} />
      {!result.hasCode && <p className="muted small">No firmware yet — generate code for the microcontroller and the screen will show what it draws.</p>}
      <p className="muted small">{result.note}</p>
      {result.text && <pre className="small" style={{ margin: '4px 0', opacity: 0.8 }}>{result.text.join('\n')}</pre>}
    </>
  );
}
