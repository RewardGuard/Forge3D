import React, { useEffect, useMemo } from 'react';
import { makeGeometry, hasFeatureGeom } from '../lib/geometryFactory.js';
import { hasBakedScale } from '../lib/rounding.js';

// The ONE place a viewport turns a store mesh into three geometry. Every
// renderer (3D Design, Orchestra stage, Life Sim) goes through here so a body
// looks the same everywhere: kernel features and corner radii are baked at
// true size (draw them with geometryScale → [1,1,1]); plain primitives are
// unit shapes the parent scales.
//
// Before this existed the 3D viewport drew a rounded body as a UNIT CUBE —
// geometryScale said "already true size" while the geometry was the bare
// primitive — so setting a corner radius collapsed the part to 1×1×1 and
// showed no rounding at all.
export default function MeshGeometry({ mesh }) {
  const baked = mesh.kind === 'baked' || hasFeatureGeom(mesh) || hasBakedScale(mesh);
  // what the baked geometry depends on — rebuild only when one of these moves
  const sig = baked
    ? JSON.stringify([mesh.kind, mesh.scale, mesh.cornerRadius_mm, mesh.cornerStyle, mesh.cornerSegments,
        (mesh.features || []).map((f) => [f.type, f.enabled, f.params])])
    : null;
  // (geom / featureGeom are compared by identity — the store replaces them whole)
  const geo = useMemo(() => (baked ? makeGeometry(mesh) : null), [sig, mesh.geom, mesh.featureGeom]);
  useEffect(() => () => { geo?.dispose?.(); }, [geo]);

  if (geo) return <primitive object={geo} attach="geometry" />;
  switch (mesh.kind) {
    case 'sphere': return <sphereGeometry args={[0.5, 32, 32]} />;
    case 'cylinder': return <cylinderGeometry args={[0.4, 0.4, 1, 48]} />;
    case 'cone': return <coneGeometry args={[0.5, 1, 48]} />;
    case 'pyramid': return <coneGeometry args={[0.6, 1, 4]} />;
    case 'torus': return <torusGeometry args={[0.4, 0.16, 24, 64]} />;
    case 'torusknot': return <torusKnotGeometry args={[0.34, 0.12, 128, 24]} />;
    case 'plane': return <boxGeometry args={[1, 0.02, 1]} />;
    case 'capsule': return <capsuleGeometry args={[0.3, 0.6, 8, 24]} />;
    case 'tetrahedron': return <tetrahedronGeometry args={[0.6]} />;
    case 'icosahedron': return <icosahedronGeometry args={[0.6]} />;
    case 'part': return <boxGeometry args={mesh.size || [0.1, 0.1, 0.1]} />;
    default: return <boxGeometry args={[1, 1, 1]} />;
  }
}
