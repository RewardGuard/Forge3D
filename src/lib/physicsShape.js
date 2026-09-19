// Collision shapes for the Life Sim (Rapier). Kept out of the component so
// the rule "a merged tray does not get an invisible ceiling" is testable in Node.
import * as THREE from 'three';
import { makeGeometry, geometryScale, hasFeatureGeom } from './geometryFactory.js';
import { scaleArr } from './scaleUtil.js';

// A merged group (four walls → a tray) or a hollowed shell is NOT convex: a
// convex hull fills the cavity and an object dropped in lands on an invisible
// ceiling. Those bodies collide with their real triangles instead.
// (Rapier does not resolve trimesh-vs-trimesh contacts, so two merged bodies
// pass through each other; trimesh-vs-box/ball/hull is exact.)
export const needsTrimesh = (m) => m.kind === 'baked' || hasFeatureGeom(m) || (m.features || []).some((f) => f.enabled && f.type === 'shell');
export function trimeshArgs(m) {
  const g = makeGeometry(m);
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3(...(m.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(m.rotation || [0, 0, 0]))),
    new THREE.Vector3(...geometryScale(m, scaleArr)),
  );
  g.applyMatrix4(mat);
  const pos = g.getAttribute('position');
  const vertices = new Float32Array(pos.array.length);
  vertices.set(pos.array);
  const indices = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  g.computeBoundingBox();
  const size = new THREE.Vector3(); g.boundingBox.getSize(size);
  g.dispose();
  // a trimesh has no volume for Rapier — give it the mass a solid of the same
  // envelope would get from the default density, so it falls like the others
  const mass = Math.max(0.01, size.x * size.y * size.z);
  return { vertices, indices, mass };
}

// Point-in-solid by ray parity, on a trimesh — used by tests to prove a cavity
// is really empty in the collision shape (a convex hull would contain it).
export function trimeshContains({ vertices, indices }, [px, py, pz]) {
  let hits = 0;
  const dir = [0.3849, 0.8113, 0.4401]; // an irrational-ish direction avoids edge-on hits
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const v0 = [vertices[a], vertices[a + 1], vertices[a + 2]], v1 = [vertices[b], vertices[b + 1], vertices[b + 2]], v2 = [vertices[c], vertices[c + 1], vertices[c + 2]];
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]], e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const f = 1 / det, s = [px - v0[0], py - v0[1], pz - v0[2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    if (t > 1e-9) hits++;
  }
  return hits % 2 === 1;
}
