import React, { useRef, useMemo, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Environment, ContactShadows, Html, useGLTF } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useStore } from '../lib/store.js';
import { initLifeState, stepLifeState, glowColor, tempColor, HAZARDS, resolveMaterial } from '../lib/lifesim.js';
import { scaleArr } from '../lib/scaleUtil.js';
import { mergeMembersToBaked } from '../lib/csgMerge.js';

// Loads a remote GLB (Meshy) — centered + normalized to ~1 unit so the sim's
// melt/scale deformation behaves the same as for primitives.
function GLBBody({ mesh, metal }) {
  const { scene } = useGLTF(mesh.modelUrl);
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const longest = Math.max(size.x, size.y, size.z) || 1;
    const wrap = new THREE.Group();
    c.position.set(-center.x, -center.y, -center.z);
    // clone materials so per-object tint/glow doesn't leak across instances
    c.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      }
    });
    wrap.add(c);
    wrap.scale.setScalar(1 / longest);
    return wrap;
  }, [scene]);
  return <primitive object={cloned} />;
}

// Loads a remote/local STL (Thingiverse), centered + normalized to ~1 unit.
function STLBody({ mesh, metal }) {
  const geometry = useLoader(STLLoader, mesh.modelUrl);
  const geo = useMemo(() => {
    const g = geometry.clone();
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
    g.computeVertexNormals();
    const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    g.scale(1 / size, 1 / size, 1 / size);
    return g;
  }, [geometry]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color={mesh.color || '#9aa7bd'} metalness={metal ? 0.85 : 0.15} roughness={metal ? 0.35 : 0.65} />
    </mesh>
  );
}

// Error boundary so a failed model load falls back to a primitive box.
class BodyErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function BakedGeom({ mesh }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.geom?.positions || [], 3));
    if (mesh.geom?.normals?.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.geom.normals, 3));
    else g.computeVertexNormals();
    return g;
  }, [mesh.geom]);
  return <primitive object={geo} attach="geometry" />;
}

function geometryFor(mesh) {
  if (mesh.kind === 'baked') return <BakedGeom mesh={mesh} />;
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

const FLAME_N = 5;
const SMOKE_N = 6;

const INPUT_KINDS = new Set(['push-button', 'toggle-switch', 'potentiometer', 'joystick']);

function SimMesh({ mesh, spinning, spinDir = 1, stateRef, materialKey, running }) {
  const setInput = useStore((s) => s.setInput);
  const toggleInput = useStore((s) => s.toggleInput);
  const inputs = useStore((s) => s.inputs);
  const isInputPart = INPUT_KINDS.has(mesh.partId);
  // Meshes projected from the circuit are named "part-<nodeId>", but the input
  // state is keyed by the circuit node id — strip the prefix or clicks go nowhere.
  const inputId = String(mesh.id).replace(/^part-/, '');
  const inputHandlers = isInputPart ? {
    onClick: (e) => { e.stopPropagation(); if (mesh.partId === 'toggle-switch') toggleInput(inputId); },
    onPointerDown: (e) => {
      e.stopPropagation();
      if (mesh.partId === 'push-button') setInput(inputId, true);
      else if (mesh.partId === 'joystick') setInput(inputId, { ...(inputs[inputId] || {}), sw: true });
    },
    onPointerUp: () => {
      if (mesh.partId === 'push-button') setInput(inputId, false);
      else if (mesh.partId === 'joystick') setInput(inputId, { ...(inputs[inputId] || {}), sw: false });
    },
    onPointerOver: () => { document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { document.body.style.cursor = 'auto'; },
  } : {};
  const bodyRef = useRef();
  const rootRef = useRef();
  const vyRef = useRef(0); // vertical velocity for gravity
  const axleRef = useRef(null); // detected spin axis ('x'|'y'|'z') + child count
  const matsRef = useRef(null); // [{ mat, base }] gathered from the body subtree
  const fireRef = useRef();
  const lightRef = useRef();
  const flameRefs = useRef([]);
  const smokeRefs = useRef([]);
  const top = useMemo(() => 0.55, []); // local top offset (group is at object center-ish)

  const isModel = (mesh.kind === 'meshy' || mesh.kind === 'stl') && mesh.modelUrl;
  // ground rest height: half the object's (normalized) height — Y axis scale
  const restY = mesh.kind === 'part' && mesh.size ? mesh.size[1] / 2
    : mesh.kind === 'baked' ? (mesh.halfY || 0.5) * scaleArr(mesh.scale)[1]
    : 0.5 * scaleArr(mesh.scale)[1];

  useFrame((st, dt) => {
    // ---- gravity: while running, unattached objects fall to the ground ----
    const root = rootRef.current;
    if (root) {
      if (running && !mesh.attachedTo) {
        if (root.position.y > restY + 1e-4 || vyRef.current !== 0) {
          vyRef.current -= 9.8 * dt;
          root.position.y += vyRef.current * dt;
          if (root.position.y <= restY) {
            root.position.y = restY;
            // small bounce, then settle
            vyRef.current = Math.abs(vyRef.current) > 1.4 ? -vyRef.current * 0.22 : 0;
          }
        }
      } else if (!running) {
        // paused/reset: return to the authored position
        root.position.set(mesh.position[0], mesh.position[1], mesh.position[2]);
        vyRef.current = 0;
      }
    }
    const s = stateRef.current?.objects?.[mesh.id];
    const body = bodyRef.current;
    if (!body) return;
    // ---- spin axis: a wheel's axle is its THINNEST direction (works for
    // torus tires, coin cylinders and AI-generated tire models alike) ----
    if (spinning && (!s || !s.destroyed)) {
      const childCount = body.children.length;
      if (!axleRef.current || axleRef.current.children !== childCount) {
        const bb = new THREE.Box3().setFromObject(body);
        const ws = new THREE.Vector3();
        bb.getSize(ws);
        if (ws.x > 0 && ws.y > 0 && ws.z > 0) {
          // thinnest WORLD direction → express it in the body's local frame
          const dir = ws.x <= ws.y && ws.x <= ws.z ? new THREE.Vector3(1, 0, 0)
            : ws.y <= ws.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
          const q = body.getWorldQuaternion(new THREE.Quaternion()).invert();
          dir.applyQuaternion(q);
          const ax = Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 'x'
            : Math.abs(dir.y) >= Math.abs(dir.z) ? 'y' : 'z';
          axleRef.current = { axis: ax, children: childCount };
        }
      }
      body.rotation[axleRef.current?.axis || 'y'] += dt * 6 * spinDir;
    }

    if (!s) return;

    // Gather all standard materials in the body subtree once they exist.
    // Works uniformly for primitives and loaded GLB/STL geometry.
    if (!matsRef.current && body.children.length) {
      const list = [];
      body.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.color) list.push({ mat: m, base: m.color.clone() });
          }
        }
      });
      if (list.length) matsRef.current = list;
    }

    const [bx, by, bz] = scaleArr(mesh.scale);
    const k = 0.3 + 0.7 * s.integrity;
    const melt = s.melt || 0;
    // melt: flatten + spread (slump)
    body.scale.set(bx * (1 + 0.3 * melt) * k, by * (1 - 0.6 * melt) * k, bz * (1 + 0.3 * melt) * k);
    body.visible = !s.destroyed;

    const tint = tempColor(s.temp);
    const glow = glowColor(s.temp);
    for (const { mat, base: bc } of (matsRef.current || [])) {
      if (tint) mat.color.set(tint); else mat.color.copy(bc);
      if (!mat.emissive) continue;
      if (s.ignited) {
        mat.emissive.setRGB(1, 0.25, 0.05);
        mat.emissiveIntensity = 0.9 + Math.random() * 0.3;
      } else if (glow) {
        mat.emissive.setRGB(glow[0], glow[1], glow[2]);
        mat.emissiveIntensity = 0.6 + Math.min(1, (s.temp - 480) / 600);
      } else {
        mat.emissive.setRGB(0, 0, 0);
        mat.emissiveIntensity = 0;
      }
    }

    // ---- fire + smoke fx ----
    const fire = fireRef.current;
    const burning = s.ignited && !s.destroyed;
    const hot = s.temp > 520 && !s.destroyed;
    if (fire) fire.visible = burning || hot;
    if (burning || hot) {
      const t = st.clock.elapsedTime;
      flameRefs.current.forEach((f, i) => {
        if (!f) return;
        f.visible = burning;
        const fl = 0.6 + 0.4 * Math.sin(t * 12 + i * 1.7) + Math.random() * 0.2;
        const h = (0.5 + 0.5 * fl);
        f.scale.set(0.18 + 0.05 * fl, 0.35 * h, 0.18 + 0.05 * fl);
        f.position.set((i - 2) * 0.06, top + 0.18 * h, Math.sin(i) * 0.05);
        if (f.material) f.material.opacity = 0.75;
      });
      smokeRefs.current.forEach((p, i) => {
        if (!p) return;
        const phase = ((t * 0.4 + i / SMOKE_N) % 1);
        p.position.set(Math.sin(t + i) * 0.12 * phase, top + 0.2 + phase * 1.1, Math.cos(t + i) * 0.12 * phase);
        const sc = 0.1 + phase * 0.35;
        p.scale.setScalar(sc);
        if (p.material) p.material.opacity = (burning ? 0.32 : 0.16) * (1 - phase);
      });
      if (lightRef.current) {
        lightRef.current.visible = burning;
        lightRef.current.intensity = burning ? 1.6 + Math.sin(t * 16) * 0.5 : 0;
      }
    } else if (lightRef.current) {
      lightRef.current.visible = false;
    }
  });

  const fallbackBody = (
    <mesh castShadow={!mesh.negative} receiveShadow>
      {geometryFor(mesh)}
      {mesh.negative ? (
        // an ungrouped negative is a cutting tool, not a physical object
        <meshStandardMaterial color="#ef4444" transparent opacity={0.3} depthWrite={false} />
      ) : (
        <meshStandardMaterial
          color={mesh.color}
          metalness={materialKey?.metal ? 0.85 : 0.15}
          roughness={materialKey?.metal ? 0.35 : 0.65}
          side={mesh.kind === 'baked' ? THREE.DoubleSide : THREE.FrontSide}
        />
      )}
    </mesh>
  );

  return (
    <group ref={rootRef} position={mesh.position} rotation={mesh.rotation || [0, 0, 0]} {...inputHandlers}>
      <group ref={bodyRef} scale={scaleArr(mesh.scale)}>
        {isModel ? (
          <BodyErrorBoundary fallback={fallbackBody}>
            <Suspense fallback={fallbackBody}>
              {mesh.kind === 'meshy'
                ? <GLBBody mesh={mesh} metal={materialKey?.metal} />
                : <STLBody mesh={mesh} metal={materialKey?.metal} />}
            </Suspense>
          </BodyErrorBoundary>
        ) : fallbackBody}
      </group>

      <group ref={fireRef} visible={false}>
        <pointLight ref={lightRef} color="#ff6a1f" distance={2.2} intensity={0} position={[0, top + 0.2, 0]} />
        {Array.from({ length: FLAME_N }).map((_, i) => (
          <mesh key={'fl' + i} ref={(el) => (flameRefs.current[i] = el)} position={[0, top, 0]}>
            <coneGeometry args={[0.12, 0.4, 10]} />
            <meshBasicMaterial color={i % 2 ? '#ffd24a' : '#ff5a1e'} transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
        {Array.from({ length: SMOKE_N }).map((_, i) => (
          <mesh key={'sm' + i} ref={(el) => (smokeRefs.current[i] = el)} position={[0, top, 0]}>
            <sphereGeometry args={[0.2, 10, 10]} />
            <meshBasicMaterial color="#3a3a3a" transparent opacity={0.2} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function HazardMarker({ hazard }) {
  const spec = HAZARDS[hazard.type];
  if (!spec) return null;
  const reach = spec.reach * (0.5 + 0.5 * (hazard.intensity ?? 1));
  return (
    <group position={hazard.position}>
      <mesh>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color={spec.color} emissive={spec.color} emissiveIntensity={hazard.on ? 1.3 : 0.2} />
      </mesh>
      {hazard.on && (
        <mesh>
          <sphereGeometry args={[reach, 20, 20]} />
          <meshBasicMaterial color={spec.color} transparent opacity={0.05} depthWrite={false} />
        </mesh>
      )}
      <Html distanceFactor={9} position={[0, 0.28, 0]} style={{ pointerEvents: 'none' }}>
        <div className="haz-tag">{spec.icon} {spec.name}</div>
      </Html>
    </group>
  );
}

function Engine({ running, hazards, onReport, stateRef, resetSignal, drivenIds }) {
  const meshes = useStore((s) => s.meshes);
  const acc = useRef(0);
  useEffect(() => {
    stateRef.current = initLifeState(meshes);
    onReport(stateRef.current);
  }, [meshes, resetSignal, stateRef, onReport]);

  useFrame((_, dtRaw) => {
    if (!running) return;
    const dt = Math.min(0.05, dtRaw);
    stateRef.current = stepLifeState(stateRef.current || initLifeState(meshes), meshes, hazards, dt, drivenIds);
    acc.current += dt;
    if (acc.current > 0.15) { acc.current = 0; onReport(stateRef.current); }
  });
  return null;
}

export default function LifeSimView({ running, hazards, theme, onReport, resetSignal }) {
  const meshes = useStore((s) => s.meshes);
  const light = useStore((s) => s.lightLevel);
  const stateRef = useRef(null);
  const bg = theme === 'light' ? '#dfe5ec' : '#0e1116';

  const spinMeta = useMemo(() => {
    // The MOTOR drives the OTHER object, regardless of which side the user
    // attached. Each target gets a direction (+1/−1, flippable in Inspector).
    const MOTORISH = new Set(['dc-motor', 'servo-sg90', 'servo-mg996', 'stepper-28byj', 'stepper-nema17', 'vibration-motor', 'pump-12v', 'linear-actuator']);
    const isMotor = (m) => !!m && MOTORISH.has(m.partId);
    const byId = Object.fromEntries(meshes.map((m) => [m.id, m]));
    const map = {}; // target id -> dir
    for (const m of meshes) {
      if (!m.attachedTo || m.drives === false) continue;
      const parent = byId[m.attachedTo];
      if (!parent) continue;
      const target = isMotor(m) && !isMotor(parent) ? parent
        : isMotor(parent) && !isMotor(m) ? m
        : parent; // neither/both motors: keep old behavior
      map[target.id] = m.spinReverse || parent.spinReverse ? -1 : 1;
    }
    return map;
  }, [meshes]);

  const matByMesh = useMemo(() => {
    const map = {};
    for (const m of meshes) map[m.id] = { metal: resolveMaterial(m).metal };
    return map;
  }, [meshes]);

  // Groups render as ONE carved body here too (same boolean result as the 3D
  // editor) — negatives become holes instead of solid boxes. The merged body
  // inherits the primary member's id so heat state & attachments still work.
  const { renderMeshes } = useMemo(() => {
    const canCsg = (m) => !((m.kind === 'meshy' || m.kind === 'stl') && m.modelUrl);
    const groups = {};
    const out = [];
    for (const m of meshes) {
      if (m.groupId && canCsg(m)) (groups[m.groupId] = groups[m.groupId] || []).push(m);
      else out.push(m);
    }
    for (const members of Object.values(groups)) {
      const primary = members.find((m) => !m.negative) || members[0];
      try {
        const baked = mergeMembersToBaked(members);
        if (baked) {
          out.push({
            ...primary,
            kind: 'baked',
            geom: baked.geom,
            halfY: baked.halfY,
            position: baked.center,
            rotation: [0, 0, 0],
            scale: 1,
          });
          continue;
        }
      } catch { /* degenerate CSG — fall through to raw members */ }
      out.push(...members);
    }
    return { renderMeshes: out };
  }, [meshes]);

  return (
    <Canvas shadows camera={{ position: [3, 2.2, 3.2], fov: 45 }} dpr={[1, 2]}>
      <color attach="background" args={[bg]} />
      <hemisphereLight intensity={0.45 * light} groundColor={bg} />
      <directionalLight position={[5, 8, 5]} intensity={1.0 * light} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} />
      <Environment preset="city" />

      <Grid args={[24, 24]} cellSize={0.1} cellColor="#1c2530" sectionSize={1} sectionColor="#2a3a4d" fadeDistance={20} infiniteGrid />
      <ContactShadows position={[0, 0.001, 0]} opacity={theme === 'light' ? 0.35 : 0.55} scale={14} blur={2.4} far={6} resolution={1024} />

      {renderMeshes.map((m) => (
        <SimMesh key={m.id} mesh={m} spinning={running && m.id in spinMeta} spinDir={spinMeta[m.id] || 1} stateRef={stateRef} materialKey={matByMesh[m.id]} running={running} />
      ))}
      {hazards.map((h) => (
        <HazardMarker key={h.id} hazard={h} />
      ))}

      <Engine running={running} hazards={hazards} onReport={onReport} stateRef={stateRef} resetSignal={resetSignal} drivenIds={new Set(Object.keys(spinMeta))} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#cbd5e1" />
      </GizmoHelper>
    </Canvas>
  );
}
