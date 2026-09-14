// Clickable edges for kernel operations.
//
// Each edge of the selected primitive is drawn as a thin tube you can click.
// Tubes rather than lines because a 1-px line is unclickable; the tube radius
// scales with the body so it reads the same on a 5 mm boss and a 500 mm
// beam. Selected edges light up in the accent colour; the Inspector then
// fillets or chamfers exactly those.
//
// Drawn OUTSIDE the mesh's scaled group: the kernel returns edge points at
// the body's true size already, so scaling them again would double-apply.
import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../lib/store.js';
import { meshEdgePolylines } from '../lib/kernelBridge.js';

const COLOR = { idle: '#9aa4b2', hover: '#e5e7eb', on: '#3b82f6' };

function EdgeTube({ edge, radius, selected, onToggle }) {
  const [hover, setHover] = useState(false);
  const geo = useMemo(() => {
    const pts = edge.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    if (pts.length < 2) return null;
    const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    return new THREE.TubeGeometry(curve, Math.max(2, pts.length * 2), radius, 6, false);
  }, [edge, radius]);
  if (!geo) return null;
  return (
    <mesh
      geometry={geo}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={() => setHover(false)}
    >
      <meshBasicMaterial color={selected ? COLOR.on : hover ? COLOR.hover : COLOR.idle} transparent opacity={selected ? 1 : 0.85} depthTest={false} />
    </mesh>
  );
}

export default function EdgePicker({ mesh }) {
  const edgePick = useStore((s) => s.edgePick);
  const toggleEdge = useStore((s) => s.toggleEdge);
  const [edges, setEdges] = useState([]);
  const active = edgePick.active && edgePick.meshId === mesh.id;

  // Re-sample when the body changes shape or size.
  const sig = `${mesh.kind}|${JSON.stringify(mesh.scale)}|${mesh.cornerRadius_mm || 0}`;
  useEffect(() => {
    if (!active) { setEdges([]); return; }
    let live = true;
    meshEdgePolylines(mesh).then((e) => { if (live) setEdges(e); });
    return () => { live = false; };
  }, [active, mesh.id, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !edges.length) return null;

  // tube radius: ~1% of the longest edge, clamped so it stays visible
  const longest = Math.max(...edges.map((e) => Math.max(...e.points.flat().map(Math.abs))), 0.05);
  const radius = Math.min(Math.max(longest * 0.012, 0.004), 0.04);

  return (
    <group position={mesh.position} rotation={mesh.rotation || [0, 0, 0]} renderOrder={999}>
      {edges.map((e) => (
        <EdgeTube key={e.index} edge={e} radius={radius}
          selected={edgePick.indices.includes(e.index)}
          onToggle={() => toggleEdge(mesh.id, e.index)} />
      ))}
    </group>
  );
}
