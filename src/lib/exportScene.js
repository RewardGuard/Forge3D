// Export the current 3D scene to glTF (.gltf JSON) or binary glTF (.glb). We
// rebuild a plain THREE scene from the store's mesh list so we don't depend on
// the live R3F fiber tree. Imported STL/GLB models are fetched and embedded
// with their real geometry (normalized + transformed) rather than placeholders.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { resolveMaterial } from './lifesim.js';

const QUALITY = {
  low:    { seg: 12, ring: 32 },
  medium: { seg: 24, ring: 64 },
  high:   { seg: 48, ring: 128 },
};

function primitiveGeometry(mesh, q) {
  const s = q.seg;
  switch (mesh.kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, s, s);
    case 'cylinder': return new THREE.CylinderGeometry(0.4, 0.4, 1, q.ring);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, q.ring);
    case 'pyramid': return new THREE.ConeGeometry(0.6, 1, 4);
    case 'torus': return new THREE.TorusGeometry(0.4, 0.16, Math.max(12, s), q.ring);
    case 'torusknot': return new THREE.TorusKnotGeometry(0.34, 0.12, q.ring, Math.max(12, s));
    case 'plane': return new THREE.BoxGeometry(1, 0.02, 1);
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.6, Math.max(4, s / 2), q.ring);
    case 'tetrahedron': return new THREE.TetrahedronGeometry(0.6);
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.6);
    case 'part': return new THREE.BoxGeometry(...(mesh.size || [0.1, 0.1, 0.1]));
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function materialFor(mesh) {
  const phys = resolveMaterial(mesh);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(mesh.color || '#9aa7bd'),
    metalness: phys.metal ? 0.9 : 0.08,
    roughness: phys.metal ? 0.34 : 0.62,
  });
}

// Load a remote STL and return a centered+normalized geometry (~1 unit).
function loadSTL(url) {
  return new Promise((resolve, reject) => {
    new STLLoader().load(url, (g) => {
      g.computeBoundingBox();
      const b = g.boundingBox;
      g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
      g.computeVertexNormals();
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
      g.scale(1 / size, 1 / size, 1 / size);
      resolve(g);
    }, undefined, reject);
  });
}

// Load a remote GLB and return a centered+normalized Object3D (~1 unit).
function loadGLB(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => {
      const obj = gltf.scene;
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const wrap = new THREE.Group();
      obj.position.set(-center.x, -center.y, -center.z);
      wrap.add(obj);
      wrap.scale.setScalar(1 / longest);
      resolve(wrap);
    }, undefined, reject);
  });
}

function applyTransform(obj, mesh) {
  const p = mesh.position || [0, 0, 0];
  const r = mesh.rotation || [0, 0, 0];
  const sc = mesh.scale ?? 1;
  obj.position.set(p[0], p[1], p[2]);
  obj.rotation.set(r[0], r[1], r[2]);
  if (Array.isArray(sc)) obj.scale.multiply(new THREE.Vector3(sc[0], sc[1], sc[2]));
  else obj.scale.multiplyScalar(sc);
  obj.name = mesh.label || mesh.kind || mesh.id;
}

export async function buildSceneFromMeshes(meshes, quality = 'medium') {
  const q = QUALITY[quality] || QUALITY.medium;
  const root = new THREE.Scene();
  for (const mesh of meshes) {
    let node = null;
    try {
      if (mesh.kind === 'stl' && mesh.modelUrl) {
        const geo = await loadSTL(mesh.modelUrl);
        node = new THREE.Mesh(geo, materialFor(mesh));
      } else if (mesh.kind === 'meshy' && mesh.modelUrl) {
        node = await loadGLB(mesh.modelUrl);
      }
    } catch (err) {
      // fall back to a primitive box if the fetch/parse fails
      console.warn('Export: model load failed, using placeholder', mesh.id, err);
      node = null;
    }
    if (!node) {
      node = new THREE.Mesh(primitiveGeometry(mesh, q), materialFor(mesh));
    }
    applyTransform(node, mesh);
    root.add(node);
  }
  return root;
}

// Returns a Promise<string> of the .gltf JSON text.
export async function exportSceneToGltf(meshes, quality = 'medium') {
  const scene = await buildSceneFromMeshes(meshes, quality);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(JSON.stringify(result, null, 0)),
      (err) => reject(err),
      { binary: false, onlyVisible: false }
    );
  });
}

// Returns a Promise<string> of base64-encoded binary .stl bytes — the format
// the da Vinci mini maker (XYZware) accepts for 3D printing.
export async function exportSceneToStl(meshes, quality = 'medium') {
  const scene = await buildSceneFromMeshes(meshes, quality);
  scene.updateMatrixWorld(true);
  const exporter = new STLExporter();
  const result = exporter.parse(scene, { binary: true }); // DataView
  const bytes = new Uint8Array(result.buffer || result);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Returns a Promise<string> of base64-encoded binary .glb bytes.
export async function exportSceneToGlb(meshes, quality = 'medium') {
  const scene = await buildSceneFromMeshes(meshes, quality);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        // result is an ArrayBuffer when binary:true
        const bytes = new Uint8Array(result);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        resolve(btoa(binary));
      },
      (err) => reject(err),
      { binary: true, onlyVisible: false }
    );
  });
}
