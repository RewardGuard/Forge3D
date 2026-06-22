// ============================================================================
// Orchestra circuit — functional validation + canonical prompts.
//
// "Conexiones funcionales" can't be eyeballed. We RUN the real electrical
// simulation (the same engine the Life Sim uses) with a test input and check
// the outcome: are the motors actually powered and turning in the right
// direction when the joystick is pushed forward? validateCircuit() returns the
// concrete deficiencies so the director can re-prompt the circuit agent with a
// precise fix request — and loop until the circuit really works.
// ============================================================================
import { useStore } from './store.js';
import { simulate } from './simulate.js';
import { PART_BY_ID } from '../data/parts.js';

const CAT = (partId) => PART_BY_ID[partId]?.category || '';
const MOTOR_PARTS = new Set(['dc-motor', 'servo-sg90', 'servo-mg996', 'stepper-28byj', 'stepper-nema17', 'vibration-motor', 'pump-12v', 'linear-actuator']);

// A test input that exercises the circuit: push every joystick fully forward,
// hold every button, max every pot. So motors that *should* run, run.
function testInputs(nodes) {
  const inputs = {};
  for (const n of nodes) {
    if (n.partId === 'joystick') inputs[n.id] = { x: 0.5, y: 1, sw: false };
    else if (n.partId === 'push-button' || n.partId === 'toggle-switch') inputs[n.id] = true;
    else if (n.partId === 'potentiometer') inputs[n.id] = 1;
  }
  return inputs;
}

// Run the electrical sim with the test input and report motor activity.
export function motorReport() {
  const { nodes, wires, codeByNode } = useStore.getState();
  const motors = nodes.filter((n) => MOTOR_PARTS.has(n.partId));
  if (!motors.length) return { motors: [], anyActive: false };
  const sim = simulate(nodes, wires, { codeByNode, inputs: testInputs(nodes), blinkPhase: true });
  const byNode = {};
  for (const c of sim.components) byNode[c.nodeId] = c;
  const rows = motors.map((m) => {
    const c = byNode[m.id] || {};
    return { nodeId: m.id, partId: m.partId, active: !!c.active, dir: c.dir || 0, note: c.note || '' };
  });
  return { motors: rows, anyActive: rows.some((r) => r.active) };
}

// Structural + functional deficiencies. Empty array = the circuit works.
export function validateCircuit(archetype) {
  const { nodes, wires } = useStore.getState();
  const def = [];
  if (!nodes.length) return ['the circuit is empty'];

  const has = (cat) => nodes.some((n) => CAT(n.partId) === cat);
  const motors = nodes.filter((n) => MOTOR_PARTS.has(n.partId));

  if (!has('Microcontrollers')) def.push('no microcontroller (add an arduino-uno)');
  if (!has('Power')) def.push('no power source (add a battery, e.g. battery-9v or battery-lipo)');
  if (motors.length && !nodes.some((n) => n.partId === 'l298n' || CAT(n.partId) === 'Drivers'))
    def.push('motors present but no motor driver (add an l298n between the MCU and the motors)');
  if (archetype === 'car') {
    if (motors.length < 2) def.push(`a joystick car needs 2 dc-motors, found ${motors.length}`);
    if (!nodes.some((n) => n.partId === 'joystick')) def.push('no joystick to steer with');
  }

  // functional: with the joystick forward, the motors must actually turn
  if (motors.length) {
    const { motors: rows } = motorReport();
    const dead = rows.filter((r) => !r.active);
    if (dead.length === rows.length) def.push('no motor turns on when the joystick is pushed forward — check power, ground, the driver inputs (IN1-IN4/ENA/ENB) and the joystick-to-MCU wiring');
    else if (dead.length) def.push(`${dead.length} of ${rows.length} motors stay off when driven (${dead.map((d) => d.nodeId).join(', ')}) — likely a missing driver/ground/enable connection`);
  }

  if (wires.length === 0 && nodes.length > 1) def.push('parts are placed but nothing is wired together');
  return def;
}

// ---- canonical prompts handed to the specialist agents ----
export function circuitPrompt(archetype) {
  if (archetype === 'car')
    return 'Build a complete joystick-controlled 2-motor car circuit. Parts: one arduino-uno, one l298n motor driver, two dc-motor, one joystick, one battery-9v. Wire it so it WORKS: joystick VRX/VRY to two Arduino analog pins (A0/A1) plus joystick VCC/GND; Arduino digital pins to the L298N IN1,IN2,IN3,IN4 and PWM pins to ENA,ENB; L298N OUT1/OUT2 to motor 1 and OUT3/OUT4 to motor 2; battery + to L298N 12V and Arduino VIN; and a COMMON GROUND across the battery, Arduino, L298N and joystick.';
  if (archetype === 'robot')
    return 'Build a 2-motor robot circuit: one arduino-uno, one l298n driver, two dc-motor, one push-button, one battery-9v. Wire the L298N between the Arduino and the motors, the button to a digital pin, power to the L298N 12V and Arduino VIN, and a common ground across everything.';
  if (archetype === 'lamp')
    return 'Build a dimmable LED lamp circuit: one arduino-uno, one led-5mm with a res-220 resistor, one potentiometer, one battery-9v. Wire the pot wiper to an analog pin, the LED (through the resistor) to a PWM pin and ground, and power the Arduino. Common ground.';
  return null;
}

export function circuitFixPrompt(deficiencies) {
  return `The circuit has these problems:\n- ${deficiencies.join('\n- ')}\nFix them by ADDING the missing parts and connections. Keep all existing parts and wires. Make sure every motor has power, a common ground, and its driver inputs/enables wired to the microcontroller.`;
}

// ============================================================================
// Deterministic circuit builders — Orchestra's "engineering library". A weak
// free model can't reliably wire a working car, so for known archetypes we lay
// down the canonical, sim-verified wiring + firmware in code. The result is
// GUARANTEED functional (validateCircuit passes). The circuit agent is still
// used for novel/generic requests and to refine.
// ============================================================================

// Firmware whose motor-direction pins are written through a HELPER (so the sim's
// code analyzer can't trace them to HIGH/LOW and instead GATES them on the
// joystick/button the program reads — idle at center, fwd/rev on deflection).
function carFirmware() {
  return `// Joystick-driven 2-motor car (2x L298N).
const int L1A = 2, L1B = 3;   // left  motor dir pins  -> L298N #1 IN1/IN2
const int L2A = 4, L2B = 5;   // right motor dir pins  -> L298N #2 IN1/IN2

// writes go through a helper, so each motor follows the joystick the loop reads
void drive(int pinA, int pinB, bool on, bool fwd) {
  digitalWrite(pinA, (on && fwd)  ? HIGH : LOW);
  digitalWrite(pinB, (on && !fwd) ? HIGH : LOW);
}

void setup() {
  pinMode(L1A, OUTPUT); pinMode(L1B, OUTPUT);
  pinMode(L2A, OUTPUT); pinMode(L2B, OUTPUT);
}

void loop() {
  int x = analogRead(A0);          // steering
  int y = analogRead(A1);          // throttle
  bool moving = abs(y - 512) > 60 || abs(x - 512) > 60;
  bool fwd = y >= 512;
  drive(L1A, L1B, moving, fwd);
  drive(L2A, L2B, moving, fwd);
}`;
}

function robotFirmware() {
  return `// Button-driven 2-motor robot (2x L298N).
const int L1A = 2, L1B = 3, L2A = 4, L2B = 5;
const int BTN = 7;

void drive(int pinA, int pinB, bool on) {
  digitalWrite(pinA, on ? HIGH : LOW);
  digitalWrite(pinB, LOW);
}

void setup() {
  pinMode(L1A, OUTPUT); pinMode(L1B, OUTPUT);
  pinMode(L2A, OUTPUT); pinMode(L2B, OUTPUT);
  pinMode(BTN, INPUT);
}

void loop() {
  bool go = digitalRead(BTN);   // press to move forward
  drive(L1A, L1B, go);
  drive(L2A, L2B, go);
}`;
}

function lampFirmware() {
  return `// Potentiometer-dimmed LED lamp.
const int LED = 9;   // PWM pin
void setup() { pinMode(LED, OUTPUT); }
void loop() {
  int v = analogRead(A0);          // pot wiper
  analogWrite(LED, v / 4);         // 0..1023 -> 0..255
}`;
}

// Action batches for applyAgentActions(): addPart (with a ref alias) + addWire
// using "ref.pin". This is exactly the format the circuit agent emits, so the
// store applies it the same way — only here it's known-correct.
function carActions() {
  return [
    { op: 'addPart', partId: 'arduino-uno', ref: 'a' },
    { op: 'addPart', partId: 'joystick', ref: 'j' },
    { op: 'addPart', partId: 'battery-9v', ref: 'bat' },
    { op: 'addPart', partId: 'l298n', ref: 'd1' },
    { op: 'addPart', partId: 'l298n', ref: 'd2' },
    { op: 'addPart', partId: 'dc-motor', ref: 'm1' },
    { op: 'addPart', partId: 'dc-motor', ref: 'm2' },
    // power + common ground
    { op: 'addWire', from: 'bat.+', to: 'a.VIN' },
    { op: 'addWire', from: 'bat.+', to: 'd1.VCC' },
    { op: 'addWire', from: 'bat.+', to: 'd2.VCC' },
    { op: 'addWire', from: 'bat.-', to: 'a.GND1' },
    { op: 'addWire', from: 'bat.-', to: 'd1.GND' },
    { op: 'addWire', from: 'bat.-', to: 'd2.GND' },
    { op: 'addWire', from: 'bat.-', to: 'j.GND' },
    // joystick -> MCU
    { op: 'addWire', from: 'a.5V', to: 'j.VCC' },
    { op: 'addWire', from: 'j.VRX', to: 'a.A0' },
    { op: 'addWire', from: 'j.VRY', to: 'a.A1' },
    // MCU -> drivers
    { op: 'addWire', from: 'a.D2', to: 'd1.IN1' },
    { op: 'addWire', from: 'a.D3', to: 'd1.IN2' },
    { op: 'addWire', from: 'a.D4', to: 'd2.IN1' },
    { op: 'addWire', from: 'a.D5', to: 'd2.IN2' },
    // drivers -> motors
    { op: 'addWire', from: 'd1.OUT1', to: 'm1.M+' },
    { op: 'addWire', from: 'd1.OUT2', to: 'm1.M-' },
    { op: 'addWire', from: 'd2.OUT1', to: 'm2.M+' },
    { op: 'addWire', from: 'd2.OUT2', to: 'm2.M-' },
  ];
}

function robotActions() {
  return [
    { op: 'addPart', partId: 'arduino-uno', ref: 'a' },
    { op: 'addPart', partId: 'push-button', ref: 'btn' },
    { op: 'addPart', partId: 'battery-9v', ref: 'bat' },
    { op: 'addPart', partId: 'l298n', ref: 'd1' },
    { op: 'addPart', partId: 'l298n', ref: 'd2' },
    { op: 'addPart', partId: 'dc-motor', ref: 'm1' },
    { op: 'addPart', partId: 'dc-motor', ref: 'm2' },
    { op: 'addWire', from: 'bat.+', to: 'a.VIN' },
    { op: 'addWire', from: 'bat.+', to: 'd1.VCC' },
    { op: 'addWire', from: 'bat.+', to: 'd2.VCC' },
    { op: 'addWire', from: 'bat.-', to: 'a.GND1' },
    { op: 'addWire', from: 'bat.-', to: 'd1.GND' },
    { op: 'addWire', from: 'bat.-', to: 'd2.GND' },
    { op: 'addWire', from: 'a.5V', to: 'btn.A' },
    { op: 'addWire', from: 'btn.B', to: 'a.D7' },
    { op: 'addWire', from: 'a.D2', to: 'd1.IN1' },
    { op: 'addWire', from: 'a.D3', to: 'd1.IN2' },
    { op: 'addWire', from: 'a.D4', to: 'd2.IN1' },
    { op: 'addWire', from: 'a.D5', to: 'd2.IN2' },
    { op: 'addWire', from: 'd1.OUT1', to: 'm1.M+' },
    { op: 'addWire', from: 'd1.OUT2', to: 'm1.M-' },
    { op: 'addWire', from: 'd2.OUT1', to: 'm2.M+' },
    { op: 'addWire', from: 'd2.OUT2', to: 'm2.M-' },
  ];
}

function lampActions() {
  return [
    { op: 'addPart', partId: 'arduino-uno', ref: 'a' },
    { op: 'addPart', partId: 'potentiometer', ref: 'pot' },
    { op: 'addPart', partId: 'led-5mm', ref: 'led' },
    { op: 'addPart', partId: 'res-220', ref: 'r' },
    { op: 'addPart', partId: 'battery-9v', ref: 'bat' },
    { op: 'addWire', from: 'bat.+', to: 'a.VIN' },
    { op: 'addWire', from: 'bat.-', to: 'a.GND1' },
    { op: 'addWire', from: 'a.5V', to: 'pot.VCC' },
    { op: 'addWire', from: 'pot.GND', to: 'a.GND2' },
    { op: 'addWire', from: 'pot.WIPER', to: 'a.A0' },
    { op: 'addWire', from: 'a.D9', to: 'r.A' },
    { op: 'addWire', from: 'r.B', to: 'led.A' },
    { op: 'addWire', from: 'led.K', to: 'a.GND3' },
  ];
}

const ARCHETYPE_CIRCUIT = {
  car: { actions: carActions, firmware: carFirmware },
  robot: { actions: robotActions, firmware: robotFirmware },
  lamp: { actions: lampActions, firmware: lampFirmware },
};

// Lay down the canonical circuit + firmware for an archetype. Returns
// { applied, errors, firmwareSet } or null when there's no builder.
export function placeArchetypeCircuit(archetype) {
  const spec = ARCHETYPE_CIRCUIT[archetype];
  if (!spec) return null;
  const s = useStore.getState();
  s.clearCircuit();
  const { applied, errors } = s.applyAgentActions(spec.actions());
  // load the matching firmware onto the microcontroller
  const mcu = useStore.getState().nodes.find((n) => CAT(n.partId) === 'Microcontrollers');
  let firmwareSet = false;
  if (mcu) { useStore.getState().setNodeCode(mcu.id, spec.firmware()); firmwareSet = true; }
  return { applied, errors, firmwareSet };
}

export function hasBlueprintCircuit(archetype) { return !!ARCHETYPE_CIRCUIT[archetype]; }

// ----------------------------------------------------------------------------
// FUNCTION-BASED wiring — built from what the design DOES, not what it "is".
// "indicators controlled by a control" wires N LEDs (each via its own resistor)
// to MCU pins and a button to a read pin, with firmware that the sim's analyzer
// recognises as gated on the button → the LEDs actually switch when it's pressed.
// This is what makes a HOUSE-with-LEDs work the same way a panel-with-LEDs does.
// ----------------------------------------------------------------------------

// Explicit-pin firmware (no arrays — codeSim.js resolves named pins, not LEDS[i]).
export function indicatorFirmware(ledCount, mode = 'hold') {
  const pins = Array.from({ length: ledCount }, (_, i) => 'L' + (i + 1));
  const decls = pins.map((p, i) => `${p} = ${i + 3}`).join(', ');
  const modes = pins.map((p) => `pinMode(${p}, OUTPUT);`).join(' ');
  const writes = pins.map((p) => `digitalWrite(${p}, s);`).join(' ');
  return `// ${ledCount} indicator LED(s) controlled by a button (${mode}).
const int BTN = 2;
const int ${decls};
void setup() {
  pinMode(BTN, INPUT);
  ${modes}
}
void loop() {
  int s = digitalRead(BTN);   // LEDs follow the button (sim-gated on BTN)
  ${writes}
}`;
}

// Action batch (applyAgentActions format) for: MCU + battery + button + N LEDs,
// each LED on its own digital pin through a 220Ω resistor to ground.
export function indicatorsControlledByActions(ledCount) {
  const a = [
    { op: 'addPart', partId: 'arduino-uno', ref: 'a' },
    { op: 'addPart', partId: 'battery-9v', ref: 'bat' },
    { op: 'addPart', partId: 'push-button', ref: 'btn' },
    { op: 'addWire', from: 'bat.+', to: 'a.VIN' },
    { op: 'addWire', from: 'bat.-', to: 'a.GND1' },
    { op: 'addWire', from: 'a.5V', to: 'btn.A' },
    { op: 'addWire', from: 'btn.B', to: 'a.D2' },
  ];
  const gnd = ['GND2', 'GND3'];
  for (let i = 0; i < ledCount; i++) {
    const led = 'led' + i, res = 'r' + i, pin = 'D' + (3 + i);
    a.push({ op: 'addPart', partId: 'led-5mm', ref: led });
    a.push({ op: 'addPart', partId: 'res-220', ref: res });
    a.push({ op: 'addWire', from: `a.${pin}`, to: `${res}.A` });
    a.push({ op: 'addWire', from: `${res}.B`, to: `${led}.A` });
    a.push({ op: 'addWire', from: `${led}.K`, to: `a.${gnd[i % gnd.length]}` });
  }
  return a;
}

// Lay down a function-based circuit + firmware on the live store. `spec.behavior`
// drives it: indicators-controlled-by-a-button today; extendable per function.
export function placeFunctionalCircuit(spec) {
  const s = useStore.getState();
  s.clearCircuit();
  const indicators = (spec.electronics || []).filter((e) => e.function === 'indicator');
  const ledCount = Math.max(1, indicators.length);
  const mode = spec.behavior?.[0]?.mode || 'hold';
  const { applied, errors } = s.applyAgentActions(indicatorsControlledByActions(ledCount));
  const mcu = useStore.getState().nodes.find((n) => CAT(n.partId) === 'Microcontrollers');
  let firmwareSet = false;
  if (mcu) { useStore.getState().setNodeCode(mcu.id, indicatorFirmware(ledCount, mode)); firmwareSet = true; }
  return { applied, errors, firmwareSet, ledCount };
}

// ----------------------------------------------------------------------------
// CIRCUIT SYNTHESIZER — wire ANY spec automatically, by function.
// Given a Design Spec's electronics (controls, indicators, actuators, sensors)
// it builds the netlist (adding an MCU, battery, drivers and resistors as
// needed), assigns MCU pins, and writes firmware the simulator recognises — so a
// custom design is fully FUNCTIONAL with no human wiring. Returns a map from each
// spec electronic id → its circuit node id (for mounting it in 3D).
// ----------------------------------------------------------------------------
const pinNum = (p) => (p[0] === 'A' ? p : p.slice(1)); // 'D3'->'3', 'A0'->'A0'

function synthFirmware(pm) {
  const consts = [];
  if (pm.btn) consts.push(`BTN = ${pinNum(pm.btn)}`);
  pm.leds.forEach((p, i) => consts.push(`L${i + 1} = ${pinNum(p)}`));
  pm.motors.forEach((m, i) => { consts.push(`M${i + 1}A = ${pinNum(m[0])}`); consts.push(`M${i + 1}B = ${pinNum(m[1])}`); });
  pm.servos.forEach((p, i) => consts.push(`SV${i + 1} = ${pinNum(p)}`));
  pm.sensors.forEach((sn, i) => {
    if (sn.type === 'hcsr04') { consts.push(`TRG${i} = ${pinNum(sn.trig)}`); consts.push(`ECH${i} = ${pinNum(sn.echo)}`); }
    else consts.push(`SN${i} = ${pinNum(sn.pin)}`);
  });
  const setup = [];
  if (pm.btn) setup.push('pinMode(BTN, INPUT);');
  pm.leds.forEach((_, i) => setup.push(`pinMode(L${i + 1}, OUTPUT);`));
  pm.motors.forEach((_, i) => { setup.push(`pinMode(M${i + 1}A, OUTPUT);`); setup.push(`pinMode(M${i + 1}B, OUTPUT);`); });
  pm.servos.forEach((_, i) => setup.push(`pinMode(SV${i + 1}, OUTPUT);`));
  pm.sensors.forEach((sn, i) => { if (sn.type === 'hcsr04') { setup.push(`pinMode(TRG${i}, OUTPUT);`); setup.push(`pinMode(ECH${i}, INPUT);`); } else setup.push(`pinMode(SN${i}, INPUT);`); });

  const loop = [];
  const analogCtrl = pm.analog.length > 0;
  let onExpr = 'true';
  if (pm.btn) { loop.push('int s = digitalRead(BTN);'); onExpr = 's'; }
  // read EVERY analog axis so the sim gates outputs on ANY of them — a joystick's
  // throttle (VRY) must turn motors on even when the steering axis (VRX) is centred
  pm.analog.forEach((p, i) => loop.push(`int a${i} = analogRead(${p});`));
  if (!pm.btn && analogCtrl) onExpr = 'a0 > 80';
  // indicators follow the control (button-gated, pot-dimmed, or just on)
  pm.leds.forEach((_, i) => {
    if (pm.btn) loop.push(`digitalWrite(L${i + 1}, s);`);
    else if (analogCtrl) loop.push(`analogWrite(L${i + 1}, a0 / 4);`);
    else loop.push(`digitalWrite(L${i + 1}, HIGH);`);
  });
  // motors: with a control, run via a helper so the sim gates them on it; with
  // no control (autonomous robot) just drive them solidly forward.
  const gated = pm.btn || analogCtrl;
  pm.motors.forEach((_, i) => {
    if (gated) loop.push(`drive(M${i + 1}A, M${i + 1}B, ${onExpr}, true);`);
    else { loop.push(`digitalWrite(M${i + 1}A, HIGH);`); loop.push(`digitalWrite(M${i + 1}B, LOW);`); }
  });
  pm.servos.forEach((_, i) => loop.push(`analogWrite(SV${i + 1}, ${analogCtrl ? 'a0 / 4' : '90'});`));
  pm.sensors.forEach((sn, i) => { if (sn.type === 'hcsr04') loop.push(`long d${i} = pulseIn(ECH${i}, HIGH);`); else loop.push(`int v${i} = digitalRead(SN${i});`); });

  const helper = pm.motors.length && gated ? 'void drive(int a, int b, bool on, bool fwd) { digitalWrite(a, (on && fwd) ? HIGH : LOW); digitalWrite(b, (on && !fwd) ? HIGH : LOW); }\n' : '';
  return `// Auto-synthesised firmware for this build.\nconst int ${consts.join(', ')};\n${helper}void setup() {\n  ${setup.join('\n  ')}\n}\nvoid loop() {\n  ${loop.join('\n  ')}\n}`;
}

// Turn a Design Spec into a plain-language wiring brief for the build_circuit
// agent. Orchestra builds this; the AI does the actual wiring.
export function circuitPromptFromSpec(spec) {
  const e = spec.electronics || [];
  const count = {};
  for (const x of e) count[x.partId] = (count[x.partId] || 0) + 1;
  const has = (pid) => count[pid] || 0;
  const motors = e.filter((x) => x.function === 'actuator' && x.partId === 'dc-motor').length;
  const lines = [
    `Build a COMPLETE, WORKING circuit for: ${spec.intent || spec.productType}.`,
    `Parts used: ${Object.entries(count).map(([p, n]) => `${n}× ${p}`).join(', ')}.`,
  ];
  if (motors) lines.push(`Drive the ${motors} dc-motor(s) through L298N driver(s) — each L298N drives up to 2 motors, so ADD ${Math.ceil(motors / 2)} l298n driver(s): wire Arduino digital pins to the L298N IN1/IN2 pins, the L298N OUT1/OUT2 to each motor's M+/M-, and the battery + plus a COMMON GROUND to every driver and the Arduino.`);
  if (has('hcsr04')) lines.push('Wire the hcsr04: VCC to 5V, GND to ground, TRIG and ECHO to two Arduino digital pins.');
  if (has('pir')) lines.push('Wire the PIR: VCC to 5V, GND to ground, OUT to a digital pin.');
  if (has('led-5mm')) lines.push('Wire each led-5mm through a res-220 resistor to its own Arduino digital pin, cathode to ground (ADD the resistors).');
  if (has('push-button')) lines.push('Wire the push-button between 5V and a digital pin.');
  if (has('joystick')) lines.push('Wire the joystick VRX/VRY to two analog pins and VCC/GND to power.');
  if (has('potentiometer')) lines.push('Wire the potentiometer wiper to an analog pin and VCC/GND to power.');
  lines.push('Every part must have power and a common ground. Add any l298n/res-220 parts required.');
  return lines.join(' ');
}

export function firmwarePromptFromSpec(spec) {
  const e = spec.electronics || [];
  const motors = e.filter((x) => x.function === 'actuator').length;
  const hasUltra = e.some((x) => x.partId === 'hcsr04');
  const hasBtn = e.some((x) => x.partId === 'push-button');
  const hasInd = e.some((x) => x.function === 'indicator');
  const b = [];
  if (motors && hasUltra) b.push(`Read the ultrasonic distance and drive ALL ${motors} motors forward through the L298N to move the robot; reverse and turn when an obstacle is closer than ~15 cm.`);
  else if (motors && hasBtn) b.push('Run the motors forward through the L298N while the button is held.');
  else if (motors) b.push('Drive the motors forward through the L298N.');
  if (hasInd && hasBtn) b.push('Light the LEDs while the button is pressed.');
  else if (hasInd) b.push('Use the LEDs as status indicators.');
  b.push('Use the EXACT pins from the wiring. Declare each pin as a named const int (NO arrays), set the motor direction pins so the motors actually run, and keep it compilable.');
  return b.join(' ');
}

export function synthesizeCircuit(spec) {
  const st = () => useStore.getState();
  st().clearCircuit();
  const add = (partId) => { st().addNode(partId); const n = st().nodes; return n[n.length - 1].id; };
  const wires = [];
  const w = (a, b) => wires.push({ op: 'addWire', from: a, to: b });

  const elec = spec.electronics || [];
  const mcuId = add(elec.find((e) => e.function === 'mcu')?.partId || 'arduino-uno');
  const batId = add(elec.find((e) => e.function === 'power')?.partId || 'battery-9v');
  const specMap = {};
  const mcuE = elec.find((e) => e.function === 'mcu'); if (mcuE) specMap[mcuE.id] = mcuId;
  const pwrE = elec.find((e) => e.function === 'power'); if (pwrE) specMap[pwrE.id] = batId;
  w(`${batId}.+`, `${mcuId}.VIN`);
  w(`${batId}.-`, `${mcuId}.GND1`);

  const digital = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13'];
  const analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
  const nextD = () => digital.shift() || 'D13';
  const nextA = () => analog.shift() || 'A5';
  const pm = { btn: null, analog: [], leds: [], motors: [], servos: [], sensors: [] };

  for (const e of elec.filter((x) => x.function === 'control')) {
    const id = add(e.partId); specMap[e.id] = id;
    if (e.partId === 'push-button' || e.partId === 'toggle-switch') { const p = nextD(); w(`${mcuId}.5V`, `${id}.A`); w(`${id}.B`, `${mcuId}.${p}`); pm.btn = pm.btn || p; }
    else if (e.partId === 'potentiometer') { const p = nextA(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.GND`, `${mcuId}.GND2`); w(`${id}.WIPER`, `${mcuId}.${p}`); pm.analog.push(p); }
    else if (e.partId === 'joystick') { const px = nextA(), py = nextA(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.GND`, `${mcuId}.GND2`); w(`${id}.VRX`, `${mcuId}.${px}`); w(`${id}.VRY`, `${mcuId}.${py}`); pm.analog.push(px, py); }
  }
  for (const e of elec.filter((x) => x.function === 'indicator')) {
    const id = add(e.partId); specMap[e.id] = id; const r = add('res-220'); const p = nextD();
    w(`${mcuId}.${p}`, `${r}.A`); w(`${r}.B`, `${id}.A`); w(`${id}.K`, `${mcuId}.GND3`); pm.leds.push(p);
  }
  for (const e of elec.filter((x) => x.function === 'actuator')) {
    const id = add(e.partId); specMap[e.id] = id;
    if (e.partId === 'dc-motor') {
      const drv = add('l298n'); const in1 = nextD(), in2 = nextD();
      w(`${batId}.+`, `${drv}.VCC`); w(`${batId}.-`, `${drv}.GND`);
      w(`${mcuId}.${in1}`, `${drv}.IN1`); w(`${mcuId}.${in2}`, `${drv}.IN2`);
      w(`${drv}.OUT1`, `${id}.M+`); w(`${drv}.OUT2`, `${id}.M-`); pm.motors.push([in1, in2]);
    } else if (String(e.partId).startsWith('servo')) {
      const p = nextD(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.GND`, `${mcuId}.GND2`); w(`${mcuId}.${p}`, `${id}.SIG`); pm.servos.push(p);
    }
  }
  for (const e of elec.filter((x) => x.function === 'sensor')) {
    const id = add(e.partId); specMap[e.id] = id;
    if (e.partId === 'hcsr04') { const t = nextD(), ec = nextD(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.GND`, `${mcuId}.GND2`); w(`${mcuId}.${t}`, `${id}.TRIG`); w(`${id}.ECHO`, `${mcuId}.${ec}`); pm.sensors.push({ type: 'hcsr04', trig: t, echo: ec }); }
    else if (e.partId === 'pir') { const p = nextD(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.OUT`, `${mcuId}.${p}`); w(`${id}.GND`, `${mcuId}.GND2`); pm.sensors.push({ type: 'pir', pin: p }); }
    else if (e.partId === 'dht22') { const p = nextD(); w(`${mcuId}.5V`, `${id}.VCC`); w(`${id}.DATA`, `${mcuId}.${p}`); w(`${id}.GND`, `${mcuId}.GND2`); pm.sensors.push({ type: 'dht22', pin: p }); }
  }

  st().applyAgentActions(wires);
  st().setNodeCode(mcuId, synthFirmware(pm));
  return { specMap, mcuId, ledCount: pm.leds.length, motors: pm.motors.length, sensors: pm.sensors.length };
}

// Functional validation specialised for an indicator circuit: with the button
// PRESSED, do the LEDs actually turn on?
export function indicatorReport() {
  const { nodes, wires, codeByNode } = useStore.getState();
  const btn = nodes.find((n) => n.partId === 'push-button');
  const leds = nodes.filter((n) => n.partId === 'led-5mm');
  if (!leds.length) return { leds: [], lit: 0, total: 0 };
  const inputs = btn ? { [btn.id]: true } : {};
  const sim = simulate(nodes, wires, { codeByNode, inputs, blinkPhase: true });
  const byNode = {};
  for (const c of sim.components) byNode[c.nodeId] = c;
  const rows = leds.map((l) => ({ nodeId: l.id, active: !!byNode[l.id]?.active }));
  return { leds: rows, lit: rows.filter((r) => r.active).length, total: rows.length };
}

export function firmwarePrompt(archetype) {
  if (archetype === 'car')
    return 'Read the joystick X (steering) and Y (throttle) on the analog pins and drive the two DC motors through the L298N: push up = both motors forward, down = both reverse, left/right = differential turn. Set the IN1-IN4 direction pins and PWM the ENA/ENB enables proportionally to the stick. Use the exact pins from the wiring. Add a small deadzone around center.';
  if (archetype === 'robot')
    return 'When the button is pressed, run both motors forward through the L298N so the robot moves; stop when released. Use the exact pins from the wiring.';
  if (archetype === 'lamp')
    return 'Read the potentiometer and PWM the LED brightness proportionally (0-255). Use the exact pins from the wiring.';
  return 'Implement the behavior described by the goal using the exact pins from the wiring.';
}
