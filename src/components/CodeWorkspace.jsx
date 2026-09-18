// Full-window code workspace.
//
// The sketch used to live in a 240 px textarea inside a sidebar. Firmware is
// not written in 240 px. This is a dedicated tab: a real editor (CodeMirror,
// with C++ or Python grammar chosen by the board), one file per
// microcontroller, and — beside it — the things an embedded developer keeps
// glancing at: which pins are wired to what, what the display would show, and
// what the pin analyser thinks the code drives. Change the code, watch the
// screen update. That is what makes it an IDE rather than a text box.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore } from '../lib/store.js';
import { PART_BY_ID } from '../data/parts.js';
import { buildNetlist } from '../lib/netlist.js';
import { analyzeDrivenPins } from '../lib/codeSim.js';
import { renderScreen, extractDeclaredValues, hasScreen, screenSpec, framebufferToImageData } from '../lib/screenSim.js';
import { buildContext } from './CodePanel.jsx';

const LINUX_SBC = new Set(['rpi5', 'rpi-cm4', 'rpi-zero2w']);

function langFor(partId) {
  return LINUX_SBC.has(partId)
    ? { name: 'Python', noun: 'program', file: 'main.py', target: 'rpi5', mode: python }
    : { name: 'Arduino', noun: 'sketch', file: 'sketch.ino', target: 'arduino', mode: cpp };
}

const STARTER = {
  arduino: `// Forge3D — new sketch\n// Pins below are wired in the Circuit tab; see the pin map on the right.\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n\n}\n`,
  rpi5: `# Forge3D — new program\n# Pins below are wired in the Circuit tab; see the pin map on the right.\nimport time\nfrom gpiozero import LED\n\nwhile True:\n    time.sleep(1)\n`,
};

// ── The editor itself ─────────────────────────────────────────────────────
function Editor({ value, onChange, mode, theme }) {
  const host = useRef(null);
  const view = useRef(null);
  const langC = useRef(new Compartment());
  const themeC = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value || '',
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        langC.current.of(mode()),
        themeC.current.of(theme === 'dark' ? oneDark : []),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current(u.state.doc.toString()); }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13.5px' },
          '.cm-scroller': { fontFamily: "'SF Mono', ui-monospace, Menlo, Consolas, monospace", lineHeight: '1.55' },
          '.cm-content': { padding: '12px 0' },
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => { view.current?.destroy(); view.current = null; };
  }, []);

  // external value change (switching files, AI generation) → replace doc
  useEffect(() => {
    const v = view.current; if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== (value || '')) v.dispatch({ changes: { from: 0, to: cur.length, insert: value || '' } });
  }, [value]);

  useEffect(() => { view.current?.dispatch({ effects: langC.current.reconfigure(mode()) }); }, [mode]);
  useEffect(() => { view.current?.dispatch({ effects: themeC.current.reconfigure(theme === 'dark' ? oneDark : []) }); }, [theme]);

  return <div ref={host} className="cw-editor" />;
}

// ── Side panels ───────────────────────────────────────────────────────────
function PinMap({ node, nodes, wires }) {
  const part = PART_BY_ID[node.partId];
  const rows = useMemo(() => {
    const out = [];
    for (const w of wires) {
      let mine = null, other = null;
      if (w.from.node === node.id) { mine = w.from; other = w.to; }
      else if (w.to.node === node.id) { mine = w.to; other = w.from; }
      if (!mine) continue;
      const op = nodes.find((n) => n.id === other.node);
      out.push({ pin: mine.pin, to: op ? (PART_BY_ID[op.partId]?.name || op.partId) : other.node, toPin: other.pin });
    }
    return out.sort((a, b) => String(a.pin).localeCompare(String(b.pin), undefined, { numeric: true }));
  }, [node, nodes, wires]);
  return (
    <section className="cw-side-block">
      <h4>Pin map <span className="muted">{part?.name}</span></h4>
      {rows.length === 0
        ? <p className="muted small">Nothing wired to this board yet. Wire it in the Circuit tab and the pins appear here.</p>
        : <table className="cw-pins"><tbody>
            {rows.map((r, i) => <tr key={i}><td className="cw-pin">{r.pin}</td><td>→ {r.to}</td><td className="muted">{r.toPin}</td></tr>)}
          </tbody></table>}
    </section>
  );
}

function DrivenPins({ node, code }) {
  const driven = useMemo(() => analyzeDrivenPins(node.partId, code || ''), [node.partId, code]);
  const entries = Object.entries(driven);
  return (
    <section className="cw-side-block">
      <h4>What the code drives <span className="muted">(static analysis)</span></h4>
      {entries.length === 0
        ? <p className="muted small">No output pins driven yet.</p>
        : <ul className="cw-driven">{entries.map(([pin, st]) => (
            <li key={pin}><b>{pin}</b> <span className="muted">{typeof st === 'string' ? st : `follows ${st.gate}`}</span></li>
          ))}</ul>}
    </section>
  );
}

function ScreenPanel({ nodes, code }) {
  const inputs = useStore((s) => s.inputs);
  const screens = useMemo(() => nodes.filter((n) => hasScreen(n.partId)), [nodes]);
  const ref = useRef(null);
  const [which, setWhich] = useState(0);
  const target = screens[which] || screens[0];

  const result = useMemo(() => {
    if (!target) return null;
    const values = { ...extractDeclaredValues(code || '') };
    for (const [id, v] of Object.entries(inputs || {})) if (typeof v === 'number') values[id] = v;
    const r = renderScreen(target.partId, code || '', values);
    return r.ok ? r : null;
  }, [target, code, inputs]);

  useEffect(() => {
    if (!ref.current || !result) return;
    const spec = result.spec;
    const scale = spec.mode !== 'gfx' ? 4 : Math.max(spec.w, spec.h) <= 64 ? 6 : Math.max(spec.w, spec.h) <= 160 ? 3 : Math.max(spec.w, spec.h) <= 400 ? 1 : 1;
    const img = framebufferToImageData(result.fb, scale);
    ref.current.width = img.width; ref.current.height = img.height;
    ref.current.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  }, [result]);

  if (!screens.length) return null;
  return (
    <section className="cw-side-block">
      <h4>Screen <span className="muted">(display simulation)</span></h4>
      {screens.length > 1 && (
        <div className="seg">{screens.map((s, i) => (
          <button key={s.id} className={'seg-btn' + (i === which ? ' on' : '')} onClick={() => setWhich(i)}>{PART_BY_ID[s.partId]?.name}</button>
        ))}</div>
      )}
      <canvas ref={ref} className="cw-screen" />
      {result && <p className="muted small">{result.note}</p>}
      {result?.text && <pre className="small cw-lcd">{result.text.join('\n')}</pre>}
    </section>
  );
}

// ── The workspace ─────────────────────────────────────────────────────────
export default function CodeWorkspace() {
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const codeByNode = useStore((s) => s.codeByNode);
  const setNodeCode = useStore((s) => s.setNodeCode);
  const theme = useStore((s) => s.theme);
  const setTab = useStore((s) => s.setTab);

  const mcus = useMemo(() => nodes.filter((n) => PART_BY_ID[n.partId]?.category === 'Microcontrollers'), [nodes]);
  const [activeId, setActiveId] = useState(null);
  const node = mcus.find((n) => n.id === activeId) || mcus[0] || null;
  const lang = node ? langFor(node.partId) : langFor('arduino-uno');
  const code = node ? (codeByNode[node.id] ?? '') : '';

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [sideOpen, setSideOpen] = useState(true);
  const netlist = useMemo(() => buildNetlist(nodes, wires), [nodes, wires]);

  useEffect(() => { if (node && !codeByNode[node.id]) setNodeCode(node.id, STARTER[lang.target]); }, [node?.id]);

  async function generate(mode) {
    if (!node || busy) return;
    setBusy(true); setMsg({ kind: 'info', text: mode === 'improve' ? 'Improving…' : 'Generating…' });
    try {
      const context = `${buildContext(node, nodes, wires)}\n\nFULL CIRCUIT NETLIST:\n${netlist}`;
      let full = prompt.trim() || `Write the ${lang.noun} for this board using exactly the pins wired below.`;
      if (mode === 'improve' && code.trim()) {
        full = `Improve and harden the following ${lang.name} ${lang.noun}. Keep its intent, fix bugs, use the real pins listed.\n\nRequest: ${prompt}\n\n--- CURRENT ---\n${code}`;
      }
      const { code: out, mock } = await window.forge.claude.generate({ prompt: full, context, target: lang.target });
      setNodeCode(node.id, out || '');
      setMsg({ kind: mock ? 'warn' : 'ok', text: mock ? 'Mock output — no code model is configured (Settings → Orchestra AI).' : `${lang.name} ${lang.noun} ${mode === 'improve' ? 'improved' : 'generated'}.` });
    } catch (e) {
      setMsg({ kind: 'err', text: String(e?.message || e).slice(0, 200) });
    } finally { setBusy(false); }
  }

  async function saveToDisk() {
    if (!node) return;
    await window.forge.saveCode({ filename: lang.file, content: code });
    setMsg({ kind: 'ok', text: `Saved ${lang.file}.` });
  }

  if (!mcus.length) {
    return (
      <div className="cw-empty">
        <h2>No board to program</h2>
        <p className="muted">Add a microcontroller — Arduino, ESP32, Pico, Raspberry Pi — in the <button className="link" onClick={() => setTab('circuit')}>Circuit tab</button>, then come back here.</p>
      </div>
    );
  }

  return (
    <div className={'cw' + (sideOpen ? '' : ' cw-side-hidden')}>
      <header className="cw-bar">
        <div className="cw-files">
          {mcus.map((m) => (
            <button key={m.id} className={'cw-file' + (m.id === node?.id ? ' on' : '')} onClick={() => setActiveId(m.id)} title={m.id}>
              <span className="cw-file-name">{langFor(m.partId).file}</span>
              <span className="muted small">{PART_BY_ID[m.partId]?.name}</span>
            </button>
          ))}
        </div>
        <div className="cw-actions">
          <input className="cw-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={`Describe what this ${lang.noun} should do…`} onKeyDown={(e) => { if (e.key === 'Enter') generate('new'); }} />
          <button className="btn primary" disabled={busy} onClick={() => generate('new')}>{busy ? '…' : '✦ Generate'}</button>
          <button className="btn" disabled={busy || !code.trim()} onClick={() => generate('improve')}>Improve</button>
          <button className="btn ghost" onClick={saveToDisk}>Save {lang.file}</button>
          <button className="btn ghost" title="Toggle side panel" onClick={() => setSideOpen((v) => !v)}>{sideOpen ? '⇥' : '⇤'}</button>
        </div>
      </header>
      {msg && <div className={`cw-msg ${msg.kind}`}>{msg.text}</div>}
      <div className="cw-body">
        <Editor value={code} onChange={(v) => setNodeCode(node.id, v)} mode={lang.mode} theme={theme} />
        {sideOpen && (
          <aside className="cw-side">
            <PinMap node={node} nodes={nodes} wires={wires} />
            <ScreenPanel nodes={nodes} code={code} />
            <DrivenPins node={node} code={code} />
          </aside>
        )}
      </div>
    </div>
  );
}
