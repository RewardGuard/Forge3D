// Measurement panel — the selected body's real properties, and a "measure
// to" mode for distance and angle between two bodies. Every number shows
// whether it came from the kernel (exact) or the primitive model (analytic).
import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { measureBody, measureBetween, measureEdge } from '../lib/measure.js';

const fmt = (v, d = 2) => (Number.isFinite(v) ? Number(v).toFixed(d) : '—');
const vec = (a, d = 1) => (Array.isArray(a) ? a.map((v) => fmt(v, d)).join(', ') : '—');

function Row({ k, v, unit }) {
  return <tr><td className="ms-k">{k}</td><td className="ms-v">{v}</td><td className="ms-u">{unit || ''}</td></tr>;
}

export default function MeasurePanel({ mesh }) {
  const meshes = useStore((s) => s.meshes);
  const edgePick = useStore((s) => s.edgePick);
  const measureTarget = useStore((s) => s.measureTarget);
  const setMeasureTarget = useStore((s) => s.setMeasureTarget);
  const [body, setBody] = useState(null);
  const [between, setBetween] = useState(null);
  const [edge, setEdge] = useState(null);
  const [showInertia, setShowInertia] = useState(false);

  const sig = mesh ? `${mesh.id}|${mesh.kind}|${JSON.stringify(mesh.scale)}|${JSON.stringify(mesh.position)}|${JSON.stringify(mesh.rotation)}|${mesh.material || ''}|${mesh.cornerRadius_mm || 0}` : '';
  useEffect(() => {
    let live = true;
    if (!mesh) { setBody(null); return; }
    measureBody(mesh).then((r) => { if (live) setBody(r); });
    return () => { live = false; };
  }, [sig]); // eslint-disable-line

  const other = measureTarget ? meshes.find((m) => m.id === measureTarget) : null;
  useEffect(() => {
    let live = true;
    if (!mesh || !other) { setBetween(null); return; }
    measureBetween(mesh, other).then((r) => { if (live) setBetween(r); });
    return () => { live = false; };
  }, [sig, other?.id, JSON.stringify(other?.position), JSON.stringify(other?.rotation)]); // eslint-disable-line

  const pickedEdge = edgePick.active && edgePick.meshId === mesh?.id && edgePick.indices.length === 1 ? edgePick.indices[0] : null;
  useEffect(() => {
    let live = true;
    if (pickedEdge == null) { setEdge(null); return; }
    measureEdge(mesh, pickedEdge).then((r) => { if (live) setEdge(r); });
    return () => { live = false; };
  }, [sig, pickedEdge]); // eslint-disable-line

  if (!mesh) return null;

  return (
    <>
      <div className="divider" />
      <label className="lbl">
        Measure {body && <span className={'ms-badge ' + body.source}>{body.source === 'kernel' ? 'exact' : 'analytic'}</span>}
      </label>
      {body?.ok && (
        <table className="ms-table"><tbody>
          <Row k="Bounding box" v={vec(body.boundingBox?.size_mm)} unit="mm" />
          <Row k="Volume" v={fmt(body.volume_cm3, 3)} unit="cm³" />
          <Row k="Surface area" v={fmt(body.surfaceArea_cm2, 2)} unit="cm²" />
          <Row k="Mass" v={fmt(body.mass_g, 2)} unit={`g · ${body.material.name}`} />
          <Row k="Centre of mass" v={vec(body.centreOfMass_mm)} unit="mm" />
          {body.inertia_g_mm2 && (
            <tr><td colSpan={3}>
              <button className="link small" onClick={() => setShowInertia((v) => !v)}>{showInertia ? '▾' : '▸'} Inertia tensor</button>
            </td></tr>
          )}
          {body.inertia_g_mm2 && showInertia && (
            <>
              <Row k="Ixx / Iyy / Izz" v={`${fmt(body.inertia_g_mm2.Ixx, 0)} / ${fmt(body.inertia_g_mm2.Iyy, 0)} / ${fmt(body.inertia_g_mm2.Izz, 0)}`} unit="g·mm²" />
              <Row k="Ixy / Ixz / Iyz" v={`${fmt(body.inertia_g_mm2.Ixy, 0)} / ${fmt(body.inertia_g_mm2.Ixz, 0)} / ${fmt(body.inertia_g_mm2.Iyz, 0)}`} unit="g·mm²" />
              <Row k="Principal" v={vec(body.principalMoments_g_mm2, 0)} unit="g·mm²" />
              <Row k="Radius of gyration" v={vec(body.radiusOfGyration_mm, 2)} unit="mm" />
            </>
          )}
        </tbody></table>
      )}
      {body?.ok && <p className="muted small">{body.basis}</p>}

      {edge?.ok && (
        <>
          <label className="lbl">Edge {edge.edge} <span className="ms-badge kernel">exact</span></label>
          <table className="ms-table"><tbody>
            <Row k="Type" v={edge.type} />
            <Row k="Length" v={fmt(edge.length_mm, 3)} unit="mm" />
            {edge.radius_mm != null && <Row k="Radius / Ø" v={`${fmt(edge.radius_mm, 3)} / ${fmt(edge.diameter_mm, 3)}`} unit="mm" />}
            {edge.centre_mm && <Row k="Centre" v={vec(edge.centre_mm)} unit="mm" />}
          </tbody></table>
        </>
      )}

      <label className="lbl">Measure to another body</label>
      <select value={measureTarget || ''} onChange={(e) => setMeasureTarget(e.target.value || null)}>
        <option value="">— pick a body —</option>
        {meshes.filter((m) => m.id !== mesh.id).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
      </select>
      {between?.ok && (
        <>
          <table className="ms-table"><tbody>
            <Row k="Centre to centre" v={fmt(between.centreDistance_mm, 2)} unit="mm" />
            <Row k="Δ x / y / z" v={vec(between.delta_mm)} unit="mm" />
            {between.minDistance_mm != null && (
              <Row k="Surface to surface" v={between.touching ? 'touching' : fmt(between.minDistance_mm, 3)} unit={between.touching ? '' : 'mm'} />
            )}
            <Row k="Angle (Z axes)" v={fmt(between.angle_deg, 1)} unit="°" />
          </tbody></table>
          <p className="muted small">{between.basis}</p>
        </>
      )}
    </>
  );
}
