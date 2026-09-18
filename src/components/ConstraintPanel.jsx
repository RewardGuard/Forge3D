// Assembly constraints — add mates between bodies, solve, and read the
// verdict: exact / under-constrained / over-constrained / conflicting, with
// the reason in numbers.
import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import { CONSTRAINT_TYPES, newConstraint, describeConstraint, solveAndApply } from '../lib/constraints.js';

const STATUS = {
  exact: { label: 'Fully constrained', cls: 'ok' },
  under: { label: 'Under-constrained', cls: 'warn' },
  over: { label: 'Over-constrained (redundant)', cls: 'warn' },
  conflicting: { label: 'Conflicting', cls: 'err' },
  satisfied: { label: 'Satisfied', cls: 'ok' },
  none: { label: 'No constraints', cls: '' },
};

export default function ConstraintPanel() {
  const meshes = useStore((s) => s.meshes);
  const constraints = useStore((s) => s.constraints);
  const selectedMeshId = useStore((s) => s.selectedMeshId);
  const selectedMeshIds = useStore((s) => s.selectedMeshIds);
  const addConstraint = useStore((s) => s.addConstraint);
  const updateConstraint = useStore((s) => s.updateConstraint);
  const toggleConstraint = useStore((s) => s.toggleConstraint);
  const removeConstraint = useStore((s) => s.removeConstraint);
  const report = useStore((s) => s.constraintReport);
  const setReport = useStore((s) => s.setConstraintReport);
  const [type, setType] = useState('mate');
  const labelOf = (id) => meshes.find((m) => m.id === id)?.label || id;
  const sel = selectedMeshIds?.length ? selectedMeshIds : selectedMeshId ? [selectedMeshId] : [];
  const def = CONSTRAINT_TYPES[type];
  const canAdd = def && (def.arity === 1 ? sel.length >= 1 : sel.length >= 2);

  function add() {
    if (!canAdd) return;
    addConstraint(newConstraint(type, sel[0], def.arity === 2 ? sel[1] : null));
  }
  function solve() { setReport(solveAndApply({ apply: true })); }
  function check() { setReport(solveAndApply({ apply: false })); }

  const st = report ? STATUS[report.status] || STATUS.none : null;
  const conflictIds = new Set((report?.report?.conflicts || []).map((c) => c.id));

  return (
    <div className="cn">
      <p className="muted small" style={{ margin: 0 }}>Select 1–2 bodies in the viewport, pick a mate type, add. The solver reports freedom left and conflicts.</p>
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value)} title={def?.hint}>
          {Object.entries(CONSTRAINT_TYPES).map(([id, d]) => <option key={id} value={id}>{d.label} (−{d.dof} DOF)</option>)}
        </select>
        <button className="btn" disabled={!canAdd} onClick={add} title={canAdd ? def.hint : `Select ${def?.arity === 1 ? 'a body' : 'two bodies'}`}>+ Add</button>
      </div>
      <p className="muted small">{def?.hint}{sel.length ? ` · ${sel.map(labelOf).join(' → ')}` : ''}</p>

      {constraints.map((c) => {
        const inConflict = conflictIds.has(c.id);
        const p = c.params || {};
        return (
          <div key={c.id} className={'cn-row' + (c.enabled ? '' : ' off') + (inConflict ? ' conflict' : '')}>
            <div className="cn-head">
              <button className="ft-tog" onClick={() => toggleConstraint(c.id)}>{c.enabled ? '●' : '○'}</button>
              <span className="cn-title">{describeConstraint(c, labelOf)}</span>
              {inConflict && <span className="cn-badge">conflict</span>}
              <button className="ft-btn" onClick={() => removeConstraint(c.id)}>✕</button>
            </div>
            <div className="cn-params">
              {'mm' in p && <label>{c.type === 'alongAxis' ? 'offset' : 'd'} <input type="number" step="0.5" value={p.mm} onChange={(e) => updateConstraint(c.id, { params: { mm: parseFloat(e.target.value) || 0 } })} /> mm</label>}
              {'deg' in p && <label>θ <input type="number" step="1" value={p.deg} onChange={(e) => updateConstraint(c.id, { params: { deg: parseFloat(e.target.value) || 0 } })} />°</label>}
              {'gap' in p && <label>gap <input type="number" step="0.1" value={p.gap} onChange={(e) => updateConstraint(c.id, { params: { gap: parseFloat(e.target.value) || 0 } })} /> mm</label>}
              {'axis' in p && <label>axis <select value={p.axis} onChange={(e) => updateConstraint(c.id, { params: { axis: e.target.value } })}>{['x', 'y', 'z'].map((a) => <option key={a}>{a}</option>)}</select></label>}
              {'faceA' in p && <label>A <select value={p.faceA} onChange={(e) => updateConstraint(c.id, { params: { faceA: e.target.value } })}>{['+x', '-x', '+y', '-y', '+z', '-z'].map((a) => <option key={a}>{a}</option>)}</select></label>}
              {'faceB' in p && <label>B <select value={p.faceB} onChange={(e) => updateConstraint(c.id, { params: { faceB: e.target.value } })}>{['+x', '-x', '+y', '-y', '+z', '-z'].map((a) => <option key={a}>{a}</option>)}</select></label>}
            </div>
          </div>
        );
      })}

      {constraints.length > 0 && (
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={solve}>Solve & apply</button>
          <button className="btn" onClick={check} title="Solve without moving anything — just report">Check only</button>
        </div>
      )}

      {report && st && (
        <div className={'cn-report ' + st.cls}>
          <b>{st.label}</b>
          <p>{report.report.message}</p>
          <p className="muted small">
            {report.report.free?.length || 0} free {report.report.free?.length === 1 ? 'body' : 'bodies'} · {report.report.dofTotal} DOF · rank {report.report.rank} of {report.report.equations} equations · {report.iterations} iterations · residual {report.residual.toExponential(2)}
          </p>
          {report.report.conflicts?.length > 0 && (
            <ul className="cp-list">{report.report.conflicts.map((c) => <li key={c.id}>{describeConstraint(constraints.find((x) => x.id === c.id) || { type: c.id }, labelOf)} — off by {c.residual}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
