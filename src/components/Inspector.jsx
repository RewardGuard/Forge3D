import React from 'react';
import { useStore } from '../lib/store.js';
import { scaleArr, packScale, avgScale } from '../lib/scaleUtil.js';
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

      <label className="lbl">Color</label>
      <input type="color" value={mesh.color} onChange={(e) => updateMesh(mesh.id, { color: e.target.value })} />

      {mesh.kind === 'part' && mesh.mm && (
        <p className="muted small">Footprint: {mesh.mm[0].toFixed(0)}×{mesh.mm[2].toFixed(0)}×{mesh.mm[1].toFixed(0)} mm (real scale)</p>
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
