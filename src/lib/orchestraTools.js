// ============================================================================
// Orchestra action API — the control surface every AI uses to drive Forge3D.
//
// This is the single vocabulary the in-app Orchestra director speaks, and the
// exact same set of tools the Claude MCP plugin (server/orchestra-mcp) bridges.
// Each tool is small, imperative and JSON-in / JSON-out, so a model can call it
// blindly. Tools operate on the zustand store and the existing `window.forge`
// IPC bridges (mesh gen, the circuit agent, codegen) — Orchestra never wires a
// circuit by hand, it hands a prompt to `build_circuit` (the circuit agent).
// ============================================================================
import { useStore } from './store.js';
import { captureViewportFresh } from './capture.js';
import { buildNetlist, partsCatalog } from './netlist.js';
import { PART_BY_ID, PARTS, DEFAULT_SHAPE_UNIT, SCENE_SCALE } from '../data/parts.js';
import { parseAgentJson } from './agentJson.js';
import { placeBlueprint, validateGeometry, applyGeometryFixes, BLUEPRINTS } from './orchestraGeometry.js';
import { motorReport, validateCircuit, indicatorReport } from './orchestraCircuit.js';
import { detectPattern, seedSpec } from './orchestraSpec.js';
import { composeSpec, getLastSpec, shapeScale } from './orchestraCompose.js';
import { validateStructure, applyStructureFixes } from './orchestraPhysics.js';
import { validateManufacture, validateIntegration } from './orchestraManufacture.js';

// Compact catalog for the director: "Category: id, id, …" (no pins — the circuit
// agent gets the full pinned catalog separately). Small = cheap + less confusing
// for a weak free model.
export function compactCatalog() {
  const byCat = {};
  for (const p of PARTS) (byCat[p.category] = byCat[p.category] || []).push(p.id);
  return Object.entries(byCat).map(([c, ids]) => `${c}: ${ids.join(', ')}`).join('\n');
}

const S = () => useStore.getState();
const MM = SCENE_SCALE / 1000; // millimetres -> scene units
const PRIMITIVE_KINDS = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'capsule', 'plane', 'tetrahedron', 'icosahedron'];
const MOTORISH = new Set(['dc-motor', 'servo-sg90', 'servo-mg996', 'stepper-28byj', 'stepper-nema17', 'vibration-motor', 'pump-12v', 'linear-actuator']);

function mockKind(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/(ball|sphere|planet|orb|head|wheel|tire)/.test(p)) return /(wheel|tire)/.test(p) ? 'cylinder' : 'sphere';
  if (/(can|bottle|tube|pipe|cylinder|barrel)/.test(p)) return 'cylinder';
  return 'box';
}

// Add a mesh and return its id (store.addMesh respects a provided id).
function addReturningId(mesh) {
  const id = S().newMeshId();
  S().addMesh({ id, ...mesh });
  return id;
}

// --- compact, headroom-aware snapshot of everything the director needs ---
export function compactState(headroom = 'balanced') {
  const s = S();
  const eco = headroom === 'eco';
  const round = (a) => (Array.isArray(a) ? a.map((n) => +(+n).toFixed(2)) : a);
  const meshes = s.meshes
    .filter((m) => m.kind !== 'part' || !eco) // eco hides raw footprints
    .map((m) => ({
      id: m.id,
      label: m.label || m.kind,
      kind: m.kind,
      partId: m.partId,
      ...(eco ? {} : { pos: round(m.position) }),
      ...(m.attachedTo ? { attachedTo: m.attachedTo, drives: m.drives !== false } : {}),
      ...(m.groupId ? { groupId: m.groupId } : {}),
    }));
  const motors = s.nodes.filter((n) => MOTORISH.has(n.partId)).map((n) => n.id);
  const inputs = s.nodes
    .filter((n) => ['joystick', 'push-button', 'toggle-switch', 'potentiometer'].includes(n.partId))
    .map((n) => ({ id: n.id, partId: n.partId, value: s.inputs[n.id] ?? null }));
  return {
    tab: s.tab,
    objectCount: meshes.length,
    meshes,
    // the full part list is here so the director never re-adds something that
    // already exists (a common failure when a sub-agent call errors out)
    circuit: { nodes: s.nodes.map((n) => ({ id: n.id, partId: n.partId })), wires: s.wires.length, motors, inputs },
    sim: { lifeSimRunning: s.lifeSimRunning, circuitOn: s.simOn },
    provider3d: s.provider,
  };
}

// ---------------------------------------------------------------------------
// Tool registry. `params` is documentation only (shown to the model). `run`
// returns a small JSON-serializable result; throw to report a failure.
// ---------------------------------------------------------------------------
export const TOOLS = {
  get_state: {
    desc: 'Read a compact snapshot of the scene + circuit + sim state.',
    params: {},
    run: () => compactState(S().orchestraHeadroom),
  },

  get_netlist: {
    desc: 'Read the circuit as a text netlist (parts, pins, wires, loose pins).',
    params: {},
    run: () => ({ netlist: buildNetlist(S().nodes, S().wires) }),
  },

  parts_catalog: {
    desc: 'List valid partIds grouped by category (only if you need a part not in COMMON PARTS).',
    params: {},
    run: () => ({ catalog: compactCatalog() }),
  },

  add_primitive: {
    desc: 'Add a primitive shape to the 3D scene — with REAL millimetre dimensions per axis if you give size_mm (e.g. a 157×121×29 mm radiator body: {"kind":"box","size_mm":{"w":157,"h":29,"d":121}}).',
    params: {
      kind: `one of ${PRIMITIVE_KINDS.join('|')}`, label: 'string', color: '#hex (optional)',
      size_mm: '{w,h,d} or {r,h} in real millimetres (optional — exact per-axis sizing)',
      position_mm: '[x,y,z] in millimetres (optional)', rotation: '[x,y,z] radians (optional)',
      negative: 'bool — a CUTTING shape: group it with a solid and it carves a hole (or just use cut_hole)',
    },
    run: ({ kind = 'box', label, color = '#7c93b8', size_mm, position_mm, rotation, negative }) => {
      if (!PRIMITIVE_KINDS.includes(kind)) throw new Error(`unknown primitive "${kind}"`);
      const mesh = { kind, label: label || kind, color, scale: DEFAULT_SHAPE_UNIT };
      if (size_mm && typeof size_mm === 'object') mesh.scale = shapeScale(kind, size_mm);
      if (Array.isArray(position_mm) && position_mm.length === 3) mesh.position = position_mm.map((n) => n * MM);
      if (Array.isArray(rotation) && rotation.length === 3) mesh.rotation = rotation;
      if (negative) mesh.negative = true;
      const id = addReturningId(mesh);
      return { id, kind, ...(size_mm ? { size_mm } : {}), ...(negative ? { negative: true } : {}) };
    },
  },

  cut_hole: {
    desc: 'Cut a hole/opening into a solid object: creates a negative shape at exact mm size and groups it with the host, so the boolean subtraction renders live. Use for ports, vents, windows, screw holes, cable pass-throughs. Host must be a primitive (not an imported STL/model).',
    params: {
      hostId: 'mesh id of the solid to cut into',
      kind: 'box|cylinder (shape of the hole; cylinder = round hole, default box)',
      size_mm: '{w,h,d} or {r,h} millimetres — the hole size',
      position_mm: '[x,y,z] millimetres — hole centre (should overlap the host)',
      rotation: '[x,y,z] radians (optional — e.g. [1.5708,0,0] for a horizontal round hole)',
    },
    run: ({ hostId, kind = 'box', size_mm, position_mm, rotation }) => {
      const host = S().meshes.find((m) => m.id === hostId);
      if (!host) throw new Error(`no mesh "${hostId}"`);
      if ((host.kind === 'meshy' || host.kind === 'stl') && host.modelUrl) throw new Error('cannot cut into an imported model — only primitives support boolean holes');
      if (!size_mm || typeof size_mm !== 'object') throw new Error('cut_hole needs size_mm');
      if (!Array.isArray(position_mm) || position_mm.length !== 3) throw new Error('cut_hole needs position_mm [x,y,z]');
      // the live CSG renderer works per group: reuse the host's group or start one
      const gid = host.groupId || 'g' + Date.now().toString(36);
      if (!host.groupId) S().updateMesh(hostId, { groupId: gid });
      const holeId = addReturningId({
        kind, label: 'hole', color: '#ef4444', negative: true, groupId: gid,
        scale: shapeScale(kind, size_mm),
        position: position_mm.map((n) => n * MM),
        rotation: Array.isArray(rotation) && rotation.length === 3 ? rotation : [0, 0, 0],
      });
      return { holeId, hostId, groupId: gid, size_mm };
    },
  },

  gen_mesh: {
    desc: 'Generate a 3D model from a text prompt with the active generator (Meshy/HF/mock) and add it to the scene.',
    params: { prompt: 'string', style: 'realistic|sculpture|cartoon (Meshy only)' },
    run: async ({ prompt, style = 'realistic' }) => {
      if (!prompt) throw new Error('gen_mesh needs a prompt');
      const provider = S().provider;
      const label = String(prompt).slice(0, 40);
      if (provider === 'hf') {
        const { modelUrl } = await window.forge.hf.generate({ prompt, steps: 32 });
        if (!modelUrl) throw new Error('HF returned no model (busy or out of quota)');
        const id = addReturningId({ kind: 'meshy', label, color: '#8aa0c8', modelUrl, scale: DEFAULT_SHAPE_UNIT });
        return { id, provider };
      }
      const { taskId, mock } = await window.forge.meshy.createTextTo3D({ prompt, artStyle: style });
      for (let i = 0; i < 120; i++) {
        const task = await window.forge.meshy.getTask(taskId);
        if (task.status === 'SUCCEEDED') {
          const id = addReturningId({
            kind: mock ? mockKind(prompt) : 'meshy',
            label, color: '#8aa0c8',
            modelUrl: task.model_urls?.glb || null,
            scale: DEFAULT_SHAPE_UNIT,
          });
          return { id, provider: mock ? 'mock' : 'meshy' };
        }
        if (task.status === 'FAILED') throw new Error('mesh generation failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error('mesh generation timed out');
    },
  },

  search_thingiverse: {
    desc: 'Search Thingiverse for real printable parts (radiators, cold plates, pumps, brackets, enclosures…). Returns candidate models to import with import_thingiverse. Needs a Thingiverse token in Settings.',
    params: { query: 'what to search for, e.g. "120mm radiator" or "water pump housing"' },
    run: async ({ query }) => {
      if (!query) throw new Error('search_thingiverse needs a query');
      const { hits } = await window.forge.thingiverse.search({ term: query, perPage: 10 });
      if (!hits?.length) return { hits: [], note: 'no results — try a broader term' };
      return { hits: hits.map((h) => ({ thingId: h.id, name: h.name, by: h.creator })) };
    },
  },

  import_thingiverse: {
    desc: 'Import a Thingiverse model (STL) into the 3D scene AT ITS REAL SIZE — the STL is measured in native millimetres, so a real 157 mm radiator arrives as 157 mm. Override with size_mm (longest dimension) if needed.',
    params: {
      thingId: 'id from search_thingiverse', label: 'display name (optional)',
      size_mm: 'number — force the longest dimension to this many mm (optional; default = native size)',
      position_mm: '[x,y,z] millimetres (optional)',
    },
    run: async ({ thingId, label, size_mm, position_mm }) => {
      if (!thingId) throw new Error('import_thingiverse needs a thingId');
      const { bytes, name, dims_mm } = await window.forge.thingiverse.import({ thingId });
      if (!bytes) throw new Error('Thingiverse returned no STL');
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
      // the viewer normalizes the model to longest-dim = 1 unit (aspect kept),
      // so a uniform scale of <longest mm> × MM restores its true physical size
      const native = dims_mm && Math.max(dims_mm.w, dims_mm.h, dims_mm.d) > 0 ? dims_mm : null;
      const longest = Number(size_mm) > 0 ? Number(size_mm) : native ? Math.max(native.w, native.h, native.d) : 60;
      const mesh = { kind: 'stl', label: label || name || `thing-${thingId}`, color: '#9aa7bd', modelUrl: blobUrl, scale: longest * MM };
      if (native) {
        const mx = Math.max(native.w, native.h, native.d);
        mesh.half = [native.w / (2 * mx), native.h / (2 * mx), native.d / (2 * mx)]; // honest AABB for the validators
        mesh.mm = [native.w, native.h, native.d];
      }
      if (Array.isArray(position_mm) && position_mm.length === 3) mesh.position = position_mm.map((n) => n * MM);
      const id = addReturningId(mesh);
      return { id, name: mesh.label, native_mm: native, placed_longest_mm: longest };
    },
  },

  move_mesh: {
    desc: 'Reposition / rotate / resize an existing object by id. size_mm resizes to exact real millimetres per axis; scale accepts a number OR [x,y,z].',
    params: {
      id: 'mesh id', position: '[x,y,z] scene units (opt)', position_mm: '[x,y,z] millimetres (opt)',
      rotation: '[x,y,z] radians (opt)', scale: 'number or [x,y,z] (opt)',
      size_mm: '{w,h,d} or {r,h} millimetres — exact per-axis resize (opt)',
    },
    run: ({ id, position, position_mm, rotation, scale, size_mm }) => {
      const mesh = S().meshes.find((m) => m.id === id);
      if (!mesh) throw new Error(`no mesh "${id}"`);
      const patch = {};
      if (Array.isArray(position_mm) && position_mm.length === 3) patch.position = position_mm.map((n) => n * MM);
      else if (position) patch.position = position;
      if (rotation) patch.rotation = rotation;
      if (size_mm && typeof size_mm === 'object') {
        if (PRIMITIVE_KINDS.includes(mesh.kind)) patch.scale = shapeScale(mesh.kind, size_mm);
        else {
          // loaded models (stl/meshy) are normalized to longest-dim = 1 unit,
          // so the longest requested mm sets a uniform scale (aspect preserved)
          const longest = Math.max(size_mm.w || 0, size_mm.h || 0, size_mm.d || 0, (size_mm.r || 0) * 2);
          if (longest > 0) patch.scale = longest * MM;
        }
      } else if (scale != null) patch.scale = scale;
      S().updateMesh(id, patch);
      return { id, ...patch };
    },
  },

  attach_motor: {
    desc: 'Mount one object onto another so they move as a unit. If one is a motor, it spins the other when the circuit powers it (e.g. attach a wheel to a dc-motor part).',
    params: { childId: 'mesh id mounted on parent', parentId: 'mesh id (or null to detach)', drives: 'bool — spin when powered (default true)' },
    run: ({ childId, parentId, drives = true }) => {
      if (!S().meshes.some((m) => m.id === childId)) throw new Error(`no mesh "${childId}"`);
      if (parentId && !S().meshes.some((m) => m.id === parentId)) throw new Error(`no mesh "${parentId}"`);
      S().setAttachment(childId, parentId || null, drives);
      return { childId, parentId: parentId || null, drives };
    },
  },

  set_material: {
    desc: 'Set what an object is made of (drives Life Sim durability).',
    params: { id: 'mesh id', materialKey: 'e.g. steel, abs, aluminum, wood…' },
    run: ({ id, materialKey }) => {
      if (!S().meshes.some((m) => m.id === id)) throw new Error(`no mesh "${id}"`);
      S().setMeshMaterial(id, materialKey);
      return { id, materialKey };
    },
  },

  group: {
    desc: 'Group several objects so they select/move/fall as one assembly.',
    params: { ids: '[mesh id, …] (>= 2)' },
    run: ({ ids }) => {
      if (!Array.isArray(ids) || ids.length < 2) throw new Error('group needs >= 2 ids');
      useStore.setState({ selectedMeshIds: ids, selectedMeshId: ids[ids.length - 1] });
      S().groupSelected();
      return { grouped: ids.length };
    },
  },

  add_part: {
    desc: 'Drop a single electronic part onto the circuit canvas by partId. Use parts_catalog first for valid ids.',
    params: { partId: 'valid partId' },
    run: ({ partId }) => {
      if (!PART_BY_ID[partId]) throw new Error(`unknown partId "${partId}"`);
      S().addNode(partId);
      const node = S().nodes[S().nodes.length - 1];
      return { nodeId: node.id, partId };
    },
  },

  build_circuit: {
    desc: 'Hand a plain-language wiring request to the circuit agent. It proposes add/remove part & wire edits which are applied automatically. This is how Orchestra builds circuits — it does NOT wire pins itself.',
    params: { prompt: 'e.g. "wire an Arduino Uno to two dc-motors via an L298N, driven by a joystick"' },
    run: async ({ prompt }) => {
      const { raw } = await window.forge.claude.circuit({
        prompt: prompt || 'Build/repair the circuit for the current goal.',
        netlist: buildNetlist(S().nodes, S().wires),
        catalog: partsCatalog(),
        provider: S().orchestraDirector, // use Orchestra's model, not the separate circuit setting
      });
      const parsed = parseAgentJson(raw);
      if (!parsed) return { applied: 0, errors: ['circuit agent did not return structured edits'], summary: String(raw || '').slice(0, 300) };
      const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      const { applied, errors } = S().applyAgentActions(actions);
      return { applied, errors, summary: parsed.summary || '', proposed: actions.length };
    },
  },

  gen_code: {
    desc: 'Ask the code agent to write a sketch/program for a microcontroller node and load it into the sim.',
    params: { nodeId: 'MCU node id', prompt: 'what the firmware should do' },
    run: async ({ nodeId, prompt }) => {
      const node = S().nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`no circuit node "${nodeId}"`);
      const target = node.partId === 'rpi5' ? 'rpi5' : 'arduino';
      const context = buildNetlist(S().nodes, S().wires);
      const { code } = await window.forge.claude.generate({ prompt, context, target, provider: S().orchestraDirector });
      S().setNodeCode(nodeId, code || '');
      return { nodeId, lines: String(code || '').split('\n').length };
    },
  },

  project_circuit_3d: {
    desc: 'Push the circuit parts into the 3D scene as real-scale bodies (so the Life Sim has something physical to run).',
    params: {},
    run: () => { S().projectCircuitTo3D(); return { objects: S().meshes.length }; },
  },

  set_tab: {
    desc: 'Switch the visible workspace.',
    params: { tab: 'design|circuit|export|lifesim|orchestra' },
    run: ({ tab }) => {
      if (!['design', 'circuit', 'export', 'lifesim', 'orchestra'].includes(tab)) throw new Error(`unknown tab "${tab}"`);
      S().setTab(tab);
      return { tab };
    },
  },

  run_sim: {
    desc: 'Switch to the Life Sim and start it (powers the circuit + gravity + spinning motors).',
    params: {},
    run: () => { S().setTab('lifesim'); S().setLifeSimRunning(true); if (!S().simOn) S().toggleSim(); return { running: true }; },
  },

  pause_sim: {
    desc: 'Pause the Life Sim.',
    params: {},
    run: () => { S().setLifeSimRunning(false); return { running: false }; },
  },

  set_joystick: {
    desc: 'Move a joystick input. x/y are 0..1 (0.5 = center, 1 = up/right). sw = press the stick button.',
    params: { nodeId: 'joystick node id (optional — defaults to first joystick)', x: '0..1', y: '0..1', sw: 'bool (opt)' },
    run: ({ nodeId, x = 0.5, y = 0.5, sw }) => {
      const id = nodeId || S().nodes.find((n) => n.partId === 'joystick')?.id;
      if (!id) throw new Error('no joystick in the circuit');
      const prev = S().inputs[id] || {};
      S().setInput(id, { ...prev, x, y, ...(sw != null ? { sw } : {}) });
      return { nodeId: id, x, y };
    },
  },

  set_input: {
    desc: 'Drive a button (value=true/false), switch (true/false) or potentiometer (0..1).',
    params: { nodeId: 'input node id', value: 'bool | 0..1' },
    run: ({ nodeId, value }) => {
      if (!S().nodes.some((n) => n.id === nodeId)) throw new Error(`no input node "${nodeId}"`);
      S().setInput(nodeId, value);
      return { nodeId, value };
    },
  },

  get_sim_report: {
    desc: 'Read the latest Life Sim physics report (per-object temperature, integrity, status).',
    params: {},
    run: () => {
      const rep = S().simReport || {};
      const objects = Object.entries(rep.objects || {}).map(([id, o]) => ({
        id, temp: Math.round(o.temp ?? 25), integrity: +(o.integrity ?? 1).toFixed(2),
        ignited: !!o.ignited, destroyed: !!o.destroyed,
      }));
      return { elapsed: +(rep._t || 0).toFixed(1), running: S().lifeSimRunning, objects };
    },
  },

  look: {
    desc: 'CAPTURE the live viewport and ask the vision model a question about it ("does this look like a 4-wheeled car? are the wheels on the ground?"). Use this to CONFIRM a step before moving on.',
    params: { question: 'what to check in the image' },
    run: async ({ question }) => {
      const headroom = S().orchestraHeadroom;
      const shot = await captureViewportFresh(headroom);
      if (!shot) return { ok: false, verdict: 'No viewport to capture yet (add/generate an object first).' };
      // stash a thumbnail on the current step so the live panel shows what the model saw
      S().orchestraPatchLast({ image: shot.dataUrl });
      const res = await window.forge.orchestra.vision({
        prompt: question || 'Describe what you see and whether it matches the goal.',
        imageDataUrl: shot.dataUrl,
      });
      return { ok: true, verdict: res?.text || '(no answer)', model: res?.model };
    },
  },

  build_blueprint: {
    desc: 'Place a correctly-proportioned starter build for a known archetype (car, robot, lamp) — chassis, wheels-laid-flat, etc. Replaces existing design shapes. Use this first for a recognized project, then customize.',
    params: { archetype: `one of ${Object.keys(BLUEPRINTS).join('|')}` },
    run: ({ archetype }) => {
      const created = placeBlueprint(archetype);
      if (!created) throw new Error(`no blueprint for "${archetype}"`);
      return { archetype, created };
    },
  },

  check_geometry: {
    desc: 'Validate the 3D geometry (wheel orientation, floating parts, bad proportions) and auto-fix what is safe. Pass autofix:false to only report, without moving anything.',
    params: { archetype: 'car|robot|lamp|generic (optional)', autofix: 'bool — apply safe fixes (default true)' },
    run: ({ archetype = 'generic', autofix = true } = {}) => {
      const issues = validateGeometry(archetype);
      if (!autofix) return { found: issues.map((i) => i.msg), autofixed: 0 };
      const fixed = applyGeometryFixes(issues);
      const remaining = validateGeometry(archetype);
      return { found: issues.map((i) => i.msg), autofixed: fixed, remaining: remaining.map((i) => i.msg) };
    },
  },

  check_circuit: {
    desc: 'Functionally validate the circuit (power, ground, driver, and whether motors actually turn when driven). Returns concrete deficiencies — empty means it works.',
    params: { archetype: 'car|robot|lamp|generic (optional)' },
    run: ({ archetype = 'generic' }) => ({ deficiencies: validateCircuit(archetype) }),
  },

  check_motors: {
    desc: 'Run the electrical sim with inputs driven (joystick forward) and report whether each motor is active and its direction.',
    params: {},
    run: () => motorReport(),
  },

  design_structure: {
    desc: 'Compose a full structural product (house/enclosure) from a goal: real-scale geometry with CSG cutouts (doors/windows/ports) PLUS electronics mounted on it and wired by function. Use for non-vehicle builds.',
    params: { goal: 'plain-language project description' },
    run: ({ goal }) => {
      const pattern = detectPattern(goal);
      const spec = seedSpec(pattern, goal);
      if (!spec) throw new Error(`no structural template for "${pattern}" — use add_primitive/build_circuit`);
      const comp = composeSpec(spec);
      return { pattern, bodies: comp.bodies, cutouts: comp.cutouts, mounted: comp.mounted, leds: comp.circuit?.ledCount };
    },
  },

  validate_structure: {
    desc: 'Engineer-grade physical check: mass, center of mass, support (no floating parts), tip-over stability and interference. REPORT-ONLY by default — nothing is moved. Pass autofix:true to apply the safe fixes (only do this on layouts you did not place by hand).',
    params: { autofix: 'bool — apply safe fixes (default false: report only)' },
    run: ({ autofix = false } = {}) => {
      const before = validateStructure();
      if (!autofix) {
        return {
          mass_g: before.mass, com: before.com, stable: before.stable,
          issues: before.issues.map((i) => i.msg),
          ...(before.issues.length ? { hint: 'nothing was moved. If parts belong together, attach_motor/group them so gravity treats them as one unit; or re-run with {"autofix":true} to apply safe fixes.' } : {}),
        };
      }
      const fixed = applyStructureFixes(before.issues);
      const after = validateStructure();
      return { mass_g: after.mass, com: after.com, stable: after.stable, autofixed: fixed, issues: after.issues.map((i) => i.msg) };
    },
  },

  check_indicators: {
    desc: 'With the button pressed, report whether each indicator LED actually turns on (functional electrical check).',
    params: {},
    run: () => indicatorReport(),
  },

  validate_manufacture: {
    desc: 'Check the last composed structure for FDM printability (min wall, bed fit), part-fit tolerances (each part has a hole/cavity), and a BOM + feasibility report.',
    params: {},
    run: () => {
      const spec = getLastSpec();
      if (!spec) throw new Error('nothing composed yet — run design_structure first');
      const m = validateManufacture(spec);
      return { ...m.report, issues: m.issues.map((i) => i.msg) };
    },
  },

  validate_integration: {
    desc: 'Check that each electronic is mounted on a real exterior face, indicators face outward, and nothing is buried in a wall.',
    params: {},
    run: () => {
      const spec = getLastSpec();
      if (!spec) throw new Error('nothing composed yet — run design_structure first');
      return { issues: validateIntegration(spec).issues.map((i) => i.msg) };
    },
  },

  done: {
    desc: 'Finish the run. Provide a short summary of what was built.',
    params: { summary: 'string' },
    run: ({ summary }) => ({ done: true, summary: summary || 'Done.' }),
  },
};

// Compact tool list for the system prompt (name + one-line desc + params).
export function toolSpec() {
  return Object.entries(TOOLS)
    .map(([name, t]) => {
      const p = Object.keys(t.params || {}).length
        ? ' args: ' + Object.entries(t.params).map(([k, v]) => `${k} (${v})`).join(', ')
        : '';
      return `- ${name}: ${t.desc}${p}`;
    })
    .join('\n');
}

// Execute a single tool call. Returns { ok, result } or { ok:false, error }.
export async function runTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, error: `unknown tool "${name}"` };
  try {
    const result = await tool.run(args || {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
