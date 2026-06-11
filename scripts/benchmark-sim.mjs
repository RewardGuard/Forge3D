// Benchmark: joystick controls 4 DC motors through two L298N drivers.
// Builds the exact circuit + the user's sketch, runs simulate(), and asserts
// motors respond to joystick deflection. Run: node scripts/benchmark-sim.mjs
import { simulate } from '../src/lib/simulate.js';
import { analyzeDrivenPins } from '../src/lib/codeSim.js';
import { parseAgentJson } from '../src/lib/agentJson.js';
import fs from 'node:fs';

const sketch = fs.readFileSync(new URL('../fixtures/joystick_4motors.ino', import.meta.url), 'utf-8');

// ---- circuit: mega + joystick + battery + 2x L298N + 4 motors ----
const nodes = [
  { id: 'n1', partId: 'arduino-mega', x: 0, y: 0 },
  { id: 'n2', partId: 'joystick', x: 0, y: 0 },
  { id: 'n3', partId: 'l298n', x: 0, y: 0 },
  { id: 'n4', partId: 'l298n', x: 0, y: 0 },
  { id: 'n5', partId: 'dc-motor', x: 0, y: 0 },
  { id: 'n6', partId: 'dc-motor', x: 0, y: 0 },
  { id: 'n7', partId: 'dc-motor', x: 0, y: 0 },
  { id: 'n8', partId: 'dc-motor', x: 0, y: 0 },
  { id: 'n9', partId: 'battery-9v', x: 0, y: 0 },
];
let wseq = 1;
const wires = [];
const wire = (an, ap, bn, bp) => wires.push({ id: 'w' + wseq++, from: { node: an, pin: ap }, to: { node: bn, pin: bp } });

// joystick to mega
wire('n2', 'VCC', 'n1', '5V');
wire('n2', 'GND', 'n1', 'GND1');
wire('n2', 'VRX', 'n1', 'A0');
wire('n2', 'VRY', 'n1', 'A1');
// mega outputs to driver INs
wire('n1', 'D2', 'n3', 'IN1');
wire('n1', 'D3', 'n3', 'IN2');
wire('n1', 'D4', 'n4', 'IN1');
wire('n1', 'D5', 'n4', 'IN2');
// battery powers both drivers
wire('n9', '+', 'n3', 'VCC');
wire('n9', '+', 'n4', 'VCC');
wire('n9', '-', 'n3', 'GND');
wire('n9', '-', 'n4', 'GND');
// motors across driver outputs (2 per driver, in parallel)
wire('n3', 'OUT1', 'n5', 'M+'); wire('n3', 'OUT2', 'n5', 'M-');
wire('n3', 'OUT1', 'n6', 'M+'); wire('n3', 'OUT2', 'n6', 'M-');
wire('n4', 'OUT1', 'n7', 'M+'); wire('n4', 'OUT2', 'n7', 'M-');
wire('n4', 'OUT1', 'n8', 'M+'); wire('n4', 'OUT2', 'n8', 'M-');

const codeByNode = { n1: sketch };

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const motorState = (sim, id) => sim.components.find((c) => c.nodeId === id);
const motorsActive = (sim) => ['n5', 'n6', 'n7', 'n8'].map((id) => motorState(sim, id)?.active);

console.log('— code analysis —');
const driven = analyzeDrivenPins('arduino-mega', sketch);
console.log('  driven pins:', JSON.stringify(driven));
for (const p of ['D2', 'D3', 'D4', 'D5']) {
  check(`${p} detected as output gated on joystick analog reads`, driven[p] && driven[p].gate && /A0|A1/.test(driven[p].gate), JSON.stringify(driven[p]));
}

console.log('— joystick centered: all motors must be idle —');
let sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: { n2: { x: 0.5, y: 0.5 } } });
check('no motor running', motorsActive(sim).every((a) => !a), JSON.stringify(motorsActive(sim)));

console.log('— joystick pushed forward (y=1): motors must run —');
sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: { n2: { x: 0.5, y: 1 } } });
check('all 4 motors running', motorsActive(sim).every(Boolean), JSON.stringify(motorsActive(sim)));

console.log('— joystick pushed right (x=1): motors must run —');
sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: { n2: { x: 1, y: 0.5 } } });
check('all 4 motors running', motorsActive(sim).every(Boolean), JSON.stringify(motorsActive(sim)));

console.log('— direction: joystick up = forward (+), down = reverse (−) —');
sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: { n2: { x: 0.5, y: 1 } } });
check('all motors spin + (fwd)', ['n5', 'n6', 'n7', 'n8'].every((id) => motorState(sim, id)?.dir === 1),
  JSON.stringify(['n5', 'n6', 'n7', 'n8'].map((id) => motorState(sim, id)?.dir)));
sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: { n2: { x: 0.5, y: 0 } } });
check('all motors spin − (rev)', ['n5', 'n6', 'n7', 'n8'].every((id) => motorState(sim, id)?.dir === -1),
  JSON.stringify(['n5', 'n6', 'n7', 'n8'].map((id) => motorState(sim, id)?.dir)));
check('reverse note says so', /rev|−/.test(motorState(sim, 'n5')?.note || ''), motorState(sim, 'n5')?.note);

console.log('— no input state at all (defaults): motors idle —');
sim = simulate(nodes, wires, { codeByNode, blinkPhase: true, inputs: {} });
check('no motor running', motorsActive(sim).every((a) => !a), JSON.stringify(motorsActive(sim)));

console.log('— sanity: no shorts, battery counted as source —');
check('no short-circuit warnings', !sim.warnings.some((w) => /short/i.test(w)), sim.warnings.join('; '));
check('has power source', sim.totals.sourceCount > 0);

console.log('— perf: 500 simulate() calls (budget scaled to machine load) —');
// calibrate against current machine speed so background load (Spotlight, builds)
// doesn't produce false failures
let calib = performance.now(); let _x = 0;
for (let i = 0; i < 1e6; i++) _x += i % 7;
calib = performance.now() - calib; // ~2-3ms idle on Apple Silicon
const budget = Math.max(5, calib * 2.5);
const t0 = performance.now();
for (let i = 0; i < 500; i++) simulate(nodes, wires, { codeByNode, blinkPhase: i % 2 === 0, inputs: { n2: { x: 1, y: 0.5 } } });
const ms = (performance.now() - t0) / 500;
check(`avg ${ms.toFixed(2)}ms per tick (< ${budget.toFixed(1)}ms budget)`, ms < budget);

console.log('— wrong sketch loaded (blink instead of joystick code): warn + idle —');
const blink = 'void setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}';
sim = simulate(nodes, wires, { codeByNode: { n1: blink }, blinkPhase: true, inputs: { n2: { x: 1, y: 1 } } });
check('motors stay idle (code never drives D2-D5)', motorsActive(sim).every((a) => !a), JSON.stringify(motorsActive(sim)));
check('warning says code never uses wired pins', sim.warnings.some((w) => /never uses ANY wired pin/.test(w)), sim.warnings.join(' | '));
sim = simulate(nodes, wires, { codeByNode: {}, blinkPhase: true, inputs: {} });
check('warning when board has no code at all', sim.warnings.some((w) => /no code/.test(w)), sim.warnings.join(' | '));

console.log('— agent JSON parser: tolerant of fences, prose, truncation —');
const goodObj = { summary: 'ok', actions: [{ op: 'addWire', from: 'n1.D2', to: 'n3.IN1' }] };
const good = JSON.stringify(goodObj);
check('plain JSON', parseAgentJson(good)?.actions?.length === 1);
check('markdown-fenced JSON', parseAgentJson('```json\n' + good + '\n```')?.actions?.length === 1);
check('prose around JSON', parseAgentJson('Sure! Here is the plan:\n' + good + '\nHope that helps.')?.actions?.length === 1);
const truncated = good.slice(0, good.indexOf(']') - 1); // cut mid-array (how max_tokens kills it)
check('truncated JSON repaired', parseAgentJson(truncated)?.actions?.length >= 1, JSON.stringify(parseAgentJson(truncated)));
check('pure prose -> null (graceful fallback)', parseAgentJson('I cannot do that, sorry.') === null);
const braceInString = '{"summary":"use { and } carefully","actions":[]}';
check('braces inside strings handled', parseAgentJson('note:\n' + braceInString)?.summary?.includes('carefully'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
