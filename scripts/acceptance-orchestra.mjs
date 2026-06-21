// ============================================================================
// Orchestra ENGINEERING ACCEPTANCE TESTS — objective, reproducible proof that
// the core (SPEC → COMPOSE → VALIDATE → ITERATE) produces correct, functional,
// manufacturable designs. No UI, no models, no screenshots: just hard assertions
// an engineer would check. Run:  node scripts/acceptance-orchestra.mjs
//
// Success criterion (the user's): "an engineer would review the result and not
// have to rebuild it from scratch." Each assertion encodes a slice of that.
// ============================================================================
import { useStore } from '../src/lib/store.js';
import { detectPattern, seedSpec } from '../src/lib/orchestraSpec.js';
import { composeDeterministic, validateAll, iterateToValid, resetScene, autonomousDesign, conforms } from '../src/lib/orchestraCore.js';

let pass = 0, fail = 0;
const failed = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failed.push(name); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? '  — ' + detail : ''}`); }
}
const meshes = () => useStore.getState().meshes;
const nodes = () => useStore.getState().nodes;
const HALF_PI = Math.PI / 2;
const flat = (r) => Math.abs(Math.abs(r[0]) - HALF_PI) < 0.3 || Math.abs(Math.abs(r[2]) - HALF_PI) < 0.3;

// ---------------------------------------------------------------- HOUSE -------
console.log('\n\x1b[1mHOUSE\x1b[0m — "a house with exterior LEDs controlled by a button"');
{
  resetScene();
  const goal = 'a house with exterior LEDs controlled by a button';
  ok('classified as a HOUSE (not a lamp / approximation)', detectPattern(goal) === 'house', detectPattern(goal));
  const spec = seedSpec('house', goal);
  const r = iterateToValid(spec);
  const ms = meshes();
  const walls = ms.filter((m) => m.role === 'wall');
  const roofs = ms.filter((m) => m.role === 'roof');
  const leds = nodes().filter((n) => n.partId === 'led-5mm');
  const btns = nodes().filter((n) => n.partId === 'push-button');
  ok('a house is still a house: ≥4 walls + a roof', walls.length >= 4 && roofs.length >= 1, `walls=${walls.length} roofs=${roofs.length}`);
  ok('has real CSG openings (door/windows)', ms.some((m) => m.role === 'cutout'));
  ok('exactly one button control', btns.length === 1, `btns=${btns.length}`);
  ok('≥2 LEDs, all mounted on EXTERIOR faces', leds.length >= 2 && r.report.integration.ok, r.report.integration.issues.join('; '));
  const [lit, tot] = r.report.electrical.leds.split('/');
  ok('ELECTRICAL: pressing the button lights every LED (sim)', lit === tot && Number(tot) >= 2, r.report.electrical.leds);
  ok('STRUCTURAL: stable, grounded, nothing floats or intersects', r.report.structural.ok, r.report.structural.issues.join('; '));
  ok('MANUFACTURING: printable + every panel part has a hole', r.report.dimensional.printable && r.report.dimensional.issues.length === 0, r.report.dimensional.issues.join('; '));
  ok('OVERALL design is valid', r.ok);
  console.log(`     → ${r.report.bom.parts} BOM parts ~$${r.report.bom.total_usd}, ${r.report.dimensional.envelope_mm.join('×')} mm, ${r.report.structural.mass_g} g, ${r.iterations} iteration(s)`);
}

// ----------------------------------------------------------------- CAR --------
console.log('\n\x1b[1mCAR\x1b[0m — "a car controlled by a joystick"');
{
  resetScene();
  const goal = 'a car controlled by a joystick';
  ok('classified as a CAR', detectPattern(goal) === 'car', detectPattern(goal));
  const spec = seedSpec('car', goal);
  const r = iterateToValid(spec);
  const ms = meshes();
  const chassis = ms.filter((m) => m.role === 'chassis');
  const wheels = ms.filter((m) => m.role === 'wheel');
  const motors = nodes().filter((n) => n.partId === 'dc-motor');
  const motorMeshIds = new Set(ms.filter((m) => m.kind === 'part' && m.partId === 'dc-motor').map((m) => m.id));
  ok('coherent chassis + exactly 4 wheels', chassis.length === 1 && wheels.length === 4, `chassis=${chassis.length} wheels=${wheels.length}`);
  ok('all 4 wheels lie FLAT (not upright pillars)', wheels.every((w) => flat(w.rotation)), wheels.map((w) => w.rotation.map((n) => +n.toFixed(2)).join(',')).join(' | '));
  ok('wheels do NOT intersect each other or the body', !r.report.structural.issues.some((m) => /intersect/.test(m)), r.report.structural.issues.join('; '));
  ok('motors correctly integrated: every wheel mounted on a motor', wheels.every((w) => motorMeshIds.has(w.attachedTo)), `attached=${wheels.filter((w) => motorMeshIds.has(w.attachedTo)).length}/4`);
  ok('ELECTRICAL: joystick drives the motors (sim)', r.report.electrical.motors !== 'n/a' && r.report.electrical.motors.split('/')[0] === r.report.electrical.motors.split('/')[1] && motors.length >= 2, r.report.electrical.motors);
  ok('STRUCTURAL: stable + grounded on its wheels', r.report.structural.ok, r.report.structural.issues.join('; '));
  ok('MANUFACTURING: printable', r.report.dimensional.printable, r.report.dimensional.issues.join('; '));
  ok('OVERALL design is valid', r.ok);
  console.log(`     → ${r.report.bom.parts} BOM parts ~$${r.report.bom.total_usd}, ${r.report.dimensional.envelope_mm.join('×')} mm, motors ${r.report.electrical.motors}, ${r.iterations} iteration(s)`);
}

// ------------------------------------------------------------ SUMO ROBOT ------
console.log('\n\x1b[1mSUMO ROBOT\x1b[0m — "a sumo robot with ultrasonic, 4 motors and an arduino"');
{
  resetScene();
  const goal = 'a sumo robot with ultrasonic, 4 motors and an arduino';
  const spec = seedSpec(detectPattern(goal), goal);
  const r = iterateToValid(spec);
  const ms = meshes();
  const wheels = ms.filter((m) => m.role === 'wheel');
  const motors = nodes().filter((n) => n.partId === 'dc-motor');
  const motorMeshIds = new Set(ms.filter((m) => m.kind === 'part' && m.partId === 'dc-motor').map((m) => m.id));
  ok('4 wheels, all lying flat', wheels.length === 4 && wheels.every((w) => flat(w.rotation)), `wheels=${wheels.length}`);
  ok('wheels do NOT intersect (moving parts have clearance)', !r.report.structural.issues.some((m) => /intersect/.test(m)), r.report.structural.issues.join('; '));
  ok('4 drive motors, every wheel mounted on a motor', motors.length === 4 && wheels.every((w) => motorMeshIds.has(w.attachedTo)), `motors=${motors.length}`);
  ok('ultrasonic sensor present and WIRED (TRIG+ECHO)', nodes().some((n) => n.partId === 'hcsr04') && hcsr04Wired(), 'hcsr04 not wired');
  ok('ELECTRICAL: all 4 motors run (sim)', r.report.electrical.motors === '4/4', r.report.electrical.motors);
  ok('STRUCTURAL: stable + grounded', r.report.structural.ok, r.report.structural.issues.join('; '));
  ok('OVERALL design is valid', r.ok);
  console.log(`     → ${r.report.bom.parts} BOM parts ~$${r.report.bom.total_usd}, ${r.report.dimensional.envelope_mm.join('×')} mm, motors ${r.report.electrical.motors}, ${r.iterations} iteration(s)`);
}
function hcsr04Wired() {
  const s = useStore.getState();
  const us = s.nodes.find((n) => n.partId === 'hcsr04');
  if (!us) return false;
  const pins = new Set();
  for (const w of s.wires) { if (w.from.node === us.id) pins.add(w.from.pin); if (w.to.node === us.id) pins.add(w.to.pin); }
  return pins.has('TRIG') && pins.has('ECHO');
}

// ---------------------------------------------------- ITERATION (self-repair) -
console.log('\n\x1b[1mITERATION\x1b[0m — a deliberately broken spec must be auto-repaired');
{
  const goal = 'a robot with 2 motors';
  const spec = seedSpec('robot', goal);
  // sabotage it: lift the whole build 60 mm off the floor, and stand a wheel upright
  for (const b of spec.bodies) b.pos_mm = [b.pos_mm[0], b.pos_mm[1] + 60, b.pos_mm[2]];
  for (const e of spec.electronics) e.pos_mm = [e.pos_mm[0], e.pos_mm[1] + 60, e.pos_mm[2]];
  spec.bodies.find((b) => b.role === 'wheel').rot = [0, 0, 0]; // wrong: upright

  resetScene();
  composeDeterministic(JSON.parse(JSON.stringify(spec)));
  const before = validateAll(spec);
  ok('the broken design FAILS validation first', !before.ok, 'it unexpectedly passed');

  resetScene();
  const r = iterateToValid(spec);
  ok('iteration REPAIRS it to a valid design', r.ok, r.report.structural.issues.concat(r.report.dimensional.issues).join('; '));
  ok('it actually iterated (>1 round)', r.iterations > 1, `iterations=${r.iterations}`);
  console.log(`     → repaired in ${r.iterations} iteration(s); final stable=${r.report.structural.ok}, motors ${r.report.electrical.motors}`);
}

// ----------------------------------------------- AUTONOMY (no human help) -----
console.log('\n\x1b[1mAUTONOMY\x1b[0m — "a sumo robot..." built from the GOAL ALONE, even if the model fails');
{
  const goal = 'a sumo robot with ultrasonic, 4 motors and an arduino';
  // a useless model that returns garbage every round — the system must STILL deliver
  const badModel = () => ({ productType: 'thing', bodies: [{ id: 'b', shape: 'box', dims_mm: { w: 6, h: 6, d: 6 }, pos_mm: [0, 150, 0] }], electronics: [], behavior: [] });
  const res = autonomousDesign(goal, { specProvider: badModel, max: 2 });
  const wheels = useStore.getState().meshes.filter((m) => m.role === 'wheel').length;
  const motors = useStore.getState().nodes.filter((n) => n.partId === 'dc-motor').length;
  const ultra = useStore.getState().nodes.some((n) => n.partId === 'hcsr04');
  ok('delivers a VALID, conformant design even when the model fails', res.ok && conforms(goal).ok, `source=${res.source} missing=${conforms(goal).missing.join(',')}`);
  ok('it really is a sumo robot: 4 wheels + 4 motors + ultrasonic', wheels === 4 && motors === 4 && ultra, `wheels=${wheels} motors=${motors} ultra=${ultra}`);
  ok('its 4 motors run and it is stable (sim)', res.report.electrical.motors === '4/4' && res.report.structural.ok, res.report.electrical.motors);
  console.log(`     → built the sumo robot BY ITSELF via the "${res.source}" path`);

  // a capable model (returns a correct spec) is used directly — proves the model path
  const goodModel = () => seedSpec('robot', goal);
  const res2 = autonomousDesign(goal, { specProvider: goodModel, max: 2 });
  ok('a capable model is accepted directly (source=model)', res2.ok && res2.source === 'model', `source=${res2.source}`);
}

// ------------------------------------------------- NOVEL (no named template) --
console.log('\n\x1b[1mNOVEL DEVICE\x1b[0m — a goal with NO named template still comes out correct & conformant');
{
  const goal = 'a desktop gadget with 3 LEDs, a button and a motion sensor';
  ok('truly novel (classified generic, no template)', detectPattern(goal) === 'generic', detectPattern(goal));
  const offlineModel = () => null; // model offline / refuses
  const res = autonomousDesign(goal, { specProvider: offlineModel, max: 1 });
  const leds = useStore.getState().nodes.filter((n) => n.partId === 'led-5mm').length;
  const hasBtn = useStore.getState().nodes.some((n) => n.partId === 'push-button');
  const hasPir = useStore.getState().nodes.some((n) => n.partId === 'pir');
  ok('still produces a VALID, conformant device by itself', res.ok && conforms(goal).ok, `missing=${conforms(goal).missing.join(',')}`);
  ok('has exactly the 3 LEDs + button + motion sensor asked for', leds === 3 && hasBtn && hasPir, `leds=${leds} btn=${hasBtn} pir=${hasPir}`);
  ok('button lights all LEDs (sim), stable + printable', res.report.electrical.leds === '3/3' && res.report.structural.ok && res.report.dimensional.printable, `${res.report.electrical.leds} stable=${res.report.structural.ok} printable=${res.report.dimensional.printable}`);
  console.log(`     → built the novel device by itself, ${res.report.bom.parts} BOM parts ~$${res.report.bom.total_usd}`);
}

// -------------------------------------------------------------- SUMMARY -------
console.log(`\n${'─'.repeat(60)}`);
console.log(`${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m`);
if (fail) { console.log('FAILED:\n  - ' + failed.join('\n  - ')); process.exit(1); }
console.log('\x1b[32mAll engineering acceptance tests passed.\x1b[0m');
