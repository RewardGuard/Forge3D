// Auto-framing for captures: before a screenshot/look, point the camera so the
// WHOLE design is in frame. Claude's field feedback: captures were useless when
// the design outgrew the camera (a 345 mm panel fills the room at scene scale) —
// only a corner was visible. Each mounted Canvas registers a fitter; capture
// calls them all right before reading pixels.
import * as THREE from 'three';
import { useStore } from './store.js';
import { worldAABB } from './orchestraGeometry.js';

const fitters = new Set();

// Called by a component INSIDE each Canvas (has camera + controls). Returns an
// unregister function for unmount.
export function registerFitter(fn) {
  fitters.add(fn);
  return () => fitters.delete(fn);
}

export function fitAllViewports() {
  let n = 0;
  for (const f of fitters) { try { f(); n++; } catch { /* a stale fitter must not break capture */ } }
  return n;
}

// Shared math: frame the current design (union of every solid mesh's world AABB)
// with the given camera/controls, keeping the current viewing direction.
export function frameScene(camera, controls) {
  const meshes = useStore.getState().meshes.filter((m) => !m.negative);
  if (!meshes.length || !camera) return false;
  const box = new THREE.Box3();
  for (const m of meshes) box.union(worldAABB(m));
  if (box.isEmpty()) return false;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;

  // distance that fits the bounding sphere in BOTH the vertical and horizontal fov
  const vFov = ((camera.fov || 45) * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
  const minFov = Math.min(vFov, hFov);
  const dist = Math.max((sphere.radius * 1.15) / Math.sin(minFov / 2), sphere.radius + 0.5);

  // keep the current viewing direction so the shot still "looks like" the scene
  const from = controls?.target ? camera.position.clone().sub(controls.target) : camera.position.clone().sub(center);
  if (from.lengthSq() < 1e-6) from.set(1, 0.8, 1);
  from.normalize();

  camera.position.copy(center.clone().add(from.multiplyScalar(dist)));
  camera.near = Math.max(0.01, dist / 200);
  camera.far = Math.max(camera.far || 1000, dist * 20);
  camera.updateProjectionMatrix();
  if (controls?.target) { controls.target.copy(center); controls.update?.(); }
  else camera.lookAt(center);
  return true;
}
