import React, { useEffect, useRef } from 'react';
import { useStore } from '../lib/store.js';
import { runOrchestra, stopOrchestra, BUDGET } from '../lib/orchestra.js';
import Viewport3D from './Viewport3D.jsx';
import LifeSimView from './LifeSimView.jsx';

// A few one-tap goals so the director is easy to try.
const EXAMPLES = [
  'Make a car with 4 wheels driven by two DC motors and an Arduino, controlled by a joystick. Then run it and drive forward.',
  'Build a desk lamp: a base, an arm and a bulb, wired to an Arduino with a potentiometer dimmer.',
  'Make a little robot that spins when I press a button, then test it in the Life Sim.',
];

const HEADROOMS = [
  { id: 'eco', label: 'Eco', note: 'fewest tokens' },
  { id: 'balanced', label: 'Balanced', note: 'default' },
  { id: 'max', label: 'Max', note: 'longest builds' },
];

function ReportCard({ step }) {
  const r = step.result || {};
  const issues = r.issues || [];
  const warnings = r.warnings || [];
  return (
    <div className={'orc-step report' + (issues.length ? ' bad' : '')}>
      <div className="orc-step-head">
        <span className="orc-n">{step.n}</span>
        <span className="orc-tool">feasibility report</span>
        <span className="spacer" />
        <span className={'orc-badge-pill ' + (r.printable ? 'ok' : 'warn')}>{r.printable ? '✓ printable' : '⚠ review'}</span>
      </div>
      <div className="orc-report-grid">
        <div><span>Envelope</span><b>{(r.envelope_mm || []).join(' × ')} mm</b></div>
        <div><span>Min wall</span><b>{r.minWall_mm} mm</b></div>
        <div><span>Print bed</span><b>{r.fitsBed ? 'fits 220³' : 'split needed'}</b></div>
        <div><span>BOM</span><b>{r.bom?.parts} parts · ${r.bom?.total_usd}</b></div>
      </div>
      {issues.map((m, i) => <div key={'i' + i} className="orc-result err">{m}</div>)}
      {warnings.map((m, i) => <div key={'w' + i} className="orc-note">{m}</div>)}
    </div>
  );
}

// Plain-English label for each step — what Orchestra is actually doing.
const TOOL_LABEL = {
  build_spec: 'Planned the design', compose_geometry: 'Built the 3D geometry',
  use_model: 'Chose a model', build_circuit: 'Wired the circuit',
  gen_code: 'Wrote the firmware', wired_by: 'Circuit complete',
  check_circuit: 'Checked the wiring', validate_structure: 'Structural check',
  validate_integration: 'Mounting check', check_indicators: 'Tested the LEDs',
  check_motors: 'Tested the motors', get_sim_report: 'Read the simulation',
  look: 'Looked at the build', done: 'Finished', assemble: 'Mounted the wheels',
  build_blueprint: 'Laid out the parts', add_primitive: 'Added a shape', gen_mesh: 'Generated a model',
};

// Turn a step's result into one readable line — no raw JSON.
function humanResult(step) {
  if (step.error) return String(step.error);
  const r = step.result;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (r.summary) return r.summary;
  if (r.verdict) return r.verdict;
  const bits = [];
  if (r.trying) bits.push(`trying the ${r.trying} model`);
  if (r.bodies != null) bits.push(`${r.bodies} part${r.bodies === 1 ? '' : 's'}${r.cutouts ? `, ${r.cutouts} opening${r.cutouts === 1 ? '' : 's'}` : ''}`);
  if (r.mass_g != null) bits.push(r.stable ? `stable · ${r.mass_g} g, balanced over its base` : `⚠ ${r.mass_g} g — would tip over`);
  if (typeof r.leds === 'string' && r.leds !== 'n/a') bits.push(`${r.leds} LEDs light`);
  else if (Array.isArray(r.leds) && r.total != null) bits.push(`${r.lit}/${r.total} LEDs light`);
  if (typeof r.motors === 'string' && r.motors !== 'n/a') bits.push(`${r.motors} motors spin`);
  else if (Array.isArray(r.motors)) bits.push(`${r.motors.filter((m) => m.active).length}/${r.motors.length} motors spin`);
  if (Array.isArray(r.deficiencies)) bits.push(r.deficiencies.length ? r.deficiencies.join('; ') : 'wiring checks out');
  if (Array.isArray(r.issues)) bits.push(r.issues.length ? r.issues.join('; ') : 'no issues');
  if (r.autofixed) bits.push(`auto-fixed ${r.autofixed}`);
  if (r.applied != null) bits.push(`${r.applied} connection${r.applied === 1 ? '' : 's'} made`);
  if (r.firmwareSet) bits.push('firmware loaded');
  if (!bits.length && r.ok === true) bits.push('OK');
  return bits.join(' · ');
}

function StepCard({ step }) {
  if (step.kind === 'phase') {
    return <div className="orc-phase"><span className="orc-phase-dot" />{step.note}</div>;
  }
  if (step.tool === 'validate_manufacture') return <ReportCard step={step} />;
  const label = step.tool ? (TOOL_LABEL[step.tool] || step.tool.replace(/_/g, ' ')) : (step.kind === 'error' ? 'Problem' : 'Note');
  const detail = humanResult(step);
  return (
    <div className={'orc-step ' + (step.kind || 'action') + (step.ok === false ? ' bad' : '')}>
      <div className="orc-step-head">
        <span className="orc-n">{step.n}</span>
        <span className="orc-label">{label}</span>
        <span className="spacer" />
        {step.ok === true && <span className="orc-ok">✓</span>}
        {step.ok === false && <span className="orc-err-dot">✕</span>}
      </div>
      {step.thought && <div className="orc-thought">{step.thought}</div>}
      {step.note && <div className="orc-note">{step.note}</div>}
      {detail && <div className={'orc-result' + (step.ok === false ? ' err' : '')}>{detail}</div>}
      {step.image && (
        <div className="orc-shot">
          <img src={step.image} alt={`viewport at step ${step.n}`} />
          <span className="orc-shot-tag">what Orchestra saw 👁</span>
        </div>
      )}
    </div>
  );
}

export default function OrchestraPanel() {
  const status = useStore((s) => s.orchestraStatus);
  const goal = useStore((s) => s.orchestraGoal);
  const steps = useStore((s) => s.orchestraSteps);
  const tokens = useStore((s) => s.orchestraTokens);
  const headroom = useStore((s) => s.orchestraHeadroom);
  const setOrchestraHeadroom = useStore((s) => s.setOrchestraHeadroom);
  const orchestraReset = useStore((s) => s.orchestraReset);
  const director = useStore((s) => s.orchestraDirector);
  const hasHfToken = useStore((s) => s.hasHfToken);
  const orchestraView = useStore((s) => s.orchestraView);
  const orchestraPhase = useStore((s) => s.orchestraPhase);
  const lifeSimRunning = useStore((s) => s.lifeSimRunning);
  const setSimReport = useStore((s) => s.setSimReport);
  const theme = useStore((s) => s.theme);
  const meshCount = useStore((s) => s.meshes.length);

  const [draft, setDraft] = React.useState(goal || EXAMPLES[0]);
  const running = status === 'running';
  const budget = BUDGET[headroom] || BUDGET.balanced;
  const pct = Math.min(100, Math.round((tokens / budget.tokens) * 100));

  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [steps.length]);

  async function chooseHeadroom(id) {
    await window.forge.config.setOrchestraHeadroom(id);
    setOrchestraHeadroom(id);
  }
  function start() {
    if (!draft.trim() || running) return;
    runOrchestra(draft.trim()); // fire-and-forget; the store streams progress
  }

  const statusLabel = {
    idle: 'ready', running: 'working…', done: 'done ✓', stopped: 'stopped', error: 'error',
  }[status] || status;

  return (
    <div className="orc-layout">
      <aside className="sidebar left">
        <div className="panel scroll">
          <h3>✦ Orchestra <span className={'badge orc-badge-' + status}>{statusLabel}</span></h3>
          <p className="muted small">
            Tell Orchestra a whole project. It plans the build and conducts the other AIs —
            generating shapes, handing wiring to the circuit agent, writing firmware, then
            testing it in the Life Sim. It can <b>see</b> the viewport to confirm each step.
          </p>

          <label className="lbl">Goal</label>
          <textarea
            className="grow" rows={4} value={draft}
            disabled={running}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Make a car that drives with a joystick…"
          />

          <div className="row">
            {!running ? (
              <button className="btn primary" style={{ flex: 1 }} onClick={start} disabled={!draft.trim()}>
                ▶ Conduct
              </button>
            ) : (
              <button className="btn danger" style={{ flex: 1 }} onClick={stopOrchestra}>❚❚ Stop</button>
            )}
            <button className="btn" onClick={orchestraReset} disabled={running || !steps.length}>↺ Clear</button>
          </div>

          <label className="lbl">Try a goal</label>
          <div className="orc-examples">
            {EXAMPLES.map((ex, i) => (
              <button key={i} className="orc-chip" disabled={running} onClick={() => setDraft(ex)} title={ex}>
                {ex.split(':')[0].split('.')[0].slice(0, 42)}…
              </button>
            ))}
          </div>

          <div className="divider" />
          <label className="lbl">Token headroom</label>
          <div className="seg">
            {HEADROOMS.map((h) => (
              <button key={h.id} className={'seg-btn' + (headroom === h.id ? ' on' : '')} disabled={running}
                onClick={() => chooseHeadroom(h.id)} title={h.note}>
                {h.label}
              </button>
            ))}
          </div>
          <div className="orc-meter">
            <div className="orc-meter-bar"><i style={{ width: pct + '%' }} className={pct > 85 ? 'hot' : ''} /></div>
            <span className="muted small">~{tokens.toLocaleString()} / {budget.tokens.toLocaleString()} tokens · {budget.steps}-step cap</span>
          </div>
          <p className="muted small">
            Director: <b>{director}</b>{director === 'base' && ' (free Forge3D Cloud)'} · Vision: <b>GLM-4.5V</b>
            {!hasHfToken && <span className="orc-hint"> · tip: add a free Hugging Face token in Settings to let Orchestra visually double-check each step.</span>}
          </p>
        </div>
      </aside>

      {/* LIVE STAGE — watch Orchestra build it in 3D, not just read a log */}
      <section className="orc-viewport">
        {orchestraView === 'sim'
          ? <LifeSimView running={lifeSimRunning} hazards={[]} theme={theme} onReport={setSimReport} />
          : <Viewport3D />}
        {running && (
          <div className="orc-banner">
            <span className="orc-pulse" />
            <span className="orc-banner-text">{orchestraPhase || 'Working…'}</span>
          </div>
        )}
        {!running && steps.length === 0 && meshCount === 0 && (
          <div className="orc-stage-hint">
            <div className="orc-empty-mark">✦</div>
            <h2>Watch Orchestra build it</h2>
            <p className="muted">Describe a project on the left and press <b>Conduct</b>. The model designs it, builds it here in 3D, wires it, and runs it — you watch it happen.</p>
          </div>
        )}
      </section>

      {/* the timeline still streams alongside, for the detail */}
      <aside className="orc-timeline">
        <div className="orc-log" ref={logRef}>
          {steps.length === 0 ? (
            <p className="muted small" style={{ padding: 12 }}>The director's plan, tool calls, validations and screenshots stream here as it works.</p>
          ) : (
            steps.map((s) => <StepCard key={s.n} step={s} />)
          )}
        </div>
      </aside>
    </div>
  );
}
