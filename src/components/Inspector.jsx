import React from 'react';
import { useStore } from '../lib/store.js';
import { scaleArr, packScale, avgScale } from '../lib/scaleUtil.js';
import { isRoundable, maxCornerRadiusMm, validateCornerRadius, trueDimsMm, CORNER_STYLES, ROUNDABLE } from '../lib/rounding.js';
import { runKernelOp, kernelSupports, edgeCount, meshToSTEP } from '../lib/kernelBridge.js';
import { kernelStatus, KERNEL_UNLOCKS } from '../lib/kernel.js';
import { ScreenPreview } from './ScreenFace.jsx';
import { mergeMembersToBaked } from '../lib/csgMerge.js';

const AXES = ['x', 'y', 'z'];
const MODES = [
  { id: 'translate', label: 'Move' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'scale', label: 'Scale' },
];
const DEG = 180 / Math.PI;

export default function Inspector() {
  const meshes = useStore((s) => s.meshes);
  const selectedId = useStore((s) => s.selectedMeshId);
  const selectedIds = useStore((s) => s.selectedMeshIds);
  const groupSelected = useStore((s) => s.groupSelected);
  const ungroupSelected = useStore((s) => s.ungroupSelected);
  const selectMeshOnly = useStore((s) => s.selectMeshOnly);
  const bakeGroup = useStore((s) => s.bakeGroup);
  const setSpinReverse = useStore((s) => s.setSpinReverse);
  const setMeshNegative = useStore((s) => s.setMeshNegative);
  const updateMesh = useStore((s) => s.updateMesh);
  const replaceMesh = useStore((s) => s.replaceMesh);
  const [kOp, setKOp] = React.useState('fillet');
  const [kVal, setKVal] = React.useState(2);
  const [kBusy, setKBusy] = React.useState(false);
  const [kMsg, setKMsg] = React.useState(null);
  const [kEdges, setKEdges] = React.useState(null);
  const removeMesh = useStore((s) => s.removeMesh);
  const transformMode = useStore((s) => s.transformMode);
  const setTransformMode = useStore((s) => s.setTransformMode);
  const copyMesh = useStore((s) => s.copyMesh);
  const pasteMesh = useStore((s) => s.pasteMesh);
  const duplicateMesh = useStore((s) => s.duplicateMesh);
  const setAttachment = useStore((s) => s.setAttachment);
  const clipboard = useStore((s) => s.clipboard);
  const mesh = meshes.find((m) => m.id === selectedId);

  if (!mesh) {
    return (
      <div className="panel">
        <h3>Inspector</h3>
        <p className="muted">Select an object in the viewport to edit it.</p>
        <p className="muted small">{meshes.length} object(s) in scene. ⌘-click to select several.</p>
        {clipboard && (
          <>
            <div className="divider" />
            <button className="btn full" onClick={() => pasteMesh()}>Paste “{clipboard.label || 'object'}” (⌘V)</button>
          </>
        )}
      </div>
    );
  }

  const isModel = (mesh.kind === 'meshy' || mesh.kind === 'stl') && mesh.modelUrl;

  const rot = mesh.rotation || [0, 0, 0];

  const setPos = (i, v) => {
    const position = [...mesh.position];
    position[i] = parseFloat(v) || 0;
    updateMesh(mesh.id, { position });
  };
  const setRot = (i, deg) => {
    const rotation = [...rot];
    rotation[i] = (parseFloat(deg) || 0) / DEG;
    updateMesh(mesh.id, { rotation });
  };

  return (
    <div className="panel scroll">
      <h3>Inspector</h3>

      <label className="lbl">Transform tool</label>
      <div className="seg">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={'seg-btn' + (transformMode === m.id ? ' on' : '')}
            onClick={() => setTransformMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small">Drag the on-object gizmo, or fine-tune below.</p>

      <label className="lbl">Label</label>
      <input value={mesh.label || ''} onChange={(e) => updateMesh(mesh.id, { label: e.target.value })} />

      <label className="lbl">Position (m)</label>
      <div className="row">
        {AXES.map((a, i) => (
          <input key={a} type="number" step="0.05" value={mesh.position[i]} onChange={(e) => setPos(i, e.target.value)} />
        ))}
      </div>

      <label className="lbl">Rotation (°)</label>
      <div className="row">
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="5"
            value={Math.round(rot[i] * DEG)}
            onChange={(e) => setRot(i, e.target.value)}
          />
        ))}
      </div>
      <div className="row">
        <button className="btn ghost" onClick={() => updateMesh(mesh.id, { rotation: [0, 0, 0] })}>Reset rotation</button>
      </div>

      <label className="lbl">Scale (X / Y / Z) — stretch freely</label>
      <div className="row">
        {AXES.map((a, i) => (
          <input
            key={a}
            type="number"
            step="0.05"
            min="0.01"
            value={scaleArr(mesh.scale)[i]}
            onChange={(e) => {
              const sc = [...scaleArr(mesh.scale)];
              sc[i] = Math.max(0.01, parseFloat(e.target.value) || 0.01);
              updateMesh(mesh.id, { scale: packScale(sc[0], sc[1], sc[2]) });
            }}
          />
        ))}
      </div>
      <label className="lbl">Uniform — {avgScale(mesh.scale).toFixed(2)}×</label>
      <input
        type="range" min="0.1" max="4" step="0.05"
        value={avgScale(mesh.scale)}
        onChange={(e) => updateMesh(mesh.id, { scale: parseFloat(e.target.value) })}
      />

      {/* Real corner geometry — an arc or a facet actually cut into the solid,
          not a shader trick. The radius is validated against the body's own
          dimensions and refuses with a reason rather than breaking silently. */}
      {isRoundable(mesh.kind) && (() => {
        const max = maxCornerRadiusMm(mesh);
        const cur = Number(mesh.cornerRadius_mm) || 0;
        const check = validateCornerRadius(mesh, cur);
        const dims = trueDimsMm(mesh);
        return (
          <>
            <div className="divider" />
            <label className="lbl">
              Corner radius — {cur.toFixed(2)} mm <span className="muted">(max {max.toFixed(2)} mm · {ROUNDABLE[mesh.kind]})</span>
            </label>
            <div className="row">
              <input
                type="range" min="0" max={Math.max(max, 0.01)} step={Math.max(max / 200, 0.01)}
                value={Math.min(cur, max)}
                onChange={(e) => updateMesh(mesh.id, { cornerRadius_mm: parseFloat(e.target.value) })}
              />
              <input
                type="number" min="0" step="0.1" value={cur}
                style={{ width: 74 }}
                onChange={(e) => updateMesh(mesh.id, { cornerRadius_mm: parseFloat(e.target.value) || 0 })}
              />
            </div>
            {!check.ok && <p className="status error small">{check.reason}</p>}
            {check.ok && check.note && <p className="muted small">{check.note}</p>}
            {cur > 0 && (
              <>
                <label className="lbl">Corner type</label>
                <div className="seg">
                  {Object.values(CORNER_STYLES).map((st) => (
                    <button
                      key={st.id}
                      className={'seg-btn' + ((mesh.cornerStyle || 'round') === st.id ? ' on' : '')}
                      title={st.detail}
                      onClick={() => updateMesh(mesh.id, { cornerStyle: st.id })}
                    >{st.label}</button>
                  ))}
                </div>
                <label className="lbl">
                  Arc segments — {mesh.cornerSegments || CORNER_STYLES[mesh.cornerStyle || 'round'].segments}
                  <span className="muted"> (higher = smoother, heavier to export)</span>
                </label>
                <input
                  type="range" min="1" max="16" step="1"
                  value={mesh.cornerSegments || CORNER_STYLES[mesh.cornerStyle || 'round'].segments}
                  onChange={(e) => updateMesh(mesh.id, { cornerSegments: parseInt(e.target.value, 10) })}
                />
                <p className="muted small">
                  Body is {dims.map((d) => d.toFixed(1)).join(' × ')} mm. The radius is baked into the
                  geometry at true size, so it stays circular on every axis even when the body is stretched.
                </p>
              </>
            )}
          </>
        );
      })()}

      <label className="lbl">Color</label>
      <input type="color" value={mesh.color} onChange={(e) => updateMesh(mesh.id, { color: e.target.value })} />

      {mesh.kind === 'part' && mesh.mm && (
        <p className="muted small">Footprint: {mesh.mm[0].toFixed(0)}×{mesh.mm[2].toFixed(0)}×{mesh.mm[1].toFixed(0)} mm (real scale)</p>
      )}
      {mesh.kind === 'part' && <ScreenPreview mesh={mesh} />}

      {/* ── B-rep kernel ────────────────────────────────────────────────
          These operations run in OpenCascade, on a real solid with real edge
          topology. A radius the geometry cannot carry is REFUSED by the
          kernel and the reason is shown — no broken geometry is ever
          produced. The result is a baked solid, so the parametric primitive
          is gone until you undo. */}
      {kernelSupports(mesh.kind) && (
        <>
          <div className="divider" />
          <label className="lbl">
            B-rep kernel <span className="muted">(OpenCascade — real solid operations)</span>
          </label>
          <div className="seg">
            {[['fillet', 'Fillet'], ['chamfer', 'Chamfer'], ['shell', 'Hollow']].map(([id, label]) => (
              <button key={id} className={'seg-btn' + (kOp === id ? ' on' : '')} onClick={() => { setKOp(id); setKMsg(null); }}>{label}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input
              type="number" min="0.1" step="0.1" value={kVal} style={{ width: 84 }}
              onChange={(e) => setKVal(parseFloat(e.target.value) || 0)}
            />
            <span className="muted small">
              {kOp === 'shell' ? 'wall thickness (mm)' : kOp === 'chamfer' ? 'distance (mm)' : 'radius (mm)'}
            </span>
            <button
              className="btn primary" disabled={kBusy}
              onClick={async () => {
                setKBusy(true); setKMsg({ kind: 'info', text: kernelStatus().loading || !kernelStatus().ready ? 'Loading the B-rep kernel (~64 MB, once per session)…' : 'Running…' });
                const args = kOp === 'shell' ? { thicknessMm: kVal } : kOp === 'chamfer' ? { distanceMm: kVal } : { radiusMm: kVal };
                const r = await runKernelOp(mesh, kOp, args);
                if (r.ok) {
                  replaceMesh(mesh.id, r.mesh);
                  setKMsg({ kind: 'ok', text: `${kOp} applied — ${r.summary}` });
                } else {
                  setKMsg({ kind: 'err', text: r.reason });
                }
                setKBusy(false);
              }}
            >{kBusy ? '…' : 'Apply'}</button>
          </div>
          {kMsg && (
            <p className={kMsg.kind === 'err' ? 'status error small' : kMsg.kind === 'ok' ? 'status ok small' : 'muted small'}>
              {kMsg.text}
            </p>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn ghost" disabled={kBusy} onClick={async () => {
              setKBusy(true);
              const n = await edgeCount(mesh);
              setKEdges(n); setKBusy(false);
            }}>Count edges</button>
            <button className="btn ghost" disabled={kBusy} onClick={async () => {
              setKBusy(true); setKMsg({ kind: 'info', text: 'Exporting STEP…' });
              const r = await meshToSTEP(mesh);
              if (r.ok) {
                await window.forge.saveFile({ defaultName: (mesh.label || 'body').replace(/[^\w.-]+/g, '_') + '.step', content: r.text, filters: [{ name: 'STEP', extensions: ['step', 'stp'] }] });
                setKMsg({ kind: 'ok', text: `STEP exported — ${r.bytes.toLocaleString()} bytes` });
              } else setKMsg({ kind: 'err', text: r.reason });
              setKBusy(false);
            }}>Export STEP</button>
          </div>
          {kEdges != null && <p className="muted small">{kEdges} addressable edges on this solid.</p>}
          <p className="muted small">
            Kernel operations replace the primitive with a baked solid — the sliders above stop
            applying until you undo. {KERNEL_UNLOCKS[0]}.
          </p>
        </>
      )}

      <div className="divider" />
      <label className="lbl">Group & boolean cut</label>
      {selectedIds.length > 1 && !mesh.groupId && (
        <button className="btn full" onClick={groupSelected}>⬚ Group {selectedIds.length} objects (⌘G)</button>
      )}
      {mesh.groupId && (
        <>
          <button
            className="btn primary full"
            title="Bake the group into ONE real object (union minus negatives). It then moves, rotates and exports as a single shape — and can be cut again."
            onClick={() => {
              const members = meshes.filter((m) => m.groupId === mesh.groupId);
              const baked = mergeMembersToBaked(members);
              if (baked) bakeGroup(mesh.groupId, baked);
            }}
          >
            ⊕ Merge into one object
          </button>
          <button className="btn full" onClick={ungroupSelected}>⬚ Ungroup (⌘⇧G)</button>
          <label className="lbl">Group members — click to edit one</label>
          <div className="row wrap">
            {meshes.filter((m) => m.groupId === mesh.groupId).map((m) => (
              <button
                key={m.id}
                className={'btn' + (selectedId === m.id && selectedIds.length === 1 ? ' primary' : '')}
                style={m.negative ? { borderColor: '#ef4444', color: '#ef4444' } : undefined}
                onClick={() => selectMeshOnly(m.id)}
                title={m.negative ? 'negative (cuts)' : 'positive'}
              >
                {m.negative ? '⊖ ' : ''}{m.label || m.kind}
              </button>
            ))}
          </div>
        </>
      )}
      {!isModel && (
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(mesh.negative)}
            onChange={(e) => setMeshNegative(mesh.id, e.target.checked)}
          />
          <span>Negative object — carves its shape out of the positive objects in its group</span>
        </label>
      )}
      <p className="muted small">
        ⌘-click several objects → Group. A red <b>negative</b> shape inside a group cuts a hole where it
        overlaps. Move it while grouped to sculpt live. (AI/STL models join groups but don't cut.)
      </p>

      <div className="divider" />
      <label className="lbl">Attach to object</label>
      <select
        value={mesh.attachedTo || ''}
        onChange={(e) => setAttachment(mesh.id, e.target.value || null)}
      >
        <option value="">— none —</option>
        {meshes.filter((m) => m.id !== mesh.id).map((m) => (
          <option key={m.id} value={m.id}>{m.label || m.kind} ({m.id.slice(0, 6)})</option>
        ))}
      </select>
      {mesh.attachedTo && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={mesh.drives !== false}
              onChange={(e) => setAttachment(mesh.id, mesh.attachedTo, e.target.checked)}
            />
            <span>Drives it (spins the target when this motor is powered)</span>
          </label>
          {mesh.drives !== false && (
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(mesh.spinReverse)}
                onChange={(e) => setSpinReverse(mesh.id, e.target.checked)}
              />
              <span>Reverse spin direction (−)</span>
            </label>
          )}
        </>
      )}
      <p className="muted small">Mount a motor/servo onto a wheel or arm — in the Life Sim the target spins while the driver has power.</p>

      <div className="divider" />
      <div className="row">
        <button className="btn" title="Copy (⌘C)" onClick={() => copyMesh(mesh.id)}>Copy</button>
        <button className="btn" title="Paste (⌘V)" disabled={!clipboard} onClick={() => pasteMesh()}>Paste</button>
        <button className="btn" title="Duplicate (⌘D)" onClick={() => duplicateMesh(mesh.id)}>Duplicate</button>
      </div>
      <button className="btn danger full" onClick={() => removeMesh(mesh.id)}>Delete object (⌫)</button>
    </div>
  );
}
