// Imperative THREE geometry builder shared by the CSG renderer, the group
// merger and the exporters. Includes 'baked' — a mesh whose geometry was
// produced by merging a group (stored as raw position/normal arrays).
import * as THREE from 'three';

export function makeGeometry(mesh) {
  switch (mesh.kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 32, 32);
    case 'cylinder': return new THREE.CylinderGeometry(0.4, 0.4, 1, 48);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 48);
    case 'pyramid': return new THREE.ConeGeometry(0.6, 1, 4);
    case 'torus': return new THREE.TorusGeometry(0.4, 0.16, 24, 64);
    case 'torusknot': return new THREE.TorusKnotGeometry(0.34, 0.12, 128, 24);
    case 'plane': return new THREE.BoxGeometry(1, 0.02, 1);
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.6, 8, 24);
    case 'tetrahedron': return new THREE.TetrahedronGeometry(0.6);
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.6);
    case 'part': return new THREE.BoxGeometry(...(mesh.size || [0.1, 0.1, 0.1]));
    case 'baked': return bakedGeometry(mesh);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

// Rebuild a BufferGeometry from the serialized arrays of a merged object.
export function bakedGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  const d = mesh.geom || {};
  g.setAttribute('position', new THREE.Float32BufferAttribute(d.positions || [], 3));
  if (d.normals && d.normals.length) {
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.normals, 3));
  } else {
    g.computeVertexNormals();
  }
  return g;
}
