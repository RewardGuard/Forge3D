// ============================================================================
// Orchestra director — an autonomous ENGINEERING PIPELINE, not a chatbot.
//
// A weak free model cannot place wheels, wire a working car and analyse a sim
// one token-call at a time. So Orchestra is a hybrid: deterministic engineering
// knowledge (correct proportions, canonical wiring, functional checks) carries
// the parts that have a known-right answer, while the LLM handles classification
// and generic/novel goals. The result is consistent and actually functional.
//
// For a recognised project ("a joystick car") it runs the real engineering loop:
//   1. MODEL    — lay down a correctly-proportioned 3D build, validate geometry,
//                 auto-fix, then SEE it (GLM-4.5V) and confirm.
//   2. CIRCUIT  — build the canonical wiring, then FUNCTIONALLY validate it
//                 (run the electrical sim) and iterate with the circuit agent
//                 until the motors actually turn.
//   3. FIRMWARE — load/generate the controller program.
//   4. ASSEMBLE — mount the wheels on the motors (mechatronics).
//   5. TEST     — run the Life Sim, drive the joystick, read the result, SEE it,
//                 and fix anything that didn't work.
// Generic goals fall back to the robust LLM tool-loop, which can still call the
// same validators (check_geometry / check_circuit / look).
// ============================================================================
import { useStore } from './store.js';
import { parseAgentJson } from './agentJson.js';
import { compactState, toolSpec, runTool, TOOLS } from './orchestraTools.js';
import { captureViewport } from './capture.js';
import { classifyGoal, placeBlueprint, validateGeometry, applyGeometryFixes, BLUEPRINTS } from './orchestraGeometry.js';
import {
  placeArchetypeCircuit, validateCircuit, motorReport, hasBlueprintCircuit,
  circuitPrompt, circuitFixPrompt, firmwarePrompt, indicatorReport,
  circuitPromptFromSpec, firmwarePromptFromSpec, synthesizeCircuit,
} from './orchestraCircuit.js';
import { detectPattern, seedSpec, generateSpec } from './orchestraSpec.js';
import { composeGeometry, mountByNetlist, assembleVehicle } from './orchestraCompose.js';
import { validateStructure, applyStructureFixes } from './orchestraPhysics.js';
import { validateManufacture, validateIntegration } from './orchestraManufacture.js';
import { validateAll, conforms, collectDeficiencies } from './orchestraCore.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estTokens = (s) => Math.ceil(String(s || '').length / 4);
const TOOL_NAMES = Object.keys(TOOLS);
const READONLY = new Set(['get_state', 'get_netlist', 'parts_catalog', 'get_sim_report', 'check_motors', 'check_circuit', 'check_geometry']);

export const BUDGET = {
  eco: { steps: 14, tokens: 30000, history: 2 },
  balanced: { steps: 24, tokens: 80000, history: 4 },
  max: { steps: 36, tokens: 200000, history: 6 },
};

// ---- timeline logging helpers (everything is observable in real time) ----
const S = () => useStore.getState();
const phase = (note) => { S().setOrchestraPhase(note.replace(/^\d+\/\d+\s*·\s*/, '')); S().orchestraAddStep({ kind: 'phase', note }); };
const note = (note) => S().orchestraAddStep({ kind: 'note', note });
const fail = (note) => S().orchestraAddStep({ kind: 'error', note });
function act(tool, args, result, ok = true, image) {
  S().orchestraAddStep({ kind: 'action', tool, args, result, ok, image });
}
const stopped = () => S().orchestraStatus !== 'running';

// Capture a given workspace view and ask the vision model about it. Vision is a
// CONFIRMATION layer on top of the deterministic validators — if there's no HF
// token it returns a skip message and the run continues.
async function lookGate(view, question) {
  // the live viewport is embedded in the Orchestra stage now — just point it at
  // the right view and capture from it (no tab switching, you keep watching).
  S().setOrchestraView(view === 'lifesim' ? 'sim' : 'build');
  await sleep(450); // let the Canvas render a frame for preserveDrawingBuffer
  const shot = captureViewport(S().orchestraHeadroom);
  S().orchestraAddStep({ kind: 'action', tool: 'look', args: { view }, thought: question, image: shot?.dataUrl });
  if (!shot) { S().orchestraPatchLast({ result: { verdict: 'no viewport to capture' }, ok: true }); return ''; }
  try {
    const res = await window.forge.orchestra.vision({
      prompt: `${question}\nReply in 2-3 sentences, starting with "OK" if it looks right or "PROBLEM" if not.`,
      imageDataUrl: shot.dataUrl,
    });
    S().orchestraAddTokens(450);
    const verdict = res?.text || '(no answer)';
    S().orchestraPatchLast({ result: { verdict }, ok: true });
    return verdict;
  } catch (e) {
    S().orchestraPatchLast({ error: String(e?.message || e), ok: false });
    return '';
  }
}

// ============================================================================
// The engineering pipeline for a recognised archetype.
// ============================================================================
async function runPipeline(goal, archetype) {
  // ---------- PHASE 1: 3D MODEL ----------
  phase(`1/5 · 3D model — laying out a proportioned ${archetype}`);
  const created = placeBlueprint(archetype);
  act('build_blueprint', { archetype }, { placed: created?.map((c) => c.label) });
  await sleep(300);

  let issues = validateGeometry(archetype);
  const fixed = applyGeometryFixes(issues);
  let remaining = validateGeometry(archetype);
  act('check_geometry', { archetype }, { found: issues.map((i) => i.msg), autofixed: fixed, remaining: remaining.map((i) => i.msg) });

  const verdict = await lookGate('design', `Is this a well-proportioned ${archetype}? Are the wheels lying flat on the ground and placed at the corners (not standing upright)? List any problem.`);
  if (/\bproblem\b|upright|floating|too big|wrong|disproportion/i.test(verdict)) {
    // vision flagged something the deterministic pass may have missed — re-run it
    const again = validateGeometry(archetype);
    const f2 = applyGeometryFixes(again);
    if (f2) act('check_geometry', { archetype, pass: 2 }, { autofixed: f2, remaining: validateGeometry(archetype).map((i) => i.msg) });
  }
  if (stopped()) return;

  // ---------- PHASE 2: CIRCUIT ----------
  phase('2/5 · Electronics — wiring the circuit');
  if (hasBlueprintCircuit(archetype)) {
    const r = placeArchetypeCircuit(archetype);
    act('build_circuit', { archetype, canonical: true }, { applied: r?.applied, firmware: r?.firmwareSet });
  } else {
    const r = await runTool('build_circuit', { prompt: circuitPrompt(archetype) });
    S().orchestraAddTokens(1500);
    act('build_circuit', { prompt: '(circuit agent)' }, r.ok ? r.result : { error: r.error }, r.ok);
  }
  await sleep(150);

  // functionally validate, and iterate with the circuit agent until it works
  for (let i = 1; i <= 3; i++) {
    if (stopped()) return;
    const def = validateCircuit(archetype);
    act('check_circuit', { archetype, pass: i }, { deficiencies: def });
    if (!def.length) break;
    if (i === 3) { note(`Circuit still imperfect after ${i} tries: ${def.join('; ')}. Continuing with what works.`); break; }
    const r = await runTool('build_circuit', { prompt: circuitFixPrompt(def) });
    S().orchestraAddTokens(1500);
    act('build_circuit', { fix: true, pass: i }, r.ok ? r.result : { error: r.error }, r.ok);
    await sleep(150);
  }
  const mr = motorReport();
  act('check_motors', {}, mr);

  // ---------- PHASE 3: FIRMWARE ----------
  phase('3/5 · Firmware');
  const mcu = S().nodes.find((n) => ['arduino-uno', 'arduino-nano', 'esp32', 'rpi-pico'].includes(n.partId));
  if (hasBlueprintCircuit(archetype)) {
    note('Loaded the canonical, sim-verified controller program for this build.');
  } else if (mcu) {
    const r = await runTool('gen_code', { nodeId: mcu.id, prompt: firmwarePrompt(archetype) });
    S().orchestraAddTokens(1800);
    act('gen_code', { nodeId: mcu.id }, r.ok ? r.result : { error: r.error }, r.ok);
  }
  if (stopped()) return;

  // ---------- PHASE 4: ASSEMBLE (mechatronics) ----------
  phase('4/5 · Mechatronics — mounting the wheels on the motors');
  const asm = assembleWheelsToMotors();
  act('assemble', {}, asm);
  await sleep(200);

  // ---------- PHASE 5: TEST IN THE LIFE SIM ----------
  phase('5/5 · Test — driving it in the Life Sim');
  // push the joystick forward so the motors should run
  const joy = S().nodes.find((n) => n.partId === 'joystick');
  if (joy) S().setInput(joy.id, { x: 0.5, y: 1 });
  const btn = S().nodes.find((n) => n.partId === 'push-button');
  if (btn) S().setInput(btn.id, true);
  S().setTab('lifesim');
  S().setLifeSimRunning(true);
  if (!S().simOn) S().toggleSim();
  await sleep(1200); // let it run

  const driven = motorReport();
  const functional = driven.anyActive;
  act('check_motors', { driving: true }, driven);
  const rep = S().simReport || {};
  const hot = Object.values(rep.objects || {}).filter((o) => o.temp > 60).length;
  act('get_sim_report', {}, { elapsed: +(rep._t || 0).toFixed(1), running: S().lifeSimRunning, hotParts: hot });

  await lookGate('lifesim', `This is a ${archetype} running in the simulator with the joystick pushed forward. Do the wheels look like they are turning and is it on the ground?`);

  if (!functional) {
    note('Motors did not turn under drive — re-checking the wiring.');
    const def = validateCircuit(archetype);
    if (def.length) {
      const r = await runTool('build_circuit', { prompt: circuitFixPrompt(def) });
      S().orchestraAddTokens(1500);
      act('build_circuit', { repair: true }, r.ok ? r.result : { error: r.error }, r.ok);
      const after = motorReport();
      act('check_motors', { afterRepair: true }, after);
    }
  }

  S().setTab('orchestra');
  const finalMr = motorReport();
  const ok = finalMr.anyActive;
  S().orchestraAddStep({
    kind: 'action', tool: 'done',
    args: {}, ok: true,
    result: {
      summary: ok
        ? `Built a functional ${archetype}: proportioned 3D model (geometry validated), canonical circuit that the electrical sim confirms drives ${finalMr.motors.filter((m) => m.active).length}/${finalMr.motors.length} motors from the joystick, controller firmware loaded, wheels mounted on the motors, and tested in the Life Sim.`
        : `Built a ${archetype} (3D + circuit + firmware + assembly), but the motors aren't turning under drive — the circuit needs a manual look. Everything else is in place.`,
    },
  });
  S().orchestraSetStatus(ok ? 'done' : 'stopped');
}

// Project the circuit into 3D and rigidly mount each wheel onto a motor so the
// Life Sim spins them when the circuit powers the motor. The control parts are
// tucked into a neat bench row beside the vehicle.
function assembleWheelsToMotors() {
  S().projectCircuitTo3D(); // adds part-<nodeId> meshes; switches to design tab
  const meshes = S().meshes;
  const upd = S().updateMesh;
  const attach = S().setAttachment;
  const wheels = meshes.filter((m) => m.role === 'wheel');
  const motorMeshes = meshes.filter((m) => m.kind === 'part' && m.partId === 'dc-motor');
  const otherParts = meshes.filter((m) => m.kind === 'part' && m.partId !== 'dc-motor');

  otherParts.forEach((m, i) => upd(m.id, { position: [-3.1 + (i % 4) * 0.62, 0.12, -2.9 - Math.floor(i / 4) * 0.62] }));

  let attached = 0;
  if (motorMeshes.length && wheels.length) {
    motorMeshes.forEach((mm, mi) => {
      const mine = wheels.filter((_, wi) => wi % motorMeshes.length === mi);
      // tuck the motor under the chassis (concealed) — attachment drives the
      // wheel from the circuit regardless of where the motor mesh sits
      upd(mm.id, { position: [0, 0.22, mi === 0 ? 0.25 : -0.25], scale: 0.5 });
      mine.forEach((w) => { attach(w.id, mm.id, true); attached++; });
    });
  }
  return { projectedMotors: motorMeshes.length, wheelsAttached: attached };
}

// ============================================================================
// Generic LLM tool-loop (for goals with no blueprint). Robust against weak
// models: trivial TOOL:/ARGS: format, very tolerant parser, in-turn correction.
// ============================================================================
function systemPrompt() {
  return [
    'You are Orchestra, the DIRECTOR of an AI maker studio (Forge3D). Reach the goal by calling TOOLS, ONE per turn. You delegate real work and never wire pins or draw geometry by hand.',
    '',
    'OUTPUT FORMAT — every turn reply with EXACTLY these lines, nothing else:',
    'TOOL: <one tool name>',
    'ARGS: <one-line JSON, or {}>',
    'WHY: <short reason>',
    '',
    'Example:',
    'TOOL: add_primitive',
    'ARGS: {"kind":"box","label":"base","color":"#888"}',
    'WHY: start the body',
    '',
    'RULES:',
    '- CURRENT STATE lists every object (meshes) and circuit part (circuit.nodes). REUSE by id — never add what already exists.',
    '- Wire circuits via build_circuit (one plain-language request). After a visible change, use check_geometry then look to confirm. Validate wiring with check_circuit and motors with check_motors.',
    '- A wheel is a cylinder rotated [0,0,1.5708]. Call done when finished.',
    '',
    'COMMON PARTS: arduino-uno, esp32 · l298n · dc-motor, servo-sg90 · joystick, push-button, potentiometer · battery-9v · led-5mm, buzzer · hcsr04, pir.',
    '',
    'TOOLS:',
    toolSpec(),
  ].join('\n');
}

function buildUserText(goal, headroom, history, budget) {
  const recent = history.slice(-budget.history)
    .map((h, i) => `${i + 1}. ${h.tool} ${JSON.stringify(h.args)} -> ${h.summary}`)
    .join('\n') || '(nothing yet — first step)';
  return [
    `GOAL: ${goal}`, '', 'CURRENT STATE:', JSON.stringify(compactState(headroom)),
    '', 'RECENT ACTIONS:', recent, '', 'Your next command (TOOL: / ARGS: / WHY:):',
  ].join('\n');
}

export function extractCall(text) {
  const raw = String(text || '');
  const toolM = raw.match(/(?:^|\n)\s*TOOL\s*[:=]\s*["']?([a-z_]+)/i);
  if (toolM && TOOL_NAMES.includes(toolM[1].toLowerCase())) {
    const tool = toolM[1].toLowerCase();
    const why = (raw.match(/(?:^|\n)\s*(?:WHY|THOUGHT|REASON)\s*[:=]\s*(.+)/i) || [])[1] || '';
    let args = {};
    const argsM = raw.match(/ARGS\s*[:=]\s*(\{[\s\S]*?\})\s*(?:\n\s*[A-Z]+\s*[:=]|$)/i) || raw.match(/ARGS\s*[:=]\s*(\{[\s\S]*\})/i);
    if (argsM) { const o = parseAgentJson(argsM[1]); if (o && typeof o === 'object') args = o; }
    return { thought: why.trim().slice(0, 200), tool, args };
  }
  const call = normalizeCall(parseAgentJson(raw));
  if (call && TOOL_NAMES.includes(call.tool)) return call;
  for (const name of TOOL_NAMES) {
    if (name === 'done') continue;
    if (new RegExp(`\\b${name}\\b`).test(raw)) {
      const near = raw.slice(raw.search(new RegExp(`\\b${name}\\b`)));
      const o = parseAgentJson(near);
      const args = o && typeof o === 'object' && !o.tool && !o.action ? o : {};
      return { thought: '', tool: name, args };
    }
  }
  return null;
}

function normalizeCall(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const call = (obj.tool || obj.action || obj.name) ? obj
    : (obj.tool_call || obj.toolCall || (Array.isArray(obj.tools) && obj.tools[0]) || (Array.isArray(obj.actions) && obj.actions[0]) || obj);
  const tool = call.tool || call.action || call.name;
  if (!tool) return null;
  const args = call.args || call.arguments || call.params || call.input || {};
  return { thought: String(obj.thought || call.thought || '').slice(0, 200), tool: String(tool), args: typeof args === 'object' ? args : {} };
}

function describeResult(r) {
  if (!r) return '';
  if (r.ok === false) return `ERROR: ${r.error}`;
  const v = r.result ?? r;
  const str = typeof v === 'string' ? v : JSON.stringify(v);
  return str.length > 240 ? str.slice(0, 240) + '…' : str;
}

async function think(system, userText, headroom) {
  const maxTokens = headroom === 'eco' ? 600 : headroom === 'max' ? 1200 : 900;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await window.forge.orchestra.think({ system, userText, maxTokens }); }
    catch (e) { lastErr = e; if (attempt === 0) await sleep(900); }
  }
  throw lastErr;
}

async function genericLoop(goal, headroom) {
  const budget = BUDGET[headroom] || BUDGET.balanced;
  const system = systemPrompt();
  const history = [];
  let hardFails = 0, failTool = null, failStreak = 0, prevTool = null;

  for (let step = 0; step < budget.steps; step++) {
    if (stopped()) return;
    if (S().orchestraTokens > budget.tokens) {
      note(`Token headroom reached (~${budget.tokens.toLocaleString()}). Stopping. Raise headroom in Settings to go further.`);
      S().orchestraSetStatus('stopped'); return;
    }
    const baseUser = buildUserText(goal, headroom, history, budget);
    let call = null, correction = '';
    for (let attempt = 0; attempt < 3 && !call; attempt++) {
      let resp;
      try { resp = await think(system, baseUser + correction, headroom); }
      catch (e) { fail(`Director model failed (${String(e?.message || e)}). Pick a different Director model in Settings → Orchestra AI.`); S().orchestraSetStatus('error'); return; }
      S().orchestraAddTokens(estTokens(system) + estTokens(baseUser) + estTokens(resp?.text));
      if (resp?.mock) { fail('Director is in mock mode — choose a Director model in Settings → Orchestra AI.'); S().orchestraSetStatus('error'); return; }
      call = extractCall(resp?.text);
      if (!call) correction = `\n\nYour last reply could not be understood:\n"""${String(resp?.text || '').slice(0, 240)}"""\nReply with ONLY:\nTOOL: <one tool name>\nARGS: <one-line JSON>\nWHY: <reason>`;
    }
    if (!call) {
      hardFails++;
      note(`Director didn't return a usable command (try ${hardFails}/2). The "base" model is small — pick Claude or Gemini as Director for reliable runs.`);
      if (hardFails >= 2) { S().orchestraSetStatus('error'); return; }
      continue;
    }
    hardFails = 0;
    if (READONLY.has(call.tool) && call.tool === prevTool) { history.push({ tool: call.tool, args: call.args, summary: '(already retrieved — move on)' }); prevTool = call.tool; continue; }

    S().orchestraAddStep({ kind: 'action', thought: call.thought, tool: call.tool, args: call.args });
    if (call.tool === 'done') { S().orchestraPatchLast({ result: { summary: call.args?.summary || 'Done.' }, ok: true }); S().orchestraSetStatus('done'); return; }
    if (['add_primitive', 'gen_mesh', 'move_mesh', 'attach_motor', 'build_blueprint', 'run_sim'].includes(call.tool)) await sleep(250);

    const res = await runTool(call.tool, call.args);
    S().orchestraPatchLast({ result: res.ok ? res.result : undefined, error: res.ok ? undefined : res.error, ok: res.ok });
    history.push({ tool: call.tool, args: call.args, summary: describeResult(res) });
    prevTool = call.tool;
    if (!res.ok) {
      failStreak = call.tool === failTool ? failStreak + 1 : 1; failTool = call.tool;
      if (failStreak >= 2) { note(`"${call.tool}" failed ${failStreak}× (${res.error}). Its provider is likely unavailable — switch the Director model. Stopping.`); S().orchestraSetStatus('stopped'); return; }
    } else { failStreak = 0; failTool = null; }
    await sleep(120);
  }
  if (S().orchestraStatus === 'running') { note(`Reached the ${budget.steps}-step limit for "${headroom}" headroom.`); S().orchestraSetStatus('stopped'); }
}

// ============================================================================
// STRUCTURE pipeline — houses, enclosures and other static products. Composes an
// INTEGRATED model from a Design Spec (geometry with CSG cutouts + electronics
// mounted on the structure + function-based wiring) and validates it physically
// and electrically. This is the path that builds a real house with exterior LEDs
// + a button — not a lamp.
// Models the user can use, BEST-CAPABILITY FIRST; the free base model is always
// the floor at the end. Only models with a key are listed (base needs none).
function availableModels() {
  const s = S();
  const ranked = [
    ['anthropic', s.hasAnthropicKey], ['gemini', s.hasGeminiKey], ['groq', s.hasGroqKey],
    ['glm', s.hasGlmKey], ['mistral', s.hasMistralKey], ['openrouter', s.hasOpenrouterKey],
  ];
  const list = ranked.filter(([, k]) => k).map(([m]) => m);
  list.push('base');
  return list;
}
function setDirectorPersist(model) {
  S().setOrchestraDirector(model);
  try { window.forge.config.setOrchestraDirector(model); } catch { /* browser preview */ }
}
const findMCU = () => S().nodes.find((n) => ['arduino-uno', 'arduino-nano', 'esp32', 'rpi-pico'].includes(n.partId));
function removeMountedParts() { useStore.setState((s) => ({ meshes: s.meshes.filter((m) => m.kind !== 'part') })); }

// Does the built circuit actually WORK? (LEDs light, every expected motor turns.)
function validateFunctional(spec) {
  const ind = indicatorReport();
  const mr = motorReport();
  const hasInd = ind.total > 0, hasMotors = mr.motors.length > 0;
  const expMotors = (spec.electronics || []).filter((e) => e.function === 'actuator' && e.partId === 'dc-motor').length;
  const ledOk = hasInd ? ind.lit === ind.total : true;
  const motorOk = hasMotors ? mr.anyActive : expMotors === 0;
  return {
    ok: ledOk && motorOk && S().nodes.length > 0,
    leds: hasInd ? `${ind.lit}/${ind.total}` : undefined,
    motors: hasMotors ? `${mr.motors.filter((m) => m.active).length}/${mr.motors.length}` : undefined,
  };
}

// AUTO-ESCALATION: delegate the wiring to the build_circuit agent, validate it in
// the simulator, and if it fails (quota/error or the outputs don't actually drive)
// switch orchestraDirector to the next-best model and retry. The deterministic
// synthesizer is only the last-resort floor so the run can NEVER fail outright.
async function buildCircuitWithEscalation(spec) {
  const cPrompt = circuitPromptFromSpec(spec);
  const fPrompt = firmwarePromptFromSpec(spec);
  for (const model of availableModels()) {
    if (stopped()) return null;
    setDirectorPersist(model);
    useStore.getState().clearCircuit();
    removeMountedParts();
    act('use_model', { director: model }, { trying: model });
    const r = await runTool('build_circuit', { prompt: cPrompt }); // routed via provider: orchestraDirector
    S().orchestraAddTokens(1600);
    if (!r.ok) { note(`${model}: circuit agent error — escalating to the next model.`); continue; }
    act('build_circuit', { model }, r.result, true);
    const mcu = findMCU();
    if (mcu) { const g = await runTool('gen_code', { nodeId: mcu.id, prompt: fPrompt }); S().orchestraAddTokens(1800); act('gen_code', { model }, g.ok ? g.result : { error: g.error }, g.ok); }
    mountByNetlist(spec);
    if (spec.isVehicle) assembleVehicle();
    const v = validateFunctional(spec);
    act('check_circuit', { model }, v);
    if (v.ok) return { model, via: 'agent', v };
    { const got = [v.leds && `LEDs ${v.leds}`, v.motors && `motors ${v.motors}`].filter(Boolean).join(', '); note(`${model}: the wiring didn't fully drive the outputs${got ? ` (${got})` : ''} — escalating to the next model.`); }
  }
  // offline / every model failed → deterministic synthesizer (never fails)
  note('No model produced a working circuit — falling back to the built-in synthesizer (offline-safe).');
  useStore.getState().clearCircuit();
  removeMountedParts();
  synthesizeCircuit(spec);
  mountByNetlist(spec);
  if (spec.isVehicle) assembleVehicle();
  const v = validateFunctional(spec);
  act('check_circuit', { model: 'synth (offline)' }, v);
  return { model: 'synth', via: 'synth', v };
}

async function runStructurePipeline(goal, pattern, providedSpec) {
  phase(`1/5 · Design spec — understanding the goal as a ${pattern}`);
  const spec = providedSpec || seedSpec(pattern, goal);
  if (!spec) { phase('No structural template — conducting step by step.'); return genericLoop(goal, S().orchestraHeadroom); }
  const inds = spec.electronics.filter((e) => e.function === 'indicator').length;
  const acts = spec.electronics.filter((e) => e.function === 'actuator').length;
  act('build_spec', { pattern }, { bodies: spec.bodies.length, indicators: inds, motors: acts, vehicle: !!spec.isVehicle });
  await sleep(150);
  if (stopped()) return;

  phase('2/5 · Geometry — deterministic bodies (no moving parts intersect)');
  const comp = composeGeometry(spec); // panel-mount holes + rigid attachment; geometry only
  act('compose_geometry', {}, { bodies: comp.bodies, cutouts: comp.cutouts });
  await sleep(250);

  phase('3/5 · Electronics — the circuit AI wires it (auto-escalating models until it works)');
  const built = await buildCircuitWithEscalation(spec);
  if (stopped()) return;
  if (built) act('wired_by', { model: built.model, via: built.via }, built.v);
  await sleep(150);

  phase('4/6 · Structural check — mass, stability, support, interference (auto-fix loop)');
  let s2 = validateStructure(), totalFixed = 0;
  for (let i = 0; i < 4; i++) {
    const structuralOk = s2.stable && !s2.issues.some((x) => ['support', 'interference', 'ground'].includes(x.type));
    if (structuralOk) break;
    const fx = applyStructureFixes(s2.issues) + applyGeometryFixes(validateGeometry(spec.isVehicle ? 'car' : 'generic'));
    totalFixed += fx;
    s2 = validateStructure();
    if (!fx) break;
  }
  act('validate_structure', {}, { mass_g: s2.mass, com: s2.com, stable: s2.stable, autofixed: totalFixed, issues: s2.issues.map((i) => i.msg) });
  const lookQ = spec.isVehicle
    ? `Is this a ${pattern} with the wheels lying flat on the ground at the corners and the sensor/parts mounted on the body? List any problem.`
    : `Is this a ${pattern} with its electronics mounted on the structure (LEDs/sensor on the outside) — a real ${pattern}, not a lamp? List any problem.`;
  await lookGate('design', lookQ);
  if (stopped()) return;

  phase('5/6 · Manufacturing & integration — printability, fit, mounting, BOM');
  const integ = validateIntegration(spec);
  act('validate_integration', {}, { issues: integ.issues.map((i) => i.msg) });
  const mfg = validateManufacture(spec);
  S().orchestraAddStep({ kind: 'action', tool: 'validate_manufacture', args: {}, ok: mfg.issues.length === 0, result: { ...mfg.report, issues: mfg.issues.map((i) => i.msg) } });
  if (stopped()) return;

  phase('6/6 · Electrical & result');
  const ind = indicatorReport();
  const hasInd = ind.total > 0;
  if (hasInd) act('check_indicators', { controlEngaged: true }, ind);
  const mr = motorReport();
  const hasMotors = mr.motors.length > 0;
  if (hasMotors) act('check_motors', { controlEngaged: true }, mr);

  // WATCH IT RUN — drive the inputs and play the Life Sim in the stage so the
  // user sees the wheels turn / LEDs light, not just a log line.
  if (hasMotors || hasInd) {
    phase('Test — watch it run in the Life Sim');
    const joy = S().nodes.find((n) => n.partId === 'joystick'); if (joy) S().setInput(joy.id, { x: 0.5, y: 1 });
    const btn = S().nodes.find((n) => n.partId === 'push-button'); if (btn) S().setInput(btn.id, true);
    S().setOrchestraView('sim'); S().setLifeSimRunning(true); if (!S().simOn) S().toggleSim();
    await sleep(2200);
    S().setLifeSimRunning(false); S().setOrchestraView('build');
  }

  const electricalOk = (hasInd ? ind.lit === ind.total : true) && (hasMotors ? mr.anyActive : true);
  const structuralOk = s2.stable && !s2.issues.some((i) => ['support', 'interference', 'ground'].includes(i.type));
  const integrationOk = integ.issues.length === 0;
  const manufacturable = mfg.issues.length === 0;
  const conf = conforms(goal); // does it actually contain what the goal asked for?
  const ok = electricalOk && structuralOk && integrationOk && manufacturable && conf.ok;
  const problems = [
    hasInd && ind.lit !== ind.total && `${ind.lit}/${ind.total} LEDs lit`,
    hasMotors && !mr.anyActive && 'motors don\'t run',
    !structuralOk && 'structural issues',
    !integrationOk && 'mounting issues',
    !manufacturable && 'not printable as-is',
    !conf.ok && `missing ${conf.missing.join(', ')}`,
  ].filter(Boolean);
  const fn = [
    hasInd && `${ind.lit}/${ind.total} LEDs`,
    hasMotors && `${mr.motors.filter((m) => m.active).length}/${mr.motors.length} motors`,
  ].filter(Boolean).join(' + ');
  S().orchestraAddStep({
    kind: 'action', tool: 'done', args: {}, ok: true,
    result: {
      summary: ok
        ? `Built a manufacturable ${pattern}: ${comp.bodies} bodies with ${comp.cutouts} real CSG openings${fn ? `, and the control drives ${fn} (sim-verified)` : ''}, mass ~${s2.mass} g with the COM over the support footprint (stable), prints on a ${mfg.report.envelope_mm.join('×')} mm envelope${mfg.report.fitsBed ? '' : ' (split for the bed)'} — BOM ${mfg.report.bom.parts} parts, ~$${mfg.report.bom.total_usd}.`
        : `Built a ${pattern} but flagged: ${problems.join('; ')}.`,
    },
  });
  S().orchestraSetStatus(ok ? 'done' : 'stopped');
}

export async function runOrchestra(goal) {
  const headroom = S().orchestraHeadroom || 'balanced';
  S().orchestraStart(goal);
  S().setTab('orchestra');
  const pattern = detectPattern(goal);

  // lamp keeps its small validated mechanical template
  if (pattern === 'lamp') {
    phase('Plan — recognised a "lamp". Engineering pipeline: model → circuit → firmware → test.');
    try { await runPipeline(goal, pattern); }
    catch (e) { fail(`Pipeline error: ${String(e?.message || e)}`); S().orchestraSetStatus('error'); }
    return;
  }
  // cars, robots, houses and enclosures run the Design-Spec pipeline directly —
  // the exact path the acceptance tests prove.
  if (['car', 'robot', 'house', 'enclosure'].includes(pattern)) {
    phase(`Plan — recognised a "${pattern}". Design-spec pipeline: spec → geometry → circuit AI → validate → iterate.`);
    try { await runStructurePipeline(goal, pattern); }
    catch (e) { fail(`Pipeline error: ${String(e?.message || e)}`); S().orchestraSetStatus('error'); }
    return;
  }
  // novel goal: AUTONOMOUS design loop — the model drafts a spec; if it doesn't
  // fully validate OR doesn't actually contain what the goal asked for, Orchestra
  // re-asks the model with the exact failures and retries, then falls back to the
  // step-by-step loop. It never reports DONE on a design that isn't correct.
  phase('Plan — novel goal. Drafting an engineering spec (re-asking on any failure)…');
  let spec = await generateSpec(goal), tries = 0;
  while (spec && tries < 2) {
    if (stopped()) return;
    try { await runStructurePipeline(goal, spec.productType || 'custom', spec); }
    catch (e) { fail(`Pipeline error: ${String(e?.message || e)}`); S().orchestraSetStatus('error'); return; }
    if (S().orchestraStatus === 'done') return; // fully valid AND conformant
    const c = conforms(goal);
    const deficiencies = [collectDeficiencies(validateAll(spec)), c.missing.length ? 'missing: ' + c.missing.join(', ') : ''].filter(Boolean).join(' | ');
    note(`The design didn't fully pass (${deficiencies}). Re-asking the model to correct the spec.`);
    spec = await generateSpec(goal, deficiencies);
    tries++;
  }
  // guaranteed-correct deterministic fallback: the universal requirement-driven
  // builder (parses the goal → enclosure/chassis that mounts what it asks for).
  note('Using the deterministic generic builder to guarantee a correct, conformant design.');
  try { await runStructurePipeline(goal, 'generic'); }
  catch (e) { fail(`Pipeline error: ${String(e?.message || e)}`); S().orchestraSetStatus('error'); }
}

export function stopOrchestra() {
  const s = useStore.getState();
  if (s.orchestraStatus === 'running') s.orchestraSetStatus('stopped');
}
