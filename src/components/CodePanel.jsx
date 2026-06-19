import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../lib/store.js';
import { PART_BY_ID } from '../data/parts.js';
import { buildNetlist, partsCatalog } from '../lib/netlist.js';
import { parseAgentJson } from '../lib/agentJson.js';

// Selectable agents (same providers as Settings; switchable inline here).
const AGENTS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'groq', label: 'Groq' },
  { id: 'mistral', label: 'Mistral' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'glm', label: 'GLM' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'mock', label: 'Mock' },
];

// Build a human-readable wiring + pinout description for a given MCU node, so
// the agent generates code that matches the actual connections AND real pins.
function buildContext(node, nodes, wires) {
  const part = PART_BY_ID[node.partId];
  const lines = [`Board: ${part.name} (id ${node.id}).`, part.desc || ''];
  if (part.pins?.length) lines.push(`Available pins: ${part.pins.join(', ')}.`);

  const conns = [];
  for (const w of wires) {
    let mine = null;
    let other = null;
    if (w.from.node === node.id) { mine = w.from; other = w.to; }
    else if (w.to.node === node.id) { mine = w.to; other = w.from; }
    if (!mine) continue;
    const op = nodes.find((n) => n.id === other.node);
    const opPart = op ? PART_BY_ID[op.partId] : null;
    conns.push(`  ${part.name} pin ${mine.pin} -> ${opPart ? opPart.name : other.node} pin ${other.pin}`);
  }
  if (conns.length) lines.push('Connections:', ...conns);
  else lines.push('No wires connected to this board yet — assume a simple standalone sketch.');
  return lines.filter(Boolean).join('\n');
}

function describeAction(a) {
  const why = a.why ? `  — ${a.why}` : '';
  if (a.op === 'addWire') return { sign: '+', text: `wire  ${a.from} ── ${a.to}${why}` };
  if (a.op === 'removeWire') return { sign: '−', text: `wire  ${a.from} ── ${a.to}${why}` };
  if (a.op === 'addPart') return { sign: '+', text: `part  ${a.partId}${a.ref ? ` (as ${a.ref})` : ''}${why}` };
  if (a.op === 'removePart') return { sign: '−', text: `part  ${a.node}${why}` };
  return { sign: '?', text: JSON.stringify(a) };
}

export default function CodePanel() {
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const codeByNode = useStore((s) => s.codeByNode);
  const setNodeCode = useStore((s) => s.setNodeCode);
  const codeProvider = useStore((s) => s.codeProvider);
  const setCodeProvider = useStore((s) => s.setCodeProvider);
  const circuitProvider = useStore((s) => s.circuitProvider);
  const setCircuitProvider = useStore((s) => s.setCircuitProvider);
  const applyAgentActions = useStore((s) => s.applyAgentActions);
  const hasAnthropicKey = useStore((s) => s.hasAnthropicKey);
  const hasGeminiKey = useStore((s) => s.hasGeminiKey);
  const hasGroqKey = useStore((s) => s.hasGroqKey);
  const hasMistralKey = useStore((s) => s.hasMistralKey);
  const hasOpenrouterKey = useStore((s) => s.hasOpenrouterKey);
  const hasGlmKey = useStore((s) => s.hasGlmKey);

  const infoFor = (id) => ({
    gemini: { label: 'Gemini', hasKey: hasGeminiKey },
    groq: { label: 'Groq', hasKey: hasGroqKey },
    mistral: { label: 'Mistral', hasKey: hasMistralKey },
    openrouter: { label: 'OpenRouter', hasKey: hasOpenrouterKey },
    glm: { label: 'GLM', hasKey: hasGlmKey },
    anthropic: { label: 'Claude', hasKey: hasAnthropicKey },
    mock: { label: 'Mock', hasKey: true },
  }[id] || { label: 'Mock', hasKey: true });

  const codeInfo = infoFor(codeProvider);
  const circuitInfo = infoFor(circuitProvider);
  const codeNeedsKey = codeProvider !== 'mock' && !codeInfo.hasKey;
  const circuitNeedsKey = circuitProvider !== 'mock' && !circuitInfo.hasKey;

  const mcus = useMemo(
    () => nodes.filter((n) => PART_BY_ID[n.partId]?.category === 'Microcontrollers'),
    [nodes]
  );

  const [activeId, setActiveId] = useState(null);
  const [prompt, setPrompt] = useState('Blink an LED every second and print a counter to Serial.');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  // ---- circuit agent state ----
  const [agentPrompt, setAgentPrompt] = useState('Find and fix problems in this circuit (power, grounding, missing connections).');
  const [agentStatus, setAgentStatus] = useState('idle');
  const [agentMsg, setAgentMsg] = useState('');
  const [proposal, setProposal] = useState(null); // { summary, actions }

  // ---- free-form Q&A with the agent ----
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [askStatus, setAskStatus] = useState('idle');

  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const promptRef = useRef(null);
  const agentPromptRef = useRef(null);
  const questionRef = useRef(null);

  const netlist = useMemo(() => buildNetlist(nodes, wires), [nodes, wires]);

  // Auto-grow a textarea to fit its content, clamped between min/max px.
  function grow(el, min, max) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(min, Math.min(el.scrollHeight, max)) + 'px';
  }
  useEffect(() => { grow(promptRef.current, 44, 480); }, [prompt, activeId]);
  useEffect(() => { grow(agentPromptRef.current, 40, 480); }, [agentPrompt]);
  useEffect(() => { grow(questionRef.current, 40, 480); }, [question]);
  // code answer grows/shrinks with content (flexbox stretches the gutter to match)
  useEffect(() => { grow(taRef.current, 200, 900); }, [codeByNode, activeId]);

  useEffect(() => {
    if (selectedNodeId && mcus.some((m) => m.id === selectedNodeId)) setActiveId(selectedNodeId);
    else if (!activeId || !mcus.some((m) => m.id === activeId)) setActiveId(mcus[0]?.id || null);
  }, [selectedNodeId, mcus, activeId]);

  const node = mcus.find((m) => m.id === activeId);
  const code = node ? (codeByNode[node.id] || '') : '';
  const lineCount = useMemo(() => Math.max(1, code.split('\n').length), [code]);

  // Raspberry Pi 5 is a Linux computer — you write Python you run on the Pi,
  // not an Arduino sketch. Switch language/target accordingly.
  const isLinuxSBC = node?.partId === 'rpi5';
  const lang = isLinuxSBC
    ? { name: 'Python', noun: 'program', file: 'main.py', ext: 'py', mime: 'text/x-python', target: 'rpi5' }
    : { name: 'Arduino', noun: 'sketch', file: 'sketch.ino', ext: 'ino', mime: 'text/x-arduino', target: 'arduino' };

  function syncScroll() {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
  }

  function cleanErr(err) {
    return String(err?.message || err)
      .replace(/^Error invoking remote method '[^']*':\s*/, '')
      .replace(/^Error:\s*/, '');
  }

  async function chooseCodeAgent(id) {
    await window.forge.config.setCodeProvider(id);
    setCodeProvider(id);
  }
  async function chooseCircuitAgent(id) {
    await window.forge.config.setCircuitProvider(id);
    setCircuitProvider(id);
  }

  async function run(mode) {
    if (!node) return;
    setStatus('running');
    setMessage(mode === 'improve' ? `Improving ${lang.noun} with ${codeInfo.label}…` : `Asking ${codeInfo.label}…`);
    try {
      // Give the codegen the same full circuit awareness the debug agent has:
      // the selected board's pinout/connections PLUS the entire netlist.
      const context = `${buildContext(node, nodes, wires)}\n\nFULL CIRCUIT NETLIST:\n${netlist}`;
      let fullPrompt = prompt;
      if (mode === 'improve' && code.trim()) {
        fullPrompt =
          `Improve and harden the following ${lang.name} ${lang.noun}. Keep its intent but fix bugs, ` +
          `add helpful comments, use the real pins listed, and follow best practices.\n\n` +
          `Original request: ${prompt}\n\n--- CURRENT ${lang.noun.toUpperCase()} ---\n${code}`;
      }
      const { code: out, mock } = await window.forge.claude.generate({ prompt: fullPrompt, context, target: lang.target });
      setNodeCode(node.id, out || '');
      setStatus('done');
      setMessage(mock
        ? `Generated a mock ${lang.noun} (add a key for the code agent in Settings for real codegen).`
        : (mode === 'improve' ? `${lang.name} ${lang.noun} improved by ${codeInfo.label}.` : `${lang.name} ${lang.noun} generated by ${codeInfo.label}.`));
    } catch (err) {
      setStatus('error');
      setMessage(cleanErr(err));
    }
  }

  async function debugCircuit() {
    if (!nodes.length) { setAgentStatus('error'); setAgentMsg('Add some parts to the circuit first.'); return; }
    setAgentStatus('running');
    setAgentMsg(`Sending the circuit to ${circuitInfo.label}…`);
    setProposal(null);
    try {
      const { raw, mock } = await window.forge.claude.circuit({
        prompt: agentPrompt,
        netlist,
        catalog: partsCatalog(),
      });
      const parsed = parseAgentJson(raw);
      if (!parsed) {
        // graceful fallback: show whatever the agent said instead of a dead end
        setAgentStatus('done');
        setProposal(null);
        setAnswer(String(raw || '').slice(0, 1500));
        setAgentMsg('The agent replied in plain text (shown below in the answer box) instead of structured edits — try rephrasing or switching agent.');
        return;
      }
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      setProposal({ summary: parsed.summary || '', actions });
      setAgentStatus('done');
      setAgentMsg(mock
        ? 'Mock circuit agent — pick a real agent (Groq is free) for actual debugging.'
        : (actions.length ? 'Agent finished. Review the proposed changes and approve to apply.' : 'Agent found nothing to change.'));
    } catch (err) {
      setAgentStatus('error');
      setAgentMsg(cleanErr(err));
    }
  }

  function applyProposal() {
    if (!proposal?.actions?.length) { setProposal(null); return; }
    const { applied, errors } = applyAgentActions(proposal.actions);
    setAgentStatus('done');
    setAgentMsg(`Applied ${applied} change(s) to the circuit${errors.length ? ` · ${errors.length} skipped: ${errors.join('; ')}` : '.'}`);
    setProposal(null);
  }

  async function ask() {
    if (!question.trim()) return;
    setAskStatus('running');
    setAnswer('');
    try {
      const { answer: a, mock } = await window.forge.claude.ask({ question, netlist });
      setAnswer(a || '(no answer)');
      setAskStatus(mock ? 'idle' : 'done');
    } catch (err) {
      setAskStatus('error');
      setAnswer(cleanErr(err));
    }
  }

  function copyCode() { if (code) navigator.clipboard?.writeText(code); }

  async function saveCode() {
    if (!code) return;
    const safe = (PART_BY_ID[node.partId]?.name || lang.noun).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
    try {
      const res = await window.forge.saveCode({ filename: `${safe}.${lang.ext}`, content: code });
      if (res?.saved) {
        setStatus('done');
        setMessage(res.inProject
          ? `Saved into the project folder → ${res.filePath}`
          : `Saved → ${res.filePath}  (tip: Save the project first to keep code in its folder)`);
      }
    } catch (err) {
      setStatus('error');
      setMessage(cleanErr(err));
    }
  }

  const busy = status === 'running';
  const agentBusy = agentStatus === 'running';

  return (
    <div className="panel scroll">
      <h3>Circuit Agent <span className="badge">{circuitInfo.label}</span></h3>

      {/* ---- circuit agent picker (debugging) ---- */}
      <label className="lbl">Circuit agent</label>
      <select value={circuitProvider} onChange={(e) => chooseCircuitAgent(e.target.value)}>
        {AGENTS.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      {circuitNeedsKey
        ? <p className="status error">No {circuitInfo.label} key — add one in Settings (Gemini/Groq are free).</p>
        : circuitProvider === 'mock' && <p className="status">Mock agent — pick Gemini/Groq/etc. for real debugging.</p>}

      {/* ---- circuit netlist: always visible so you see the connections at all times ---- */}
      <label className="lbl">Live connections · {nodes.length} parts · {wires.length} wires</label>
      <pre className="net-pre">{netlist}</pre>

      {/* ---- debug the circuit with the agent ---- */}
      <label className="lbl">Ask the agent about the circuit</label>
      <textarea ref={agentPromptRef} className="grow" rows={2} value={agentPrompt} onChange={(e) => setAgentPrompt(e.target.value)} placeholder="e.g. The motor doesn't spin — what's missing?" />
      <button className="btn primary full" disabled={agentBusy || !nodes.length} onClick={debugCircuit}>
        {agentBusy ? 'Analyzing…' : '⚙ Debug circuit with agent'}
      </button>
      {agentMsg && <p className={'status ' + (agentBusy ? 'running' : agentStatus)}>{agentMsg}</p>}

      {/* ---- proposed changes (need permission to apply) ---- */}
      {proposal && (
        <div className="proposal">
          <div className="proposal-head">
            <b>Proposed changes</b>
            <span className="badge">{proposal.actions.length} edit(s)</span>
          </div>
          {proposal.summary && <p className="muted small">{proposal.summary}</p>}
          {proposal.actions.length > 0 ? (
            <>
              <ul className="action-list">
                {proposal.actions.map((a, i) => {
                  const d = describeAction(a);
                  return (
                    <li key={i} className={'action ' + (d.sign === '+' ? 'add' : d.sign === '−' ? 'del' : '')}>
                      <span className="action-sign">{d.sign}</span>{d.text}
                    </li>
                  );
                })}
              </ul>
              <div className="row">
                <button className="btn primary" style={{ flex: 1 }} onClick={applyProposal}>✓ Apply to circuit</button>
                <button className="btn" onClick={() => { setProposal(null); setAgentMsg('Changes discarded.'); }}>Discard</button>
              </div>
              <p className="muted small">Nothing changes until you approve.</p>
            </>
          ) : (
            <button className="btn" onClick={() => setProposal(null)}>OK</button>
          )}
        </div>
      )}

      {/* ---- free-form Q&A: ask the agent anything (answers here only) ---- */}
      <div className="divider" />
      <label className="lbl">Ask a question / leave a comment</label>
      <textarea
        ref={questionRef}
        className="grow"
        rows={2}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="e.g. Why isn't my LED turning on? What resistor should I use for 5V?"
      />
      <button className="btn full" disabled={askStatus === 'running' || !question.trim()} onClick={ask}>
        {askStatus === 'running' ? 'Thinking…' : '💬 Ask the agent'}
      </button>
      {answer && (
        <div className="answer-box">{answer}</div>
      )}

      <div className="divider" />

      {/* ---- code generation (needs an MCU / SBC) ---- */}
      <h3>{lang.name} Code{isLinuxSBC && <span className="badge">Raspberry Pi OS</span>}</h3>
      {mcus.length === 0 ? (
        <p className="muted small">Add a microcontroller (Arduino, ESP32, Pico…) or a Raspberry Pi 5 to write code for it.</p>
      ) : (
        <>
          {mcus.length > 1 && (
            <>
              <label className="lbl">Board</label>
              <select value={activeId || ''} onChange={(e) => setActiveId(e.target.value)}>
                {mcus.map((m) => (
                  <option key={m.id} value={m.id}>{PART_BY_ID[m.partId].name} ({m.id})</option>
                ))}
              </select>
            </>
          )}

          {isLinuxSBC && (
            <p className="muted small">This board runs <b>Raspberry Pi OS (Linux)</b> — you write <b>Python 3</b> that runs on the Pi, not an Arduino sketch.</p>
          )}

          <label className="lbl">Code agent</label>
          <select value={codeProvider} onChange={(e) => chooseCodeAgent(e.target.value)}>
            {AGENTS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
          {codeNeedsKey
            ? <p className="status error">No {codeInfo.label} key — add one in Settings (Gemini/Groq are free).</p>
            : codeProvider === 'mock' && <p className="status">Mock agent — pick Gemini/Groq/etc. for real code.</p>}

          <label className="lbl">What should it do?</label>
          <textarea ref={promptRef} className="grow" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={isLinuxSBC ? 'Describe the Python program…' : 'Describe the behavior…'} />

          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} disabled={busy || !node} onClick={() => run('generate')}>
              {busy ? 'Generating…' : `Generate ${lang.noun}`}
            </button>
            <button className="btn" disabled={busy || !node || !code.trim()} onClick={() => run('improve')} title={`Refine the current ${lang.noun}`}>
              ✦ Improve
            </button>
          </div>
          {message && <p className={'status ' + (busy ? 'running' : status)}>{message}</p>}

          <label className="lbl">{lang.name} ({lang.file})</label>
          {isLinuxSBC && (
            <div className="term-bar"><span className="term-dot r" /><span className="term-dot y" /><span className="term-dot g" /><span className="term-path">pi@raspberrypi:~ $ python3 {lang.file}</span></div>
          )}
          <div className={'code-editor' + (isLinuxSBC ? ' term' : '')}>
            <div className="code-gutter" ref={gutterRef}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={taRef}
              className="code"
              value={code}
              spellCheck={false}
              onScroll={syncScroll}
              onChange={(e) => { if (node) setNodeCode(node.id, e.target.value); grow(e.target, 200, 900); }}
              placeholder={isLinuxSBC ? '# Generated Python appears here. You can edit it freely.' : '// Generated Arduino code appears here. You can edit it freely.'}
            />
          </div>
          <div className="row">
            <button className="btn" disabled={!code} onClick={copyCode}>Copy</button>
            <button className="btn" disabled={!code} onClick={saveCode}>Save .{lang.ext}</button>
            <span className="spacer" />
            <span className="muted small">{lineCount} lines</span>
          </div>
        </>
      )}
    </div>
  );
}
