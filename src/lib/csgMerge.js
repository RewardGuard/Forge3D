// Bake a group into ONE real object: union of the positive members minus the
// negatives, returned as serializable geometry (centered, world-size). The
// result behaves like any other mesh — select, transform, cut again, export.
import * as THREE from 'three';
import { Evaluator, Brush, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { makeGeometry } from './geometryFactory.js';
import { scaleArr } from './scaleUtil.js';

const canMerge = (m) => !((m.kind === 'meshy' || m.kind === 'stl') && m.modelUrl);

export function mergeMembersToBaked(members) {
  const ev = new Evaluator();
  const brushFor = (m) => {
    const g = makeGeometry(m);
    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(...m.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(m.rotation || [0, 0, 0]))),
      new THREE.Vector3(...scaleArr(m.scale)),
    );
    g.applyMatrix4(mat); // bake world transform
    return new Brush(g);
  };

  let result = null;
  for (const m of members) {
    if (m.negative || !canMerge(m)) continue;
    const b = brushFor(m);
    result = result ? ev.evaluate(result, b, ADDITION) : b;
  }
  if (!result) return null;
  for (const m of members) {
    if (!m.negative || !canMerge(m)) continue;
    result = ev.evaluate(result, brushFor(m), SUBTRACTION);
  }

  // center the geometry so the new object's position is its bbox center
  const geo = result.geometry;
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  // keep the evaluator's normals — recomputing averages across the cut edges
  // and produces dark/jagged shading on the carved surfaces

  const positions = Array.from(geo.getAttribute('position').array);
  const normals = geo.getAttribute('normal') ? Array.from(geo.getAttribute('normal').array) : [];
  geo.computeBoundingBox();
  const halfY = (geo.boundingBox.max.y - geo.boundingBox.min.y) / 2 || 0.5;
  return { geom: { positions, normals }, center: [c.x, c.y, c.z], halfY };
}
