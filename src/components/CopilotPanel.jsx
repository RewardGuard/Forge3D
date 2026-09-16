// The copilot panel — point 19 of the spec made visible.
//
// Type a request. A PROPOSAL card appears: who planned it (AI or the built-in
// parser), what it will change body by body, the predicted numbers, the
// reasoning, the caveats, and what it will leave alone. Nothing has happened
// yet. Accept applies it and re-measures; the result card shows the real
// delta and how far the prediction was off. Undo restores the snapshot.
import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import { planFromText, applyProposal, revertProposal } from '../lib/copilot.js';
import { provenanceSummary, shouldWarnNoAi } from '../lib/aiProvenance.js';

const EXAMPLES = [
  'Make it 20% lighter, keep the mounting bosses',
  'Round all the corners 2 mm',
  'Chamfer the edges 1 mm',
  'Switch the shell to aluminum',
  'This bracket deforms too much under 500 N — stiffen it',
];

function Badge({ prov }) {
  if (!prov) return null;
  return <span className={'cp-badge ' + (prov.usedAi ? 'ai' : 'det')} title={prov.detail}>{prov.short}</span>;
}

export default function CopilotPanel() {
  const meshCount = useStore((s) => s.meshes.length);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);       // result of planFromText
  const [applied, setApplied] = useState(null); // result of applyProposal
  const [history, setHistory] = useState([]);   // { headline, token, measured }

  async function doPlan(t) {
    const q = (t ?? text).trim();
    if (!q || busy) return;
    setBusy(true); setApplied(null); setPlan(null);
    try { setPlan(await planFromText(q)); }
    catch (e) { setPlan({ ok: false, unknown: true, reason: String(e?.message || e) }); }
    finally { setBusy(false); }
  }
  function accept() {
    if (!plan?.ok) return;
    const r = applyProposal(plan.proposal);
    setApplied(r);
    if (r.applied) setHistory((h) => [{ headline: plan.proposal.explanation.headline, token: r.revertToken, measured: r.measured, prov: plan.provenance }, ...h].slice(0, 12));
  }
  function undo(token) {
    const r = revertProposal(token);
    if (r.reverted) { setHistory((h) => h.filter((x) => x.token !== token)); setApplied(null); setPlan(null); }
  }

  const p = plan?.proposal;

  return (
    <div className="cp">
      <label className="lbl">Copilot <span className="muted">— ask for a change; nothing happens until you accept</span></label>
      <div className="row">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doPlan(); }}
          placeholder={meshCount ? 'e.g. make it 20% lighter, keep the mounting bosses' : 'Add a body first'} disabled={!meshCount} style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy || !meshCount || !text.trim()} onClick={() => doPlan()}>{busy ? '…' : 'Plan'}</button>
      </div>
      <div className="cp-examples">
        {EXAMPLES.map((ex) => <button key={ex} className="cp-ex" disabled={!meshCount || busy} onClick={() => { setText(ex); doPlan(ex); }}>{ex}</button>)}
      </div>

      {/* nobody understood it */}
      {plan && !plan.ok && plan.unknown && (
        <div className="cp-card warn">
          <div className="cp-head"><Badge prov={plan.provenance} /><b>Not understood</b></div>
          <p>{plan.reason}</p>
          {plan.hint && <p className="muted small">{plan.hint}</p>}
        </div>
      )}

      {/* the operation refused */}
      {plan && !plan.ok && !plan.unknown && (
        <div className="cp-card err">
          <div className="cp-head"><Badge prov={plan.provenance} /><b>{plan.refused ? 'Cannot do this honestly' : 'Cannot plan this'}</b></div>
          <p>{plan.reason}</p>
          {plan.wouldNeed && <p className="muted small"><b>Would need:</b> {plan.wouldNeed}</p>}
          {plan.alternatives?.length > 0 && <ul className="cp-list">{plan.alternatives.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </div>
      )}

      {/* the proposal */}
      {p && !applied && (
        <div className="cp-card">
          <div className="cp-head">
            <Badge prov={plan.provenance} />
            <b>{p.explanation.headline}</b>
            <span className="muted small">{provenanceSummary(plan.provenance)}</span>
          </div>
          {shouldWarnNoAi(plan.provenance) && <p className="cp-note warn">Planned by the built-in parser, not a model — it matched a phrase, it did not reason about your part.</p>}
          {plan.rationale && <p className="cp-why">{plan.rationale}</p>}

          <table className="cp-diff"><tbody>
            {p.changes.map((c, i) => (
              <tr key={i}>
                <td className="cp-body">{c.label || c.bodyId}</td>
                <td className="cp-field">{c.field}</td>
                <td className="cp-from">{fmtVal(c.from)}</td>
                <td className="cp-arrow">→</td>
                <td className="cp-to">{fmtVal(c.to)}</td>
              </tr>
            ))}
          </tbody></table>

          {p.predicted && Number.isFinite(p.predicted.massBefore_g) && (
            <div className="cp-pred">
              <span>Mass</span>
              <b>{p.predicted.massBefore_g.toFixed(1)} g → {p.predicted.massAfter_g.toFixed(1)} g</b>
              <span className={p.predicted.deltaPct < 0 ? 'ok' : p.predicted.deltaPct > 0 ? 'warn' : ''}>{p.predicted.deltaPct > 0 ? '+' : ''}{p.predicted.deltaPct.toFixed(1)}%</span>
              <span className="muted small">predicted</span>
            </div>
          )}

          <ul className="cp-list">{p.explanation.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          {p.preserved?.length > 0 && <p className="muted small">Untouched: {p.preserved.join(', ')}</p>}
          <p className="cp-reason"><b>Why:</b> {p.explanation.reason}</p>
          {p.explanation.caveats?.length > 0 && (
            <details className="cp-caveats"><summary>{p.explanation.caveats.length} caveat{p.explanation.caveats.length === 1 ? '' : 's'}</summary>
              <ul className="cp-list">{p.explanation.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </details>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={accept}>✓ Accept</button>
            <button className="btn" onClick={() => setPlan(null)}>✕ Reject</button>
          </div>
        </div>
      )}

      {/* applied: the measured truth */}
      {applied && (
        <div className={'cp-card ' + (applied.applied ? 'ok' : 'err')}>
          <div className="cp-head"><b>{applied.applied ? 'Applied — measured result' : 'Not applied'}</b></div>
          {applied.applied ? (
            <>
              <div className="cp-pred">
                <span>Mass</span>
                <b>{applied.measured.massBefore_g?.toFixed(1)} g → {applied.measured.massAfter_g.toFixed(1)} g</b>
                <span className={applied.measured.deltaPct < 0 ? 'ok' : ''}>{applied.measured.deltaPct > 0 ? '+' : ''}{applied.measured.deltaPct?.toFixed(1)}%</span>
                <span className="muted small">measured</span>
              </div>
              <p className="muted small">
                Prediction error {Math.abs(applied.predictionError_pct ?? 0).toFixed(2)}% · envelope {applied.measured.envelope_mm?.map((v) => v.toFixed(0)).join('×')} mm
              </p>
              <p className="cp-note warn">{applied.note}</p>
              <button className="btn" onClick={() => undo(applied.revertToken)}>↶ Undo this change</button>
            </>
          ) : <p>{applied.reason}</p>}
        </div>
      )}

      {history.length > 0 && (
        <>
          <label className="lbl" style={{ marginTop: 10 }}>Applied changes</label>
          {history.map((h) => (
            <div key={h.token} className="cp-hist">
              <Badge prov={h.prov} />
              <span className="cp-hist-title">{h.headline}</span>
              <span className="muted small">{h.measured?.deltaPct != null ? `${h.measured.deltaPct > 0 ? '+' : ''}${h.measured.deltaPct.toFixed(1)}%` : ''}</span>
              <button className="btn ghost small" onClick={() => undo(h.token)}>↶</button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function fmtVal(v) {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.map((n) => (typeof n === 'number' ? n.toFixed(3) : n)).join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}
