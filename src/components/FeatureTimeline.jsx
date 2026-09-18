// The feature timeline — every kernel operation on a body, in order,
// editable, toggleable, reorderable. This is what makes the body
// parametric: change a number here and the geometry regenerates.
import React, { useEffect } from 'react';
import { useStore } from '../lib/store.js';
import { FEATURE_TYPES, describeFeature, scheduleRegenerate, featureSignature } from '../lib/features.js';

export default function FeatureTimeline({ mesh }) {
  const updateFeature = useStore((s) => s.updateFeature);
  const toggleFeature = useStore((s) => s.toggleFeature);
  const removeFeature = useStore((s) => s.removeFeature);
  const moveFeature = useStore((s) => s.moveFeature);
  const setEdgePickActive = useStore((s) => s.setEdgePickActive);
  const edgePick = useStore((s) => s.edgePick);
  const clearEdgePick = useStore((s) => s.clearEdgePick);
  const features = mesh?.features || [];
  const pickingThis = edgePick.active && edgePick.meshId === mesh?.id;

  // any change to the base or the list → regenerate (debounced)
  const sig = mesh ? featureSignature(mesh) : '';
  useEffect(() => { if (mesh && features.length) scheduleRegenerate(mesh.id); }, [sig]);

  if (!features.length) return null;
  const stepOf = (id) => (mesh.featureSteps || []).find((s) => s.id === id);

  return (
    <div className="ft">
      <label className="lbl">
        Features <span className="muted">— {features.filter((f) => f.enabled).length} active{mesh.featureBusy ? ' · regenerating…' : ''}</span>
      </label>
      {features.map((f, i) => {
        const st = stepOf(f.id);
        const failed = st && !st.ok;
        const def = FEATURE_TYPES[f.type];
        return (
          <div key={f.id} className={'ft-row' + (f.enabled ? '' : ' off') + (failed ? ' failed' : '')}>
            <div className="ft-head">
              <button className="ft-tog" title={f.enabled ? 'Suppress' : 'Unsuppress'} onClick={() => toggleFeature(mesh.id, f.id)}>{f.enabled ? '●' : '○'}</button>
              <span className="ft-icon">{def?.icon}</span>
              <span className="ft-title" title={describeFeature(f)}>{describeFeature(f)}</span>
              <span className="ft-actions">
                <button className="ft-btn" disabled={i === 0} onClick={() => moveFeature(mesh.id, f.id, -1)} title="Earlier">↑</button>
                <button className="ft-btn" disabled={i === features.length - 1} onClick={() => moveFeature(mesh.id, f.id, 1)} title="Later">↓</button>
                <button className="ft-btn" onClick={() => removeFeature(mesh.id, f.id)} title="Delete feature">✕</button>
              </span>
            </div>
            <div className="ft-params">
              {st?.ok && st.faces && <span className="muted small ft-faces" title="Faces before → after this step">{st.faces} faces</span>}
              {f.type === 'fillet' && (
                <label>r <input type="number" step="0.1" min="0.01" value={f.params.radius_mm} onChange={(e) => updateFeature(mesh.id, f.id, { radius_mm: parseFloat(e.target.value) || 0.01 })} /> mm</label>
              )}
              {f.type === 'chamfer' && (
                <label>d <input type="number" step="0.1" min="0.01" value={f.params.distance_mm} onChange={(e) => updateFeature(mesh.id, f.id, { distance_mm: parseFloat(e.target.value) || 0.01 })} /> mm</label>
              )}
              {f.type === 'shell' && (
                <>
                  <label>wall <input type="number" step="0.1" min="0.05" value={f.params.thickness_mm} onChange={(e) => updateFeature(mesh.id, f.id, { thickness_mm: parseFloat(e.target.value) || 0.05 })} /> mm</label>
                  <label><input type="checkbox" checked={f.params.openFace != null} onChange={(e) => updateFeature(mesh.id, f.id, { openFace: e.target.checked ? 0 : null })} /> open</label>
                </>
              )}
              {(f.type === 'fillet' || f.type === 'chamfer') && (
                <>
                  <button className="ft-btn" title="Re-pick which edges this feature applies to"
                    onClick={() => { setEdgePickActive(true); }}>
                    {f.params.edgeIndices?.length ? `${f.params.edgeIndices.length} edges` : 'all edges'} ◈
                  </button>
                  {pickingThis && (
                    <button className="ft-btn" style={{ color: 'var(--accent)' }} title="Apply the edges picked in the 3D view to this feature"
                      onClick={() => { updateFeature(mesh.id, f.id, { edgeIndices: edgePick.indices.length ? [...edgePick.indices] : null }); clearEdgePick(); }}>
                      ✓ use {edgePick.indices.length || 'all'}
                    </button>
                  )}
                </>
              )}
            </div>
            {failed && (
              <p className="ft-err">
                ✕ {st.reason}{st.maxMm != null ? ` Max here: ${st.maxMm.toFixed(2)} mm.` : ''} — later features are paused; the last valid shape is shown.
                {f.type === 'shell' && i > 0 && features.slice(0, i).some((x) => x.enabled && (x.type === 'fillet' || x.type === 'chamfer')) && (
                  <> <b>Tip:</b> the kernel cannot hollow through rounded edges — move this shell above the fillet/chamfer (↑), then round with a radius under the wall thickness.</>
                )}
              </p>
            )}
          </div>
        );
      })}
      {mesh.featureError && !features.some((f) => stepOf(f.id) && !stepOf(f.id).ok) && <p className="ft-err">✕ {mesh.featureError}</p>}
      <p className="muted small">The primitive underneath is still editable — resize it and every feature replays. Edge picks refer to the shape at that step; if an earlier feature changes the topology they may need re-picking.</p>
    </div>
  );
}
