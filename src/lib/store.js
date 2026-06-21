import { create } from 'zustand';
import { PART_BY_ID, SCENE_SCALE } from '../data/parts.js';
import { partMaterial } from './materials.js';
import { numberedNodeNames } from './labels.js';

let nodeSeq = 1;
let wireSeq = 1;

// appearance prefs survive restarts via localStorage
let _appearance = {};
try { _appearance = JSON.parse(localStorage.getItem('f3d-appearance') || '{}'); } catch { /* fresh */ }
function persistAppearance(patch) {
  _appearance = { ..._appearance, ...patch };
  try { localStorage.setItem('f3d-appearance', JSON.stringify(_appearance)); } catch { /* private mode */ }
}

export const useStore = create((set, get) => ({
  // ---- active workspace tab ----
  tab: 'design', // design | circuit | export

  // ---- 3D scene meshes (from Meshy or primitives) ----
  meshes: [], // { id, kind, label, position:[x,y,z], rotation:[x,y,z], color, scale }
  selectedMeshId: null,        // primary selection (Inspector edits this one)
  selectedMeshIds: [],         // full multi-selection (⌘/Ctrl-click to add)
  transformMode: 'translate', // translate | rotate | scale (gizmo on selected object)
  clipboard: null, // copied mesh payload (no id) for paste

  // ---- interactive circuit inputs (buttons / switches / pots / joystick) ----
  // value: boolean (button/switch) | number 0..1 (pot) | {x,y,sw} (joystick)
  inputs: {},
  setInput: (id, value) => set((s) => ({ inputs: { ...s.inputs, [id]: value } })),
  toggleInput: (id) => set((s) => ({ inputs: { ...s.inputs, [id]: !s.inputs[id] } })),

  // ---- circuit graph ----
  nodes: [], // { id, partId, x, y }
  wires: [], // { id, from:{node,pin}, to:{node,pin} }
  pendingPin: null, // { node, pin } while drawing a wire
  selectedNodeId: null,

  // ---- AI generation status ----
  meshyStatus: 'idle', // idle | running | done | error
  meshyMessage: '',
  hasMeshyKey: false,
  hasHfToken: false,
  hasThingiverseToken: false,
  provider: 'mock', // mock | hf | meshy

  // ---- simulation ----
  simOn: false,
  toggleSim: () => set((s) => ({ simOn: !s.simOn })),
  simTick: 0, // advances ~1.5Hz while running so code-driven pins can blink
  tickSim: () => set((s) => ({ simTick: s.simTick + 1 })),

  // ---- Life Sim run state (store-backed so Orchestra can drive & read it) ----
  // The physics engine "Run" toggle used to be local to LifeSimWorkspace; lifting
  // it here lets the Orchestra director start/stop the sim and read its report.
  lifeSimRunning: false,
  setLifeSimRunning: (v) => set({ lifeSimRunning: Boolean(v) }),
  simReport: {}, // latest physics report: { objects: { id: {temp, integrity, ...} }, _t }
  setSimReport: (simReport) => set({ simReport: simReport || {} }),

  // ---- Orchestra AI (the director) ----
  // Orchestra is the conductor: it plans a whole build and delegates to the
  // existing sub-agents (mesh gen, circuit agent, codegen) and scene actions.
  // It never wires parts itself — it hands prompts to those agents. The run is
  // fully observable: every step lands in `orchestraSteps` in real time.
  orchestraStatus: 'idle', // idle | running | done | error | stopped
  orchestraGoal: '',
  orchestraSteps: [], // [{ n, kind, thought, tool, args, result, ok, image, t }]
  orchestraTokens: 0, // rough token estimate spent this run (headroom meter)
  orchestraView: 'build', // build | sim — which live viewport the Orchestra stage shows
  orchestraPhase: '',     // current phase, shown as a live banner over the viewport
  setOrchestraView: (orchestraView) => set({ orchestraView }),
  setOrchestraPhase: (orchestraPhase) => set({ orchestraPhase }),
  orchestraDirector: 'base',     // text provider that plans (free by default)
  orchestraVision: 'hf-glm45v',  // vision model that inspects screenshots
  orchestraHeadroom: 'balanced', // eco | balanced | max — token/context budget
  setOrchestraDirector: (orchestraDirector) => set({ orchestraDirector }),
  setOrchestraVision: (orchestraVision) => set({ orchestraVision }),
  setOrchestraHeadroom: (orchestraHeadroom) => set({ orchestraHeadroom }),
  orchestraStart: (goal) =>
    set({ orchestraStatus: 'running', orchestraGoal: goal || '', orchestraSteps: [], orchestraTokens: 0, orchestraView: 'build', orchestraPhase: 'Planning…' }),
  orchestraSetStatus: (orchestraStatus) => set({ orchestraStatus }),
  orchestraReset: () => set({ orchestraStatus: 'idle', orchestraGoal: '', orchestraSteps: [], orchestraTokens: 0 }),
  orchestraAddTokens: (n) => set((s) => ({ orchestraTokens: s.orchestraTokens + (Number(n) || 0) })),
  orchestraAddStep: (step) =>
    set((s) => ({ orchestraSteps: [...s.orchestraSteps, { n: s.orchestraSteps.length + 1, t: Date.now(), ...step }] })),
  // patch the most recent step in place (e.g. fill in its result/image once the
  // tool finishes) without pushing a new timeline entry
  orchestraPatchLast: (patch) =>
    set((s) => {
      if (!s.orchestraSteps.length) return {};
      const steps = s.orchestraSteps.slice();
      steps[steps.length - 1] = { ...steps[steps.length - 1], ...patch };
      return { orchestraSteps: steps };
    }),

  // ---- UI / theme ----
  theme: 'dark', // dark | light
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setTheme: (theme) => set({ theme }),

  // ---- appearance (persisted to localStorage) ----
  uiZoom: _appearance.zoom ?? 1,        // 0.9 | 1 | 1.1 | 1.25 — scales the whole UI
  lightLevel: _appearance.light ?? 1,   // 0.5..1.5 — 3D viewport lighting multiplier
  setUiZoom: (uiZoom) => { persistAppearance({ zoom: uiZoom }); set({ uiZoom }); },
  setLightLevel: (lightLevel) => { persistAppearance({ light: lightLevel }); set({ lightLevel }); },

  // ---- AI scene awareness ----
  // When on, the 3D mesh generator is told about the objects already in the
  // scene (so you can say "make a shell for this"). Turn off for faster prompts.
  sceneContextOn: true,
  toggleSceneContext: () => set((s) => ({ sceneContextOn: !s.sceneContextOn })),
  setSceneContextOn: (v) => set({ sceneContextOn: v }),

  // ---- AI code generation (multi-provider) ----
  codeProvider: 'mock', // anthropic | gemini | groq | mistral | openrouter | mock
  setCodeProvider: (codeProvider) => set({ codeProvider }),
  // separate agent for the circuit-debug feature (can differ from codeProvider)
  circuitProvider: 'mock',
  setCircuitProvider: (circuitProvider) => set({ circuitProvider }),
  hasAnthropicKey: false,
  setHasAnthropicKey: (v) => set({ hasAnthropicKey: v }),
  hasGeminiKey: false,
  setHasGeminiKey: (v) => set({ hasGeminiKey: v }),
  hasGroqKey: false,
  setHasGroqKey: (v) => set({ hasGroqKey: v }),
  hasMistralKey: false,
  setHasMistralKey: (v) => set({ hasMistralKey: v }),
  hasOpenrouterKey: false,
  setHasOpenrouterKey: (v) => set({ hasOpenrouterKey: v }),
  hasGlmKey: false,
  setHasGlmKey: (v) => set({ hasGlmKey: v }),
  codeByNode: {}, // nodeId -> Arduino sketch string
  setNodeCode: (nodeId, code) =>
    set((s) => ({ codeByNode: { ...s.codeByNode, [nodeId]: code } })),

  // ---- export render quality ----
  exportQuality: 'medium', // low | medium | high
  setExportQuality: (exportQuality) => set({ exportQuality }),

  setTab: (tab) => set({ tab }),
  setHasMeshyKey: (v) => set({ hasMeshyKey: v }),
  setHasHfToken: (v) => set({ hasHfToken: v }),
  setHasThingiverseToken: (v) => set({ hasThingiverseToken: v }),
  setProvider: (provider) => set({ provider }),
  setMeshyStatus: (meshyStatus, meshyMessage = '') => set({ meshyStatus, meshyMessage }),

  // ---- attachment: mount one mesh onto another (e.g. motor drives a wheel) ----
  // child.attachedTo = parent mesh id; child.drives = true means the parent
  // object spins when the child (a motor/servo/stepper) is powered in the sim.
  setAttachment: (childId, parentId, drives = true) =>
    set((s) => ({
      meshes: s.meshes.map((m) =>
        m.id === childId ? { ...m, attachedTo: parentId || null, drives: parentId ? drives : false } : m
      ),
    })),
  // assign a physical material override to any mesh (used by the life sim)
  setMeshMaterial: (id, materialKey) =>
    set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, materialKey } : m)) })),

  // ---- 3D actions ----
  addMesh: (mesh) =>
    set((s) => ({
      meshes: [
        ...s.meshes,
        {
          id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
          position: [(Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2],
          rotation: [0, 0, 0],
          color: '#7c93b8',
          scale: 1,
          ...mesh,
        },
      ],
    })),
  // additive = ⌘/Ctrl-click: toggle the id in the multi-selection.
  // Clicking a grouped object selects its whole group.
  selectMesh: (id, additive = false) =>
    set((s) => {
      if (!id) return { selectedMeshId: null, selectedMeshIds: [] };
      const m = s.meshes.find((x) => x.id === id);
      const unit = m?.groupId
        ? s.meshes.filter((x) => x.groupId === m.groupId).map((x) => x.id)
        : [id];
      if (additive) {
        const has = s.selectedMeshIds.includes(id);
        const ids = has
          ? s.selectedMeshIds.filter((x) => !unit.includes(x))
          : [...new Set([...s.selectedMeshIds, ...unit])];
        return { selectedMeshIds: ids, selectedMeshId: has ? (ids[ids.length - 1] || null) : id };
      }
      return { selectedMeshId: id, selectedMeshIds: unit };
    }),

  // select exactly one mesh, without expanding to its group (to edit a single
  // member — e.g. drag the invisible negative cutter inside a group)
  selectMeshOnly: (id) => set({ selectedMeshId: id, selectedMeshIds: id ? [id] : [] }),

  // ---- grouping & boolean (CSG) flags ----
  // Grouped objects select/move as one. A "negative" object carves its volume
  // out of the positive objects in the same group (live boolean subtraction).
  groupSelected: () =>
    set((s) => {
      if (s.selectedMeshIds.length < 2) return {};
      const gid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      return { meshes: s.meshes.map((m) => (s.selectedMeshIds.includes(m.id) ? { ...m, groupId: gid } : m)) };
    }),
  ungroupSelected: () =>
    set((s) => ({
      meshes: s.meshes.map((m) => (s.selectedMeshIds.includes(m.id) ? { ...m, groupId: null } : m)),
    })),
  setMeshNegative: (id, negative) =>
    set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, negative } : m)) })),
  // Replace a group's members with ONE baked mesh (real merge, not a sticker).
  // Non-mergeable members (loaded models) survive, ungrouped.
  bakeGroup: (groupId, baked) =>
    set((s) => {
      const members = s.meshes.filter((m) => m.groupId === groupId);
      const primary = members.find((m) => !m.negative) || members[0];
      // non-mergeable members (loaded models, e.g. an AI tire) STAY in the
      // group with the baked body, so the assembly keeps behaving as one unit
      const keep = s.meshes.map((m) =>
        m.groupId === groupId
          ? ((m.kind === 'meshy' || m.kind === 'stl') && m.modelUrl ? m : null)
          : m
      ).filter(Boolean);
      const id = 'm' + Date.now() + Math.random().toString(36).slice(2, 6);
      keep.push({
        id,
        kind: 'baked',
        groupId,
        label: (primary?.label || 'merged') + ' (merged)',
        color: primary?.color || '#8aa0c8',
        materialKey: primary?.materialKey,
        geom: baked.geom,
        halfY: baked.halfY,
        half: baked.half,
        position: baked.center,
        rotation: [0, 0, 0],
        scale: 1,
      });
      return { meshes: keep, selectedMeshId: id, selectedMeshIds: [id] };
    }),
  // reverse the spin direction a motor imparts on its attached object
  setSpinReverse: (id, spinReverse) =>
    set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, spinReverse } : m)) })),
  setTransformMode: (transformMode) => set({ transformMode }),
  updateMesh: (id, patch) =>
    set((s) => ({ meshes: s.meshes.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  // bulk position/rotation/scale commit for multi-object gizmo moves
  updateMeshes: (patches) =>
    set((s) => ({ meshes: s.meshes.map((m) => (patches[m.id] ? { ...m, ...patches[m.id] } : m)) })),
  removeMesh: (id) =>
    set((s) => ({
      meshes: s.meshes.filter((m) => m.id !== id),
      selectedMeshId: s.selectedMeshId === id ? null : s.selectedMeshId,
      selectedMeshIds: s.selectedMeshIds.filter((x) => x !== id),
    })),
  // delete the whole multi-selection (⌫ with several objects grabbed)
  removeSelectedMeshes: () =>
    set((s) => {
      const ids = new Set(s.selectedMeshIds.length ? s.selectedMeshIds : [s.selectedMeshId].filter(Boolean));
      return {
        meshes: s.meshes.filter((m) => !ids.has(m.id)),
        selectedMeshId: null,
        selectedMeshIds: [],
      };
    }),

  // ---- copy / paste / duplicate ----
  newMeshId: () => 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
  copyMesh: (id) =>
    set((s) => {
      const m = s.meshes.find((x) => x.id === (id ?? s.selectedMeshId));
      if (!m) return {};
      const { id: _omit, ...payload } = m;
      return { clipboard: JSON.parse(JSON.stringify(payload)) };
    }),
  pasteMesh: () =>
    set((s) => {
      if (!s.clipboard) return {};
      const c = s.clipboard;
      const id = get().newMeshId();
      const p = c.position || [0, 0.5, 0];
      const copy = { ...c, id, position: [p[0] + 0.15, p[1], p[2] + 0.15] };
      // reset BOTH selection fields — stale selectedMeshIds made the gizmo drag the old group
      return { meshes: [...s.meshes, copy], selectedMeshId: id, selectedMeshIds: [id] };
    }),
  duplicateMesh: (id) =>
    set((s) => {
      const m = s.meshes.find((x) => x.id === (id ?? s.selectedMeshId));
      if (!m) return {};
      const { id: _omit, ...payload } = JSON.parse(JSON.stringify(m));
      const nid = get().newMeshId();
      const p = m.position || [0, 0.5, 0];
      const copy = { ...payload, id: nid, position: [p[0] + 0.15, p[1], p[2] + 0.15] };
      return { meshes: [...s.meshes, copy], selectedMeshId: nid, selectedMeshIds: [nid] };
    }),

  // ---- circuit actions ----
  addNode: (partId, x = 80 + Math.random() * 200, y = 80 + Math.random() * 160) =>
    set((s) => ({
      nodes: [...s.nodes, { id: 'n' + nodeSeq++, partId, x, y }],
    })),
  moveNode: (id, x, y) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) })),
  selectNode: (id) => set({ selectedNodeId: id }),
  removeNode: (id) =>
    set((s) => {
      // also drop the node's code and input state — stale entries used to
      // linger forever (and got saved into the project file)
      const { [id]: _c, ...codeByNode } = s.codeByNode;
      const { [id]: _i, ...inputs } = s.inputs;
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        wires: s.wires.filter((w) => w.from.node !== id && w.to.node !== id),
        selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
        codeByNode,
        inputs,
      };
    }),

  clickPin: (node, pin) => {
    const { pendingPin, wires } = get();
    if (!pendingPin) {
      set({ pendingPin: { node, pin } });
      return;
    }
    if (pendingPin.node === node && pendingPin.pin === pin) {
      set({ pendingPin: null });
      return;
    }
    const exists = wires.some(
      (w) =>
        (w.from.node === pendingPin.node && w.from.pin === pendingPin.pin && w.to.node === node && w.to.pin === pin) ||
        (w.to.node === pendingPin.node && w.to.pin === pendingPin.pin && w.from.node === node && w.from.pin === pin)
    );
    if (!exists) {
      set((s) => ({
        wires: [...s.wires, { id: 'w' + wireSeq++, from: pendingPin, to: { node, pin } }],
        pendingPin: null,
      }));
    } else {
      set({ pendingPin: null });
    }
  },
  cancelPin: () => set({ pendingPin: null }),
  removeWire: (id) => set((s) => ({ wires: s.wires.filter((w) => w.id !== id) })),
  clearCircuit: () => set({ nodes: [], wires: [], pendingPin: null, selectedNodeId: null, codeByNode: {}, inputs: {}, simOn: false }),

  // ---- apply a batch of agent-proposed circuit edits (after user permission) ----
  // actions: [{op:'addWire'|'removeWire'|'addPart'|'removePart', from?, to?, partId?, ref?, node?}]
  // Pin refs use "nodeId.pin" (e.g. "n1.+"). addPart may set "ref" alias, usable
  // as a node in later addWire refs within the same batch. Returns {applied, errors}.
  applyAgentActions: (actions) => {
    const errors = [];
    let applied = 0;
    set((s) => {
      let nodes = [...s.nodes];
      let wires = [...s.wires];
      const alias = {}; // agent ref alias -> real node id
      const resolveNode = (ref) => alias[ref] || ref;
      const parseRef = (r) => {
        const str = String(r ?? '');
        const i = str.indexOf('.');
        if (i < 0) return null;
        return { node: resolveNode(str.slice(0, i)), pin: str.slice(i + 1) };
      };
      const nodeById = (id) => nodes.find((n) => n.id === id);
      const pinOk = (node, pin) => {
        const n = nodeById(node);
        return n ? Boolean(PART_BY_ID[n.partId]?.pins?.includes(pin)) : false;
      };
      const sameWire = (w, f, t) =>
        (w.from.node === f.node && w.from.pin === f.pin && w.to.node === t.node && w.to.pin === t.pin) ||
        (w.to.node === f.node && w.to.pin === f.pin && w.from.node === t.node && w.from.pin === t.pin);

      for (const a of actions || []) {
        try {
          if (a.op === 'addPart') {
            if (!PART_BY_ID[a.partId]) { errors.push(`addPart: unknown partId "${a.partId}"`); continue; }
            const id = 'n' + nodeSeq++;
            nodes.push({ id, partId: a.partId, x: 80 + Math.random() * 220, y: 80 + Math.random() * 180 });
            if (a.ref) alias[a.ref] = id;
            applied++;
          } else if (a.op === 'removePart') {
            const id = resolveNode(a.node);
            if (!nodeById(id)) { errors.push(`removePart: no node "${a.node}"`); continue; }
            nodes = nodes.filter((n) => n.id !== id);
            wires = wires.filter((w) => w.from.node !== id && w.to.node !== id);
            applied++;
          } else if (a.op === 'addWire') {
            const f = parseRef(a.from), t = parseRef(a.to);
            if (!f || !t) { errors.push(`addWire: bad refs "${a.from}" / "${a.to}"`); continue; }
            if (!pinOk(f.node, f.pin)) { errors.push(`addWire: invalid pin "${a.from}"`); continue; }
            if (!pinOk(t.node, t.pin)) { errors.push(`addWire: invalid pin "${a.to}"`); continue; }
            if (wires.some((w) => sameWire(w, f, t))) { errors.push(`addWire: duplicate "${a.from}"-"${a.to}"`); continue; }
            wires.push({ id: 'w' + wireSeq++, from: f, to: t });
            applied++;
          } else if (a.op === 'removeWire') {
            const f = parseRef(a.from), t = parseRef(a.to);
            if (!f || !t) { errors.push(`removeWire: bad refs "${a.from}" / "${a.to}"`); continue; }
            const before = wires.length;
            wires = wires.filter((w) => !sameWire(w, f, t));
            if (wires.length === before) errors.push(`removeWire: not found "${a.from}"-"${a.to}"`);
            else applied++;
          } else {
            errors.push(`unknown op "${a.op}"`);
          }
        } catch (e) {
          errors.push(String(e?.message || e));
        }
      }
      return { nodes, wires };
    });
    return { applied, errors };
  },

  // ---- derived: bill of materials ----
  bom: () => {
    const counts = {};
    for (const n of get().nodes) counts[n.partId] = (counts[n.partId] || 0) + 1;
    const rows = Object.entries(counts).map(([partId, qty]) => {
      // guard: projects saved with older versions may reference removed parts
      const p = PART_BY_ID[partId] || { name: partId + ' (unknown part)', price: 0 };
      return { partId, name: p.name, qty, unit: p.price, total: +(p.price * qty).toFixed(2) };
    });
    const total = +rows.reduce((a, r) => a + r.total, 0).toFixed(2);
    return { rows, total };
  },

  // ---- push circuit parts into the 3D scene at real scale ----
  projectCircuitTo3D: () => {
    const { nodes } = get();
    const names = numberedNodeNames(nodes);
    const meshes = nodes.map((n, i) => {
      const p = PART_BY_ID[n.partId];
      // mm -> scene units (scaled up so the workspace isn't micro). Floor keeps
      // tiny parts visible. We keep the true mm in `mm` for the footprint label.
      const w = Math.max((p.size.w / 1000) * SCENE_SCALE, 0.04);
      const h = Math.max((p.size.h / 1000) * SCENE_SCALE, 0.04);
      const d = Math.max((p.size.d / 1000) * SCENE_SCALE, 0.04);
      const gap = 0.6;
      const cols = Math.ceil(Math.sqrt(nodes.length || 1));
      const gx = (i % cols) * gap - (cols * gap) / 2;
      const gz = Math.floor(i / cols) * gap - (cols * gap) / 2;
      return {
        id: 'part-' + n.id,
        kind: 'part',
        partId: n.partId,
        label: names[n.id] || p.name,
        size: [w, h, d],
        mm: [p.size.w, p.size.h, p.size.d],
        position: [gx, h / 2, gz],
        rotation: [0, 0, 0],
        color: p.color,
        scale: 1,
        material: partMaterial(n.partId),
      };
    });
    // Replace previously-projected parts, keep meshy/primitive meshes.
    set((s) => ({
      meshes: [...s.meshes.filter((m) => m.kind !== 'part'), ...meshes],
      tab: 'design',
    }));
  },

  // ---- project save / load ----
  serialize: () => {
    const { meshes, nodes, wires, codeByNode } = get();
    return JSON.stringify({ version: 1, meshes, nodes, wires, codeByNode }, null, 2);
  },
  loadProject: (data) => {
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      // bump sequence counters so new ids don't collide
      for (const n of obj.nodes || []) {
        const num = parseInt(String(n.id).replace(/\D/g, ''), 10);
        if (!isNaN(num)) nodeSeq = Math.max(nodeSeq, num + 1);
      }
      for (const w of obj.wires || []) {
        const num = parseInt(String(w.id).replace(/\D/g, ''), 10);
        if (!isNaN(num)) wireSeq = Math.max(wireSeq, num + 1);
      }
      set({
        meshes: obj.meshes || [],
        nodes: obj.nodes || [],
        wires: obj.wires || [],
        codeByNode: obj.codeByNode || {},
        selectedMeshId: null,
        selectedNodeId: null,
        pendingPin: null,
      });
      return true;
    } catch {
      return false;
    }
  },
}));
