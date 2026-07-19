import React, { useRef, useMemo, useEffect, useState, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Environment, ContactShadows, Html } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useStore } from '../lib/store.js';
import { initLifeState, stepLifeState, glowColor, tempColor, HAZARDS, resolveMaterial } from '../lib/lifesim.js';
import { scaleArr } from '../lib/scaleUtil.js';
import { mergeMembersToBaked } from '../lib/csgMerge.js';
import { simulate } from '../lib/simulate.js';
import CaptureFramer from './CaptureFramer.jsx';

// Imperative model loader — NEVER suspends, so a slow/dead model URL can't
// freeze the whole Life Sim render loop (gravity, heat, everything). Returns a
// ready THREE.Object3D (centered, normalized to ~1 unit) or null while loading
// / on failure (a 10s timeout converts a hang into a fallback).
function useLoadedModel(mesh) {
  const [obj, setObj] = useState(null);
  const url = mesh.modelUrl;
  const kind = mesh.kind;
  useEffect(() => {
    if (!url) { setObj(null); return; }
    let done = false;
    setObj(null);
    const finish = (o) => { if (!done) { done = true; setObj(o); } };
    const timer = setTimeout(() => finish(null), 10000); // hang -> fallback
    if (kind === 'meshy') {
      new GLTFLoader().load(url, (gltf) => {
        clearTimeout(timer);
        const c = gltf.scene;
        const box = new THREE.Box3().setFromObject(c);
        const size = new THREE.Vector3(); const center = new THREE.Vector3();
        box.getSize(size); box.getCenter(center);
        const longest = Math.max(size.x, size.y, size.z) || 1;
        c.position.set(-center.x, -center.y, -center.z);
        c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); } });
        const wrap = new THREE.Group(); wrap.add(c); wrap.scale.setScalar(1 / longest);
        finish(wrap);
      }, undefined, () => { clearTimeout(timer); finish(null); });
    } else {
      new STLLoader().load(url, (g) => {
        clearTimeout(timer);
        g.computeBoundingBox();
        const b = g.boundingBox;
        g.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
        g.computeVertexNormals();
        const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
        g.scale(1 / size, 1 / size, 1 / size);
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: mesh.color || '#9aa7bd' }));
        m.castShadow = true; m.receiveShadow = true;
        finish(m);
      }, undefined, () => { clearTimeout(timer); finish(null); });
    }
    return () => { done = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kind]);
  return obj;
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

// REAL physics: Rapier (github.com/dimforge/rapier, Rust→WASM) via
// @react-three/rapier. Each rigid unit becomes a dynamic RigidBody with
// shape-appropriate colliders — spheres get ball colliders (true rolling),
// boxes cuboids, everything else a convex hull — so objects collide, push,
// stack, tumble and roll down slopes for real. This replaces the old
// hand-rolled vertical-raycast gravity (which had no collision response).
function collidersForUnit(unit) {
  const kinds = unit.members.map((m) => m.kind);
  if (kinds.every((k) => k === 'sphere')) return 'ball';
  if (kinds.every((k) => k === 'box' || k === 'plane')) return 'cuboid';
  return 'hull';
}
// Async-loaded models (STL/meshy) mount AFTER the body is created, so the auto
// colliders miss them — give each an explicit cuboid from its half extents.
const isLoadedModelMesh = (m) => (m.kind === 'meshy' || m.kind === 'stl') && m.modelUrl;
function modelColliderArgs(m) {
  const s = m.scale ?? 1;
  const sc = Array.isArray(s) ? s : [s, s, s];
  const h = m.half || [0.5, 0.5, 0.5];
  return [Math.max(0.02, h[0] * sc[0]), Math.max(0.02, h[1] * sc[1]), Math.max(0.02, h[2] * sc[2])];
}
// Objects authored slightly BELOW y=0 (e.g. a pyramid whose center sits at 0.5
// but is 1.4 tall) would spawn inside the floor — Rapier's depenetration then
// catapults them (and anything touching them). Lift each unit so its lowest
// member bottom starts at/above the floor.
function memberBottom(m) {
  const uni = Array.isArray(m.scale) ? Math.max(...m.scale) : (m.scale ?? 1);
  const sy = Array.isArray(m.scale) ? m.scale[1] : (m.scale ?? 1);
  let half = 0.5 * sy; // unit-height primitives (box, cone, pyramid, cylinder…)
  if (m.kind === 'sphere') half = 0.5 * uni;
  else if (m.kind === 'torus') half = 0.4 * uni;
  else if (m.kind === 'plane') half = 0.01;
  else if (m.kind === 'baked' && m.halfY != null) half = m.halfY;
  else if ((m.kind === 'meshy' || m.kind === 'stl') && m.half) half = m.half[1] * uni;
  return (m.position?.[1] ?? 0) - half;
}
const unitLift = (u) => Math.max(0, ...u.members.map((m) => -memberBottom(m) + 0.002));

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
  const axleRef = useRef(null); // detected spin axis ('x'|'y'|'z') + child count
  const matsRef = useRef(null); // [{ mat, base }] gathered from the body subtree
  const fireRef = useRef();
  const lightRef = useRef();
  const flameRefs = useRef([]);
  const smokeRefs = useRef([]);
  const top = useMemo(() => 0.55, []); // local top offset (group is at object center-ish)

  const isModel = (mesh.kind === 'meshy' || mesh.kind === 'stl') && mesh.modelUrl;
  const loadedModel = useLoadedModel(mesh); // null until loaded / on failure — never suspends

  useFrame((st, dt) => {
    // ---- position: authored (local to the unit's RigidBody — Rapier moves it) ----
    const root = rootRef.current;
    if (root) root.position.set(mesh.position[0], mesh.position[1], mesh.position[2]);
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
    <group
      ref={rootRef}
      position={mesh.position}
      rotation={mesh.rotation || [0, 0, 0]}
      {...inputHandlers}
    >
      <group ref={bodyRef} scale={scaleArr(mesh.scale)}>
        {isModel && loadedModel ? <primitive object={loadedModel} /> : fallbackBody}
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

function Engine({ running, hazards, onReport, stateRef, resetSignal, drivenIds, units, bodyRefs, unitOf }) {
  const meshes = useStore((s) => s.meshes);
  const acc = useRef(0);
  const q = useRef(new THREE.Quaternion());
  const v = useRef(new THREE.Vector3());
  // Re-init ONLY when the scene or an explicit reset changes. `onReport` must NOT
  // be a dep: parents pass a fresh arrow every render, so having it here re-ran
  // this effect after every report tick (~0.15s) and silently RESET the whole sim
  // state — heat never accumulated and hazards appeared to do nothing.
  useEffect(() => {
    stateRef.current = initLifeState(meshes);
    onReport(stateRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes, resetSignal]);

  useFrame((_, dtRaw) => {
    if (!running) return;
    const dt = Math.min(0.05, dtRaw);
    // Heat/fire distances use the LIVE physics positions (bodies move now):
    // world pos of a member = bodyQuat * authoredLocal + bodyTranslation.
    let liveMeshes = meshes;
    if (units && bodyRefs) {
      const live = {};
      for (const u of units) {
        const api = bodyRefs.current[u.id];
        if (!api) continue;
        try {
          const t = api.translation();
          const r = api.rotation();
          q.current.set(r.x, r.y, r.z, r.w);
          for (const m of u.members) {
            v.current.set(m.position[0], m.position[1], m.position[2]).applyQuaternion(q.current);
            live[m.id] = [v.current.x + t.x, v.current.y + t.y, v.current.z + t.z];
          }
        } catch { /* body despawned mid-frame */ }
      }
      liveMeshes = meshes.map((m) => {
        const rep = unitOf?.[m.id];
        return rep && live[m.id] ? { ...m, position: live[m.id] } : m;
      });
      if (import.meta.env?.DEV) window.__simLive = live; // dev-only physics probe
    }
    stateRef.current = stepLifeState(stateRef.current || initLifeState(meshes), liveMeshes, hazards, dt, drivenIds);
    acc.current += dt;
    if (acc.current > 0.15) { acc.current = 0; onReport(stateRef.current); }
  });
  return null;
}

export default function LifeSimView({ running, hazards, theme, onReport, resetSignal }) {
  const meshes = useStore((s) => s.meshes);
  const light = useStore((s) => s.lightLevel);
  // circuit state — so a motor only spins when its driver is actually powered
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const codeByNode = useStore((s) => s.codeByNode);
  const inputs = useStore((s) => s.inputs);
  const simTick = useStore((s) => s.simTick);
  const stateRef = useRef(null);
  const bg = theme === 'light' ? '#dfe5ec' : '#0e1116';

  // Run the real electrical simulation (powered nets, code, L298N direction,
  // joystick/button inputs) so the Life Sim reflects the actual circuit.
  const circuit = useMemo(
    () => (nodes.length ? simulate(nodes, wires, { codeByNode, blinkPhase: simTick % 2 === 0, inputs }) : null),
    [nodes, wires, codeByNode, inputs, simTick]
  );

  const spinMeta = useMemo(() => {
    // The MOTOR drives the OTHER object, regardless of which side the user
    // attached. A target only spins when its driver motor is electrically
    // ACTIVE, in the circuit-determined direction (× a manual reverse toggle).
    const MOTORISH = new Set(['dc-motor', 'servo-sg90', 'servo-mg996', 'stepper-28byj', 'stepper-nema17', 'vibration-motor', 'pump-12v', 'linear-actuator']);
    const isMotor = (m) => !!m && MOTORISH.has(m.partId);
    const byId = Object.fromEntries(meshes.map((m) => [m.id, m]));
    const compByNode = {};
    if (circuit) for (const c of circuit.components) compByNode[c.nodeId] = c;
    // a projected part mesh is "part-<nodeId>"; map it back to its circuit node
    const motorPower = (motorMesh) => {
      const nodeId = String(motorMesh.id).replace(/^part-/, '');
      const c = compByNode[nodeId];
      if (c) return { active: c.active, dir: c.dir || 1 };  // wired -> use circuit
      return { active: !circuit, dir: 1 }; // no circuit at all -> demo spin; wired-but-not-found -> off
    };
    const map = {}; // target id -> dir
    for (const m of meshes) {
      if (!m.attachedTo || m.drives === false) continue;
      const parent = byId[m.attachedTo];
      if (!parent) continue;
      const motor = isMotor(m) ? m : isMotor(parent) ? parent : null;
      const target = isMotor(m) && !isMotor(parent) ? parent
        : isMotor(parent) && !isMotor(m) ? m
        : parent;
      const rev = (m.spinReverse || parent.spinReverse) ? -1 : 1;
      if (!motor) { map[target.id] = rev; continue; } // no motor in pair — old demo behavior
      const p = motorPower(motor);
      if (!p.active) continue;               // motor not powered -> do not spin
      map[target.id] = p.dir * rev;          // powered -> spin in circuit direction
    }
    return map;
  }, [meshes, circuit]);

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

  // Rigid units for gravity. A "unit" is everything rigidly connected: members
  // of the same group AND anything attached to them (an AI tire mounted on a
  // hub falls with the chassis). Union-find over groupId + attachedTo.
  const { units, unitOf } = useMemo(() => {
    // negative objects are cutting tools, not physical bodies — they don't fall
    // or collide. (Grouped negatives are already baked into holes; this excludes
    // any stray ungrouped negative.)
    const physical = renderMeshes.filter((m) => !m.negative);
    const parent = {};
    const ensure = (x) => { if (parent[x] === undefined) parent[x] = x; return x; };
    const find = (x) => { ensure(x); while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };
    for (const m of physical) {
      ensure(m.id);
      if (m.groupId) union(m.id, 'g:' + m.groupId);
      if (m.attachedTo) union(m.id, m.attachedTo);
    }
    const map = {};
    const byRep = {};
    for (const m of physical) {
      const rep = find(m.id);
      map[m.id] = rep;
      (byRep[rep] = byRep[rep] || { id: rep, members: [] }).members.push(m);
    }
    return { units: Object.values(byRep), unitOf: map };
  }, [renderMeshes]);
  const bodyRefs = useRef({});
  // Impact damage: a FAST collision chips integrity (visible in the Durability
  // panel). Speed-gated so resting contact of heavy objects never hurts them.
  const impactFor = (u) => (e) => {
    if (!stateRef.current?.objects) return;
    const api = bodyRefs.current[u.id];
    if (!api) return;
    const lv = api.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    if (speed < 2.2 || e.totalForceMagnitude < 40) return;
    const dmg = Math.min(0.25, (speed - 2.2) * 0.04);
    for (const m of u.members) {
      const o = stateRef.current.objects[m.id];
      if (o && !o.destroyed) { o.integrity = Math.max(0, o.integrity - dmg); if (o.integrity <= 0) o.destroyed = true; }
    }
  };
  const negatives = renderMeshes.filter((m) => m.negative);

  return (
    <Canvas shadows camera={{ position: [3, 2.2, 3.2], fov: 45 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }}>
      <color attach="background" args={[bg]} />
      <hemisphereLight intensity={0.45 * light} groundColor={bg} />
      <directionalLight position={[5, 8, 5]} intensity={1.0 * light} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} />
      <Environment preset="city" />

      <Grid args={[24, 24]} cellSize={0.1} cellColor="#1c2530" sectionSize={1} sectionColor="#2a3a4d" fadeDistance={20} infiniteGrid />
      <ContactShadows position={[0, 0.001, 0]} opacity={theme === 'light' ? 0.35 : 0.55} scale={14} blur={2.4} far={6} resolution={1024} />

      <Suspense fallback={null}>
        <Physics key={resetSignal || 0} paused={!running}>
          {/* the floor: a fixed slab whose top surface is exactly y = 0 */}
          <RigidBody type="fixed" colliders={false}>
            <CuboidCollider args={[60, 0.5, 60]} position={[0, -0.5, 0]} />
          </RigidBody>
          {units.map((u) => (
            <RigidBody
              key={u.id + ':' + u.members.length}
              ref={(api) => { if (api) bodyRefs.current[u.id] = api; else delete bodyRefs.current[u.id]; }}
              position={[0, unitLift(u), 0]}
              colliders={collidersForUnit(u)}
              friction={0.7}
              restitution={0.15}
              ccd
              onContactForce={impactFor(u)}
            >
              {u.members.map((m) => (
                <SimMesh
                  key={m.id}
                  mesh={m}
                  spinning={running && m.id in spinMeta}
                  spinDir={spinMeta[m.id] || 1}
                  stateRef={stateRef}
                  materialKey={matByMesh[m.id]}
                  running={running}
                />
              ))}
              {u.members.filter(isLoadedModelMesh).map((m) => (
                <CuboidCollider key={'mc' + m.id} args={modelColliderArgs(m)} position={m.position} rotation={m.rotation || [0, 0, 0]} />
              ))}
            </RigidBody>
          ))}
        </Physics>
      </Suspense>

      {/* stray negatives are visual cutting tools — rendered, but no physics */}
      {negatives.map((m) => (
        <SimMesh key={m.id} mesh={m} stateRef={stateRef} materialKey={matByMesh[m.id]} running={running} />
      ))}
      {hazards.map((h) => (
        <HazardMarker key={h.id} hazard={h} />
      ))}

      <Engine running={running} hazards={hazards} onReport={onReport} stateRef={stateRef} resetSignal={resetSignal} drivenIds={new Set(Object.keys(spinMeta))} units={units} bodyRefs={bodyRefs} unitOf={unitOf} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      <CaptureFramer />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#cbd5e1" />
      </GizmoHelper>
    </Canvas>
  );
}
