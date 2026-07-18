import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useLoader, useThree, useFrame } from '@react-three/fiber';
import {
  OrbitControls, Grid, GizmoHelper, GizmoViewport, Environment, useGLTF, TransformControls,
  ContactShadows, SoftShadows,
} from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Evaluator, Brush, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { useStore } from '../lib/store.js';
import { resolveMaterial } from '../lib/lifesim.js';
import { scaleArr, packScale } from '../lib/scaleUtil.js';
import { makeGeometry, bakedGeometry, prepareBrushGeometry } from '../lib/geometryFactory.js';
import CaptureFramer from './CaptureFramer.jsx';

// PBR hints derived from the mesh's assigned physical material (metal vs not).
function pbrFor(mesh) {
  const mat = resolveMaterial(mesh);
  return mat.metal
    ? { metalness: 0.9, roughness: 0.34 }
    : { metalness: 0.08, roughness: 0.62 };
}

// merged-group geometry, rebuilt from serialized arrays
function BakedGeometry({ mesh }) {
  const geo = React.useMemo(() => bakedGeometry(mesh), [mesh.geom]);
  return <primitive object={geo} attach="geometry" />;
}

// ---- primitive geometry for a given mesh kind ----
function PrimitiveGeometry({ mesh }) {
  if (mesh.kind === 'baked') return <BakedGeometry mesh={mesh} />;
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

// Loads a remote GLB (e.g. from Meshy) — centered and normalized to ~1 unit so
// the parent group's `scale` controls real size consistently with primitives.
function GLBInner({ mesh }) {
  const { scene } = useGLTF(mesh.modelUrl);
  const { cloned, norm, offset } = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    return { cloned: c, norm: 1 / longest, offset: center };
  }, [scene]);
  return (
    <group scale={[norm, norm, norm]}>
      <primitive object={cloned} position={[-offset.x, -offset.y, -offset.z]} />
    </group>
  );
}

// Loads a local/remote STL (e.g. from Thingiverse), centered + normalized to ~1 unit.
function STLInner({ mesh, selected }) {
  const geometry = useLoader(STLLoader, mesh.modelUrl);
  const { geo, norm } = useMemo(() => {
    const g = geometry.clone();
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
    g.computeVertexNormals();
    const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    return { geo: g, norm: 1 / size };
  }, [geometry]);
  const pbr = pbrFor(mesh);
  return (
    <mesh scale={[norm, norm, norm]} geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color={mesh.color || '#9aa7bd'} emissive={selected ? '#3b82f6' : '#000'} emissiveIntensity={selected ? 0.35 : 0} metalness={pbr.metalness} roughness={pbr.roughness} envMapIntensity={0.9} />
    </mesh>
  );
}

// Error boundary so a failed model fetch falls back to a primitive instead of a crash.
class MeshErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// Shared registry so the primary object's gizmo can move the other selected
// objects (multi-select group move).
const groupRegistry = new Map(); // mesh id -> THREE.Object3D

// (geometry building shared with the merger/exporters lives in geometryFactory)

// Can this mesh participate in boolean cuts? (loaded models are excluded —
// CSG on arbitrary GLB/STL geometry is too heavy/fragile for live editing)
const csgable = (m) => !((m.kind === 'meshy' || m.kind === 'stl') && m.modelUrl);

// A grouped set of objects rendered as ONE boolean result: union of the
// positives minus every negative. Recomputes live while you drag members.
function CSGGroup({ members }) {
  const selectMesh = useStore((s) => s.selectMesh);
  const selectedIds = useStore((s) => s.selectedMeshIds);
  const primary = members.find((m) => !m.negative && csgable(m));

  const depKey = JSON.stringify(members.map((m) => [m.id, m.kind, m.position, m.rotation, m.scale, m.negative, m.size, m.geom ? m.geom.positions.length : 0]));
  const geometry = useMemo(() => {
    const ev = new Evaluator();
    ev.attributes = ['position', 'normal']; // must match prepareBrushGeometry
    const brushFor = (m) => {
      const g = prepareBrushGeometry(makeGeometry(m));
      const mat = new THREE.Matrix4().compose(
        new THREE.Vector3(...m.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(m.rotation || [0, 0, 0]))),
        new THREE.Vector3(...scaleArr(m.scale)),
      );
      g.applyMatrix4(mat); // bake world transform so the result lives at origin
      return new Brush(g);
    };
    try {
      let result = null;
      for (const m of members) {
        if (m.negative || !csgable(m)) continue;
        const b = brushFor(m);
        result = result ? ev.evaluate(result, b, ADDITION) : b;
      }
      if (!result) return null;
      for (const m of members) {
        if (!m.negative || !csgable(m)) continue;
        result = ev.evaluate(result, brushFor(m), SUBTRACTION);
      }
      return result.geometry;
    } catch {
      return null; // degenerate geometry mid-drag — skip this frame's result
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  // FALLBACK: if the boolean can't be computed (degenerate / re-cut edge case),
  // render the csgable members individually so the object never disappears.
  if (!geometry || !primary) {
    return (
      <>
        {members.filter((m) => csgable(m) && !m.negative).map((m) => (
          <mesh
            key={m.id}
            position={m.position}
            rotation={m.rotation || [0, 0, 0]}
            scale={scaleArr(m.scale)}
            castShadow
            receiveShadow
            onClick={(e) => { e.stopPropagation(); selectMesh(m.id, e.nativeEvent?.metaKey || e.nativeEvent?.ctrlKey || e.nativeEvent?.shiftKey); }}
          >
            <PrimitiveGeometry mesh={m} />
            <meshStandardMaterial color={m.color} metalness={0.08} roughness={0.62} envMapIntensity={0.9} />
          </mesh>
        ))}
      </>
    );
  }
  const selected = selectedIds.includes(primary.id);
  const pbr = pbrFor(primary);
  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        const add = e.nativeEvent?.metaKey || e.nativeEvent?.ctrlKey || e.nativeEvent?.shiftKey;
        selectMesh(primary.id, add);
      }}
    >
      <meshStandardMaterial
        color={primary.color}
        emissive={selected ? '#3b82f6' : '#000'}
        emissiveIntensity={selected ? 0.35 : 0}
        metalness={pbr.metalness}
        roughness={pbr.roughness}
        envMapIntensity={0.9}
      />
    </mesh>
  );
}

function MeshItem({ mesh, ghost = false }) {
  const selectedIds = useStore((s) => s.selectedMeshIds);
  const isPrimary = useStore((s) => s.selectedMeshId === mesh.id);
  const transformMode = useStore((s) => s.transformMode);
  const selectMesh = useStore((s) => s.selectMesh);
  const updateMeshes = useStore((s) => s.updateMeshes);
  const groupRef = useRef();
  const tcRef = useRef();
  const dragBase = useRef(null);

  const selected = selectedIds.includes(mesh.id);

  // register/unregister this object3D for sibling moves
  useEffect(() => {
    groupRegistry.set(mesh.id, groupRef.current);
    return () => { groupRegistry.delete(mesh.id); };
  }, [mesh.id]);

  // ⌘/Ctrl/Shift-click adds to the selection ("grab both"); plain click replaces
  const onClick = (e) => {
    e.stopPropagation();
    const add = e.nativeEvent?.metaKey || e.nativeEvent?.ctrlKey || e.nativeEvent?.shiftKey;
    selectMesh(mesh.id, add);
  };

  // snapshot the full start transform of every selected object when a drag
  // begins, so group rotate/scale can orbit siblings around the primary
  const onGizmoDown = () => {
    const ids = useStore.getState().selectedMeshIds;
    const base = {};
    for (const id of ids) {
      const o = groupRegistry.get(id);
      if (o) base[id] = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
    }
    dragBase.current = base;
  };

  // Commit CONTINUOUSLY while the gizmo moves (reliable across drei versions, so
  // transforms always stick). Group behavior depends on the tool:
  //  - move: siblings translate by the same delta
  //  - rotate: siblings ORBIT the primary and spin with it (negatives included)
  //  - scale: siblings scale and their offsets stretch from the primary
  const onGizmoChange = () => {
    const o = groupRef.current;
    if (!o) return;
    const ids = useStore.getState().selectedMeshIds;
    const patches = {
      [mesh.id]: {
        position: [round(o.position.x), round(o.position.y), round(o.position.z)],
        rotation: [round(o.rotation.x), round(o.rotation.y), round(o.rotation.z)],
        scale: packScale(round(o.scale.x), round(o.scale.y), round(o.scale.z)),
      },
    };
    const base = dragBase.current;
    if (base && base[mesh.id] && ids.length > 1) {
      const pb = base[mesh.id];
      const pivot = pb.p;
      for (const id of ids) {
        if (id === mesh.id) continue;
        const b = base[id];
        if (!b) continue;
        if (transformMode === 'rotate') {
          const qDelta = o.quaternion.clone().multiply(pb.q.clone().invert());
          const np = b.p.clone().sub(pivot).applyQuaternion(qDelta).add(pivot);
          const e = new THREE.Euler().setFromQuaternion(qDelta.clone().multiply(b.q));
          patches[id] = {
            position: [round(np.x), round(np.y), round(np.z)],
            rotation: [round(e.x), round(e.y), round(e.z)],
          };
        } else if (transformMode === 'scale') {
          const f = new THREE.Vector3(
            o.scale.x / (pb.s.x || 1), o.scale.y / (pb.s.y || 1), o.scale.z / (pb.s.z || 1));
          const np = b.p.clone().sub(pivot).multiply(f).add(pivot);
          patches[id] = {
            position: [round(np.x), round(np.y), round(np.z)],
            scale: packScale(round(b.s.x * f.x), round(b.s.y * f.y), round(b.s.z * f.z)),
          };
        } else {
          const np = b.p.clone().add(o.position).sub(pivot);
          patches[id] = { position: [round(np.x), round(np.y), round(np.z)] };
        }
      }
    }
    updateMeshes(patches);
  };

  const fallbackBox = (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={mesh.color} />
    </mesh>
  );

  let content;
  if (mesh.kind === 'meshy' && mesh.modelUrl) {
    content = (
      <MeshErrorBoundary fallback={fallbackBox}>
        <Suspense fallback={fallbackBox}><GLBInner mesh={mesh} /></Suspense>
      </MeshErrorBoundary>
    );
  } else if (mesh.kind === 'stl' && mesh.modelUrl) {
    content = (
      <MeshErrorBoundary fallback={fallbackBox}>
        <Suspense fallback={fallbackBox}><STLInner mesh={mesh} selected={selected} /></Suspense>
      </MeshErrorBoundary>
    );
  } else {
    const pbr = pbrFor(mesh);
    content = (
      <mesh castShadow={!mesh.negative} receiveShadow>
        <PrimitiveGeometry mesh={mesh} />
        {mesh.negative ? (
          // ungrouped negative: red translucent ghost so you can place the cut
          <meshStandardMaterial
            color="#ef4444"
            transparent
            opacity={selected ? 0.5 : 0.32}
            emissive={selected ? '#3b82f6' : '#000'}
            emissiveIntensity={selected ? 0.3 : 0}
            depthWrite={false}
          />
        ) : (
          <meshStandardMaterial
            color={mesh.color}
            emissive={selected ? '#3b82f6' : '#000'}
            emissiveIntensity={selected ? 0.4 : 0}
            metalness={pbr.metalness}
            roughness={pbr.roughness}
            envMapIntensity={0.9}
            side={mesh.kind === 'baked' ? THREE.DoubleSide : THREE.FrontSide}
          />
        )}
      </mesh>
    );
  }

  // grouped member shown via the merged CSG mesh: keep an invisible placeholder
  // so the gizmo, multi-move and registry still work per object. When a single
  // member is selected (via the Inspector member list) show a wireframe outline.
  if (ghost) {
    const soloSelected = selected && selectedIds.length === 1;
    content = soloSelected ? (
      <mesh>
        <PrimitiveGeometry mesh={mesh} />
        <meshStandardMaterial
          color={mesh.negative ? '#ef4444' : '#3b82f6'}
          transparent opacity={0.4} depthWrite={false} wireframe
        />
      </mesh>
    ) : (
      <mesh visible={false}>
        <PrimitiveGeometry mesh={mesh} />
        <meshStandardMaterial />
      </mesh>
    );
  }

  return (
    <>
      <group
        ref={groupRef}
        position={mesh.position}
        rotation={mesh.rotation || [0, 0, 0]}
        scale={scaleArr(mesh.scale)}
        onClick={onClick}
      >
        {content}
      </group>
      {isPrimary && groupRef.current && (
        <TransformControls
          ref={tcRef}
          object={groupRef.current}
          mode={transformMode}
          onMouseDown={onGizmoDown}
          onObjectChange={onGizmoChange}
          size={0.8}
        />
      )}
    </>
  );
}

const round = (v) => Math.round(v * 1000) / 1000;

export default function Viewport3D() {
  const meshes = useStore((s) => s.meshes);
  const selectMesh = useStore((s) => s.selectMesh);
  const theme = useStore((s) => s.theme);
  const light = useStore((s) => s.lightLevel);
  const bg = theme === 'light' ? '#dfe5ec' : '#0e1116';

  return (
    <Canvas
      shadows
      camera={{ position: [2.2, 1.8, 2.6], fov: 45 }}
      onPointerMissed={() => selectMesh(null)}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[bg]} />
      <SoftShadows size={28} samples={12} focus={0.85} />
      <hemisphereLight intensity={0.5 * light} groundColor={bg} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.1 * light}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
      />
      <Environment preset="city" />

      <Grid
        args={[20, 20]}
        cellSize={0.1}
        cellColor="#1c2530"
        sectionSize={1}
        sectionColor="#2a3a4d"
        fadeDistance={18}
        infiniteGrid
        position={[0, 0, 0]}
      />
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={theme === 'light' ? 0.3 : 0.5}
        scale={12}
        blur={2.2}
        far={5}
        resolution={1024}
      />

      {meshes.map((m) => (
        <MeshItem key={m.id} mesh={m} ghost={Boolean(m.groupId) && csgable(m)} />
      ))}
      {/* grouped objects render as one boolean (CSG) result: positives minus negatives */}
      {Object.entries(
        meshes.reduce((acc, m) => {
          if (m.groupId && csgable(m)) (acc[m.groupId] = acc[m.groupId] || []).push(m);
          return acc;
        }, {})
      ).map(([gid, members]) => (
        <CSGGroup key={gid} members={members} />
      ))}

      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <CameraRig />
      <CaptureFramer />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#cbd5e1" />
      </GizmoHelper>
    </Canvas>
  );
}

// Snaps the camera to a preset angle when the `set_view` tool bumps cameraView.
// Additive + one-shot (acts only when the request timestamp changes), so it never
// fights the user's OrbitControls.
const VIEW_DIRS = {
  front: [0, 1, 4], back: [0, 1, -4], left: [-4, 1, 0], right: [4, 1, 0],
  top: [0, 4.2, 0.001], iso: [3.2, 2.6, 3.2],
};
function CameraRig() {
  const cameraView = useStore((s) => s.cameraView);
  const { camera, controls } = useThree();
  const applied = useRef(0);
  useFrame(() => {
    if (!cameraView || cameraView.t === applied.current) return;
    applied.current = cameraView.t;
    const p = VIEW_DIRS[cameraView.view] || VIEW_DIRS.iso;
    camera.position.set(p[0], p[1], p[2]);
    camera.lookAt(0, 0, 0);
    if (controls) { controls.target.set(0, 0, 0); controls.update(); }
  });
  return null;
}
