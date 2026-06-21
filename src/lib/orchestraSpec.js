// ============================================================================
// Orchestra Design Spec (IR) — UNDERSTAND the goal, don't pattern-match it.
//
// The old classifyGoal() snapped a goal to one of three blueprints, so "a house
// with exterior LEDs controlled by a button" became a lamp. Instead we produce a
// structured Design Specification (real mm units) that describes WHAT the thing
// is — its bodies (with CSG cutouts and support relationships) and its
// electronics (mounted on those bodies, by function) and its behavior. A
// deterministic composer then turns the spec into an integrated electromechanical
// model, and the validators prove it. An LLM may refine the spec, but a correct
// seed spec stands on its own so results are consistent even on a weak model.
//
// Scale: maker / 3D-printable. 1 scene unit = 1000/SCENE_SCALE mm (SCENE_SCALE=12
// → 1 unit ≈ 83.3 mm). A "house" is a printable ~140 mm desk model in which a
// real 68 mm Arduino and 5 mm LEDs physically fit.
// ============================================================================

import { PART_BY_ID } from '../data/parts.js';
import { parseAgentJson } from './agentJson.js';

// Detect the product pattern. ORDER MATTERS: structures and vehicles are checked
// before "lamp", so "house with LEDs" is a house, not a lamp. "lamp" now needs an
// explicit lamp word — an LED alone never implies a lamp.
export function detectPattern(goal) {
  const g = String(goal || '').toLowerCase();
  if (/\b(house|home|cabin|casa|hogar|cabaña|building|edificio)\b/.test(g)) return 'house';
  if (/\b(car|vehicle|auto|coche|carro|buggy|truck|rc car)\b/.test(g)) return 'car';
  if (/\b(robot|rover|bot)\b/.test(g)) return 'robot';
  if (/\b(box|enclosure|case|caja|gabinete|housing|container)\b/.test(g)) return 'enclosure';
  if (/\b(lamp|lámpara|lampara|desk lamp|luminaria)\b/.test(g)) return 'lamp';
  return 'generic';
}

// How many indicator LEDs the goal asks for (word or digit), default 4.
export function indicatorCount(goal) {
  const g = String(goal || '').toLowerCase();
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, ocho: 8 };
  const m = g.match(/(\d+)\s*(?:leds?|lights?|luces?|focos?)/) || g.match(/\b(one|two|three|four|five|six|eight|dos|tres|cuatro|cinco|seis|ocho)\s*(?:leds?|lights?|luces?)/);
  if (m) return Math.max(1, Math.min(12, parseInt(m[1], 10) || words[m[1]] || 4));
  return 4;
}

const wordHas = (g, re) => re.test(String(g || '').toLowerCase());

// ---- seed specs (correct, complete designs the LLM may later adjust) ----
// All dimensions in millimetres. mountOn/face let the integration validator
// confirm electronics sit on the right surface; pos_mm is the authored placement.

export function seedHouse(goal) {
  // square footprint so a hip (pyramid) roof caps it exactly — a rectangular
  // plan would need a ridge roof (Phase 3).
  const W = 150, D = 150, WALL = 6, H = 104, FLOOR = 6;        // outer footprint, wall thickness, wall height
  const hasWindows = !wordHas(goal, /no window/);
  const n = indicatorCount(goal);
  const mode = wordHas(goal, /toggle|on\/off|switch/) ? 'toggle' : 'hold';

  const bodies = [
    { id: 'floor', role: 'floor', shape: 'box', dims_mm: { w: W, h: FLOOR, d: D }, pos_mm: [0, FLOOR / 2, 0], material: 'pla', supportedBy: [] },
    // four perimeter walls (CSG-unioned; corner overlap is fine)
    { id: 'wall_front', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [W / 2 - WALL / 2, FLOOR + H / 2, 0], material: 'pla', supportedBy: ['floor'],
      cutouts: [
        { id: 'door', shape: 'box', dims_mm: { w: WALL * 3, h: 70, d: 38 }, pos_mm: [W / 2 - WALL / 2, FLOOR + 35, -28] },
        ...(hasWindows ? [{ id: 'win_f', shape: 'box', dims_mm: { w: WALL * 3, h: 28, d: 30 }, pos_mm: [W / 2 - WALL / 2, FLOOR + 72, 36] }] : []),
      ] },
    { id: 'wall_back', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [-W / 2 + WALL / 2, FLOOR + H / 2, 0], material: 'pla', supportedBy: ['floor'],
      cutouts: hasWindows ? [{ id: 'win_b', shape: 'box', dims_mm: { w: WALL * 3, h: 30, d: 40 }, pos_mm: [-W / 2 + WALL / 2, FLOOR + 60, 0] }] : [] },
    { id: 'wall_left', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, FLOOR + H / 2, D / 2 - WALL / 2], material: 'pla', supportedBy: ['floor'],
      cutouts: hasWindows ? [{ id: 'win_l', shape: 'box', dims_mm: { w: 40, h: 30, d: WALL * 3 }, pos_mm: [0, FLOOR + 60, D / 2 - WALL / 2] }] : [] },
    { id: 'wall_right', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, FLOOR + H / 2, -D / 2 + WALL / 2], material: 'pla', supportedBy: ['floor'],
      cutouts: hasWindows ? [{ id: 'win_r', shape: 'box', dims_mm: { w: 40, h: 30, d: WALL * 3 }, pos_mm: [0, FLOOR + 60, -D / 2 + WALL / 2] }] : [] },
    // hip roof (pyramid) rotated 45° so its square base aligns with the walls
    // and rests on the FULL perimeter (not just the four corners), overhanging.
    { id: 'roof', role: 'roof', shape: 'pyramid', dims_mm: { w: (W + 16) * 1.414, h: 52, d: (D + 16) * 1.414 }, pos_mm: [0, FLOOR + H + 26, 0], rot: [0, Math.PI / 4, 0], material: 'pla', supportedBy: ['wall_front', 'wall_back', 'wall_left', 'wall_right'] },
  ];

  // indicator LEDs spread along the eaves on EXTERIOR faces, facing outward
  const topY = FLOOR + H - 14;
  const ring = [
    { face: '+x', p: [W / 2 + 2, topY, 0] }, { face: '-x', p: [-W / 2 - 2, topY, 0] },
    { face: '+z', p: [0, topY, D / 2 + 2] }, { face: '-z', p: [0, topY, -D / 2 - 2] },
    { face: '+x', p: [W / 2 + 2, topY, 38] }, { face: '+x', p: [W / 2 + 2, topY, -38] },
    { face: '+z', p: [40, topY, D / 2 + 2] }, { face: '-z', p: [-40, topY, -D / 2 - 2] },
  ];
  const wallOf = { '+x': 'wall_front', '-x': 'wall_back', '+z': 'wall_left', '-z': 'wall_right' };
  const electronics = [
    { id: 'mcu', partId: 'arduino-uno', function: 'mcu', mountOn: 'floor', face: '+y', pos_mm: [-20, FLOOR + 9, -35] },
    { id: 'pwr', partId: 'battery-9v', function: 'power', mountOn: 'floor', face: '+y', pos_mm: [30, FLOOR + 9, 35] },
    { id: 'btn', partId: 'push-button', function: 'control', mountOn: 'wall_front', face: '+x', pos_mm: [W / 2 + 2, FLOOR + 26, 30] }, // beside the door, reachable
  ];
  for (let i = 0; i < n; i++) {
    const r = ring[i % ring.length];
    electronics.push({ id: 'led' + (i + 1), partId: 'led-5mm', function: 'indicator', mountOn: wallOf[r.face], face: r.face, pos_mm: [...r.p] });
  }

  return {
    intent: String(goal || 'house'), productType: 'house', units: 'mm',
    bodies, electronics,
    behavior: [{ control: 'btn', drives: electronics.filter((e) => e.function === 'indicator').map((e) => e.id), mode }],
    constraints: { minWall_mm: 2.4, maxEnvelope_mm: 250 },
  };
}

export function seedEnclosure(goal) {
  const W = 90, D = 70, H = 40, WALL = 3;
  const n = indicatorCount(goal);
  const bodies = [
    { id: 'base', role: 'enclosure', shape: 'box', dims_mm: { w: W, h: WALL, d: D }, pos_mm: [0, WALL / 2, 0], material: 'abs', supportedBy: [] },
    { id: 'wall_f', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [W / 2 - WALL / 2, H / 2, 0], material: 'abs', supportedBy: ['base'] },
    { id: 'wall_b', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [-W / 2 + WALL / 2, H / 2, 0], material: 'abs', supportedBy: ['base'] },
    { id: 'wall_l', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, H / 2, D / 2 - WALL / 2], material: 'abs', supportedBy: ['base'] },
    { id: 'wall_r', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, H / 2, -D / 2 + WALL / 2], material: 'abs', supportedBy: ['base'],
      cutouts: [{ id: 'usb', shape: 'box', dims_mm: { w: 14, h: 10, d: WALL * 3 }, pos_mm: [0, 12, -D / 2 + WALL / 2] }] },
  ];
  const electronics = [
    { id: 'mcu', partId: 'arduino-uno', function: 'mcu', mountOn: 'base', face: '+y', pos_mm: [0, WALL + 9, 0] },
    { id: 'pwr', partId: 'battery-9v', function: 'power', mountOn: 'base', face: '+y', pos_mm: [-28, WALL + 9, 0] },
    { id: 'btn', partId: 'push-button', function: 'control', mountOn: 'wall_f', face: '+x', pos_mm: [W / 2 + 2, H - 8, 20] },
  ];
  const topY = H - 6;
  const slots = [[W / 2 + 2, topY, -18], [W / 2 + 2, topY, 0], [W / 2 + 2, topY, 18], [0, H + 1.5, 0]];
  for (let i = 0; i < n; i++) electronics.push({ id: 'led' + (i + 1), partId: 'led-5mm', function: 'indicator', mountOn: 'wall_f', face: '+x', pos_mm: slots[i % slots.length] });
  return {
    intent: String(goal || 'enclosure'), productType: 'enclosure', units: 'mm', bodies, electronics,
    behavior: [{ control: 'btn', drives: electronics.filter((e) => e.function === 'indicator').map((e) => e.id), mode: 'hold' }],
    constraints: { minWall_mm: 1.6, maxEnvelope_mm: 180 },
  };
}

const NUM_WORDS = { two: 2, four: 4, six: 6, dos: 2, cuatro: 4, seis: 6 };
// How many drive MOTORS the goal asks for (counts "motors" ONLY, not wheels —
// "4 wheels driven by two motors" is 2 motors, not 4).
export function motorCount(goal) {
  const g = String(goal || '').toLowerCase();
  const m = g.match(/(\d+)\s*(?:motors?|motores?)/) || g.match(/\b(two|four|six|dos|cuatro|seis)\s*(?:motors?|motores?)/);
  if (m) return Math.max(1, Math.min(6, parseInt(m[1], 10) || NUM_WORDS[m[1]] || 2));
  if (/\b(car|robot|rover|vehicle|coche|carro|auto|buggy|truck)\b/.test(g)) return 2;
  return /\bmotor|servo|fan|ventilador\b/.test(g) ? 1 : 0;
}
// How many WHEELS (explicit "N wheels", else one per motor, min 2).
export function wheelCount(goal) {
  const g = String(goal || '').toLowerCase();
  const m = g.match(/(\d+)\s*(?:wheels?|ruedas?)/) || g.match(/\b(two|four|six|dos|cuatro|seis)\s*(?:wheels?|ruedas?)/);
  if (m) return Math.max(2, Math.min(6, parseInt(m[1], 10) || NUM_WORDS[m[1]] || 4));
  return Math.max(2, motorCount(goal) || 2);
}

// A driven robot/rover: chassis + N wheels (laid flat at the corners with
// clearance so they never intersect) + optional ultrasonic + N drive motors.
// Marked isVehicle so the pipeline mounts the wheels on the motors (they spin).
export function seedRobot(goal) {
  const n = Math.max(2, Math.round(wheelCount(goal) / 2) * 2); // even number of wheels (one motor each)
  const wantUltra = wordHas(goal, /ultrasonic|ultrasonido|hc-?sr04|distance|distancia|sumo|obstacle|obstáculo/);
  const L = 130, H = 30, W = 96;        // chassis length/height/width (mm)
  const R = 23, T = 15;                  // wheel radius / thickness
  const wheelY = R, chassisY = R + H / 2 - 2;
  const perSide = n / 2;
  const xs = perSide === 1 ? [0] : Array.from({ length: perSide }, (_, i) => -(L / 2 - 26) + i * ((L - 52) / (perSide - 1)));
  const zTrack = W / 2 + T / 2 + 1;      // wheels just outside the body, +1 mm gap
  const bodies = [
    { id: 'chassis', role: 'chassis', shape: 'box', dims_mm: { w: L, h: H, d: W }, pos_mm: [0, chassisY, 0], material: 'abs', supportedBy: [] },
  ];
  const electronics = [
    { id: 'mcu', partId: 'arduino-uno', function: 'mcu', mountOn: 'chassis', face: '+y', pos_mm: [0, chassisY, -18] },
    { id: 'pwr', partId: 'battery-9v', function: 'power', mountOn: 'chassis', face: '+y', pos_mm: [0, chassisY, 18] },
  ];
  let w = 0;
  for (const side of [zTrack, -zTrack]) {
    for (const x of xs) {
      bodies.push({ id: 'wheel' + w, role: 'wheel', shape: 'cylinder', dims_mm: { r: R, h: T }, pos_mm: [x, wheelY, side], rot: [Math.PI / 2, 0, 0], material: 'rubber', supportedBy: [] });
      electronics.push({ id: 'motor' + w, partId: 'dc-motor', function: 'actuator', mountOn: 'chassis', face: side > 0 ? '+z' : '-z', pos_mm: [x, wheelY, side] });
      w++;
    }
  }
  if (wantUltra) electronics.push({ id: 'dist', partId: 'hcsr04', function: 'sensor', mountOn: 'chassis', face: '+x', pos_mm: [L / 2 + 8, chassisY, 0] });
  return {
    intent: String(goal || 'robot'), productType: 'robot', units: 'mm', isVehicle: true,
    bodies, electronics,
    behavior: [{ control: wantUltra ? 'dist' : null, drives: electronics.filter((e) => e.function === 'actuator').map((e) => e.id), mode: 'auto-forward' }],
    constraints: { minWall_mm: 2.0, maxEnvelope_mm: 220 },
  };
}

// A joystick car: chassis + cabin + 4 wheels (flat, at the corners, clearance so
// they never intersect) + 2 drive motors + a joystick.
export function seedCar(goal) {
  const L = 170, H = 34, W = 92, R = 26, T = 16, cabinH = 30;
  const wheelY = R, chassisY = R + H / 2 - 4;
  const xAxle = L / 2 - 28, zTrack = W / 2 + T / 2 + 1;
  const wheel = (id, x, z) => ({ id, role: 'wheel', shape: 'cylinder', dims_mm: { r: R, h: T }, pos_mm: [x, wheelY, z], rot: [Math.PI / 2, 0, 0], material: 'rubber' });
  const bodies = [
    { id: 'chassis', role: 'chassis', shape: 'box', dims_mm: { w: L, h: H, d: W }, pos_mm: [0, chassisY, 0], material: 'abs' },
    { id: 'cabin', role: 'panel', shape: 'box', dims_mm: { w: 72, h: cabinH, d: W * 0.78 }, pos_mm: [-8, chassisY + H / 2 + cabinH / 2, 0], material: 'abs' },
    wheel('wheel0', xAxle, zTrack), wheel('wheel1', xAxle, -zTrack), wheel('wheel2', -xAxle, zTrack), wheel('wheel3', -xAxle, -zTrack),
  ];
  const electronics = [
    { id: 'mcu', partId: 'arduino-uno', function: 'mcu', mountOn: 'chassis', face: '+y', pos_mm: [10, chassisY, 0] },
    { id: 'pwr', partId: 'battery-9v', function: 'power', mountOn: 'chassis', face: '+y', pos_mm: [-40, chassisY, 0] },
    { id: 'joy', partId: 'joystick', function: 'control', mountOn: 'cabin', face: '+y', pos_mm: [-8, chassisY + H / 2 + cabinH, 0] },
    { id: 'motorL', partId: 'dc-motor', function: 'actuator', mountOn: 'chassis', face: '+z', pos_mm: [-xAxle, wheelY, zTrack] },
    { id: 'motorR', partId: 'dc-motor', function: 'actuator', mountOn: 'chassis', face: '-z', pos_mm: [-xAxle, wheelY, -zTrack] },
  ];
  return {
    intent: String(goal || 'car'), productType: 'car', units: 'mm', isVehicle: true,
    bodies, electronics,
    behavior: [{ control: 'joy', drives: ['motorL', 'motorR'], mode: 'joystick' }],
    constraints: { minWall_mm: 2.0, maxEnvelope_mm: 250 },
  };
}

// UNIVERSAL requirement-driven builder — for ANY goal that has no named template.
// It parses what the goal asks for (LEDs, a control, motors, sensors) and builds
// an enclosure (or a driven chassis if it's a vehicle) that mounts and will wire
// all of them. This is the deterministic floor that guarantees a conformant,
// valid design for novel goals without dropping to a step-by-step loop.
export function buildGenericSpec(goal) {
  const g = String(goal || '').toLowerCase();
  const isVehicle = /\b(car|robot|rover|vehicle|coche|carro|auto|buggy|truck|tank|dron|drone)\b/.test(g);
  const nMotors = (isVehicle || /\bmotor|motores|fan|ventilador|servo\b/.test(g)) ? motorCount(g) : 0;
  const nLeds = /\bled|leds|luces?|focos?\b/.test(g) && !/\blamp|lámpara\b/.test(g) ? indicatorCount(g) : 0;
  const control = /joystick/.test(g) ? 'joystick' : /\bbutton|bot[oó]n\b/.test(g) ? 'push-button' : /\bpot|dimmer|potenc/.test(g) ? 'potentiometer' : null;
  const sensors = [];
  if (/ultrasonic|ultrasonido|hc-?sr04|distance|distancia/.test(g)) sensors.push('hcsr04');
  if (/\bpir\b|motion|movimiento/.test(g)) sensors.push('pir');
  if (/temperatur|dht|humid|humedad/.test(g)) sensors.push('dht22');

  // a driven base: reuse the rover geometry, then append the requested extras
  if (isVehicle && nMotors >= 2) {
    const spec = seedRobot(goal);
    const chassis = spec.bodies.find((b) => b.role === 'chassis');
    const topY = chassis.pos_mm[1] + chassis.dims_mm.h / 2;
    for (const sn of sensors) if (!spec.electronics.some((e) => e.partId === sn)) spec.electronics.push({ id: sn, partId: sn, function: 'sensor', mountOn: 'chassis', face: '+x', pos_mm: [chassis.dims_mm.w / 2 + 8, chassis.pos_mm[1], 0] });
    for (let i = 0; i < nLeds; i++) spec.electronics.push({ id: 'led' + i, partId: 'led-5mm', function: 'indicator', mountOn: 'chassis', face: '+y', pos_mm: [chassis.dims_mm.w / 2 - 18 - i * 12, topY + 2, 28] });
    if (control && control !== 'joystick') { spec.electronics.push({ id: 'ctl', partId: control, function: 'control', mountOn: 'chassis', face: '+y', pos_mm: [-chassis.dims_mm.w / 2 + 18, topY + 6, -26] }); spec.behavior = [{ control: 'ctl', drives: spec.electronics.filter((e) => e.function === 'actuator').map((e) => e.id), mode: 'hold' }]; }
    return normalizeSpec(spec);
  }

  // static device: an enclosure that holds the requested electronics on its front
  const onFront = nLeds + (control ? 1 : 0) + sensors.length;
  const W = Math.max(80, 24 * Math.max(1, onFront)), D = 64, H = 46, WALL = 3;
  const bodies = [
    { id: 'base', role: 'enclosure', shape: 'box', dims_mm: { w: W, h: WALL, d: D }, pos_mm: [0, WALL / 2, 0], material: 'abs' },
    { id: 'wall_f', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [W / 2 - WALL / 2, H / 2, 0], material: 'abs' },
    { id: 'wall_b', role: 'wall', shape: 'box', dims_mm: { w: WALL, h: H, d: D }, pos_mm: [-W / 2 + WALL / 2, H / 2, 0], material: 'abs' },
    { id: 'wall_l', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, H / 2, D / 2 - WALL / 2], material: 'abs' },
    { id: 'wall_r', role: 'wall', shape: 'box', dims_mm: { w: W, h: H, d: WALL }, pos_mm: [0, H / 2, -D / 2 + WALL / 2], material: 'abs' },
  ];
  const electronics = [
    { id: 'mcu', partId: 'arduino-uno', function: 'mcu', mountOn: 'base', face: '+y', pos_mm: [0, WALL + 9, 0] },
    { id: 'pwr', partId: 'battery-9v', function: 'power', mountOn: 'base', face: '+y', pos_mm: [-28, WALL + 9, 0] },
  ];
  const slots = Math.max(1, onFront);
  const zAt = (i) => -D / 2 + D * ((i + 1) / (slots + 1));
  let s = 0;
  for (let i = 0; i < nLeds; i++) electronics.push({ id: 'led' + i, partId: 'led-5mm', function: 'indicator', mountOn: 'wall_f', face: '+x', pos_mm: [W / 2 + 2, H - 10, zAt(s++)] });
  for (const sn of sensors) electronics.push({ id: sn, partId: sn, function: 'sensor', mountOn: 'wall_f', face: '+x', pos_mm: [W / 2 + 2, H / 2, zAt(s++)] });
  if (control) electronics.push({ id: 'ctl', partId: control, function: 'control', mountOn: 'wall_f', face: '+x', pos_mm: [W / 2 + 2, 14, zAt(s++)] });
  const behavior = control && nLeds ? [{ control: 'ctl', drives: electronics.filter((e) => e.function === 'indicator').map((e) => e.id), mode: 'hold' }] : [];
  return normalizeSpec({ intent: String(goal), productType: 'device', units: 'mm', isVehicle: false, bodies, electronics, behavior, constraints: { minWall_mm: 1.6, maxEnvelope_mm: 220 } });
}

// Build a seed spec for a pattern. ALWAYS returns a spec (the universal builder
// handles 'generic'), so the autonomous fallback is never empty.
export function seedSpec(pattern, goal) {
  if (pattern === 'house') return normalizeSpec(seedHouse(goal));
  if (pattern === 'enclosure') return normalizeSpec(seedEnclosure(goal));
  if (pattern === 'robot') return normalizeSpec(seedRobot(goal));
  if (pattern === 'car') return normalizeSpec(seedCar(goal));
  if (pattern === 'lamp') return null; // lamp keeps its mechanical template
  return buildGenericSpec(goal);
}

// ---- LLM spec generation for NOVEL goals (beyond the seed templates) --------
// The model proposes a full Design Spec; we sanitise it hard (only real partIds,
// valid shapes, clamped mm) and run it through the SAME composer + validators as
// a seed spec. A weak model still produces *something* the validators correct;
// quality scales with the Director model. Returns null on junk → caller falls
// back to the step-by-step loop.
const VALID_SHAPES = new Set(['box', 'cylinder', 'pyramid', 'cone']);
const VALID_FUNCS = new Set(['mcu', 'power', 'indicator', 'control', 'driver', 'actuator', 'sensor']);
const SPEC_PARTS = 'arduino-uno, arduino-nano, esp32, rpi-pico, battery-9v, battery-lipo, push-button, toggle-switch, potentiometer, joystick, led-5mm, rgb-led, res-220, dc-motor, servo-sg90, l298n, hcsr04, pir, dht22, ldr, buzzer, oled-ssd1306';

export function sanitizeSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const rid = (p) => p + Math.random().toString(36).slice(2, 5);
  const bodies = (spec.bodies || []).filter((b) => b && typeof b === 'object').map((b) => ({
    id: String(b.id || rid('b')),
    role: typeof b.role === 'string' ? b.role : 'panel',
    shape: VALID_SHAPES.has(b.shape) ? b.shape : 'box',
    dims_mm: b.dims_mm && typeof b.dims_mm === 'object' ? b.dims_mm : { w: 50, h: 40, d: 50 },
    pos_mm: Array.isArray(b.pos_mm) && b.pos_mm.length === 3 ? b.pos_mm.map(Number) : [0, 25, 0],
    rot: Array.isArray(b.rot) ? b.rot : [0, 0, 0],
    material: typeof b.material === 'string' ? b.material : 'pla',
    cutouts: Array.isArray(b.cutouts) ? b.cutouts.filter((c) => c && c.dims_mm) : [],
  }));
  if (!bodies.length) return null;
  const ids = new Set(bodies.map((b) => b.id));
  const electronics = (spec.electronics || []).filter((e) => e && PART_BY_ID[e.partId]).map((e) => ({
    id: String(e.id || rid('e')),
    partId: e.partId,
    function: VALID_FUNCS.has(e.function) ? e.function : 'sensor',
    mountOn: ids.has(e.mountOn) ? e.mountOn : bodies[0].id,
    face: typeof e.face === 'string' ? e.face : '+x',
    pos_mm: Array.isArray(e.pos_mm) && e.pos_mm.length === 3 ? e.pos_mm.map(Number) : [...bodies[0].pos_mm],
  }));
  const out = {
    intent: String(spec.intent || ''), productType: String(spec.productType || 'custom'), units: 'mm',
    bodies, electronics,
    behavior: Array.isArray(spec.behavior) ? spec.behavior : [],
    constraints: { minWall_mm: 1.6, maxEnvelope_mm: 220 },
  };
  return normalizeSpec(out);
}

export async function generateSpec(goal, deficiencies = null) {
  const example = JSON.stringify(seedEnclosure('a small box with two status LEDs and a button'));
  const system = [
    'You are a mechanical + electronics design engineer for a 3D-printable maker studio. Produce a complete Design Spec (JSON) for the goal at printable scale (MILLIMETRES, keep the whole thing under ~200 mm).',
    'Output ONLY one JSON object, no prose, in this shape:',
    '{"productType":str,"bodies":[{"id":str,"role":"floor|wall|roof|enclosure|panel|base|chassis|arm","shape":"box|cylinder|pyramid","dims_mm":{"w":n,"h":n,"d":n},"pos_mm":[x,y,z],"material":"pla|abs|petg","cutouts":[{"shape":"box","dims_mm":{...},"pos_mm":[...]}]}],',
    '"electronics":[{"id":str,"partId":str,"function":"mcu|power|indicator|control|sensor|actuator|driver","mountOn":bodyId,"face":"+x|-x|+y|-y|+z|-z","pos_mm":[x,y,z]}],"behavior":[{"control":id,"drives":[ids],"mode":"hold"}]}',
    'Rules: the base/floor body rests on the ground (its bottom at y=0); other bodies stack on it; indicators/controls mount on EXTERIOR faces; use ONLY these partIds: ' + SPEC_PARTS + '.',
  ].join('\n');
  const fix = deficiencies ? `Your PREVIOUS design FAILED these engineering checks — you MUST fix every one:\n${deficiencies}\n\n` : '';
  const userText = `GOAL: ${goal}\n\n${fix}Here is a correct example spec to follow for structure and scale (adapt it to the goal):\n${example}\n\nReturn the JSON Design Spec for the goal.`;
  let resp;
  try { resp = await window.forge.orchestra.think({ system, userText, maxTokens: 2000 }); }
  catch { return null; }
  if (!resp || resp.mock) return null;
  return sanitizeSpec(parseAgentJson(resp.text));
}

// Fill defaults and clamp to sane maker-scale mm so a bad LLM patch can't produce
// a 5-metre wall or a sub-millimetre body.
export function normalizeSpec(spec) {
  const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  for (const b of spec.bodies || []) {
    b.shape = b.shape || 'box';
    b.rot = b.rot || [0, 0, 0];
    b.material = b.material || 'pla';
    const dm = b.dims_mm || {};
    if (dm.w != null) dm.w = clamp(dm.w, 1, 400, 50);
    if (dm.h != null) dm.h = clamp(dm.h, 1, 400, 50);
    if (dm.d != null) dm.d = clamp(dm.d, 1, 400, 50);
    if (dm.r != null) dm.r = clamp(dm.r, 1, 200, 25);
    b.dims_mm = dm;
    b.pos_mm = (b.pos_mm || [0, 0, 0]).map((n) => clamp(n, -400, 400, 0));
    b.cutouts = b.cutouts || [];
  }
  spec.electronics = (spec.electronics || []).filter((e) => e.partId);
  spec.behavior = spec.behavior || [];
  return spec;
}
