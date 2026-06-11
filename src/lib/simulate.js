import { useMemo } from 'react';
import { PART_BY_ID } from '../data/parts.js';
import { useStore } from './store.js';
import { analyzeDrivenPins } from './codeSim.js';
import { numberedNodeNames } from './labels.js';

// Logic-level voltage a board's GPIO output pin drives when set HIGH.
const LOGIC_V = {
  'arduino-uno': 5, 'arduino-nano': 5, 'arduino-mega': 5, 'attiny85': 5,
  'esp32': 3.3, 'esp8266': 3.3, 'rpi-pico': 3.3, 'stm32-bluepill': 3.3, 'rpi5': 3.3,
};

// ---- Electrical metadata ----------------------------------------------------
// Source pins provide a voltage. Everything named GND / '-' is treated as ground.
// Power-input pins (VCC/5V on a *load*) are sinks, not sources.
const SOURCE_PINS = {
  // batteries / supplies
  'battery-9v': { '+': 9 },
  'battery-aa': { '+': 1.5 },
  'battery-lipo': { '+': 3.7 },
  'coin-cell': { '+': 3 },
  'solar-6v': { '+': 6 },
  'barrel-12v': { '+': 12 },
  'usb-5v': { '5V': 5 },
  'power-bank': { '5V': 5 },
  // regulators / converters
  'vreg-7805': { 'OUT': 5 },
  'buck-lm2596': { 'OUT+': 5 },
  'boost-converter': { 'OUT+': 5 },
  // MCU regulated rails
  'arduino-uno': { '5V': 5, '3V3': 3.3 },
  'arduino-nano': { '5V': 5, '3V3': 3.3 },
  'arduino-mega': { '5V': 5, '3V3': 3.3 },
  'esp32': { '3V3': 3.3 },
  'esp8266': { '3V3': 3.3 },
  'rpi-pico': { '3V3': 3.3 },
  'stm32-bluepill': { '5V': 5, '3V3': 3.3 },
};

const GROUND_PIN_NAMES = new Set(['GND', '-', 'OUT-', 'IN-', 'M-', 'K']);
// Boards expose several ground pins (GND1/GND2/…); treat any GND* as ground.
const isGroundName = (pin) => GROUND_PIN_NAMES.has(pin) || /^GND\d*$/.test(pin);
// note: 'K' (LED cathode) acts as a return path; treated as ground-side only if wired to ground.

// Nominal current draw (Amps) when a component is active.
const DRAW = {
  // indicators / displays
  'led-5mm': 0.02,
  'rgb-led': 0.06,
  'seven-seg': 0.06,
  'oled-ssd1306': 0.02,
  'lcd1602': 0.025,
  'max7219': 0.12,
  'neopixel-ring': 0.3,
  'buzzer': 0.03,
  'speaker-8ohm': 0.2,
  // actuators
  'dc-motor': 0.2,
  'servo-sg90': 0.25,
  'servo-mg996': 0.5,
  'stepper-28byj': 0.24,
  'stepper-nema17': 0.4,
  'solenoid': 0.5,
  'vibration-motor': 0.09,
  'pump-12v': 0.35,
  'linear-actuator': 0.5,
  // drivers
  'l298n': 0.05,
  'uln2003': 0.02,
  'relay-1ch': 0.07,
  // sensors / modules
  'hcsr04': 0.015,
  'dht22': 0.002,
  'ds18b20': 0.0015,
  'pir': 0.0001,
  'mpu6050': 0.004,
  'bmp280': 0.001,
  'ir-obstacle': 0.02,
  'soil-moisture': 0.005,
  'mq2-gas': 0.15,
  'flame-sensor': 0.015,
  'rfid-rc522': 0.026,
  'gps-neo6m': 0.045,
  'hx711': 0.0015,
  // MCUs
  'esp32': 0.16,
  'esp8266': 0.08,
  'rpi-pico': 0.05,
  'stm32-bluepill': 0.05,
  'arduino-uno': 0.05,
  'arduino-nano': 0.04,
  'arduino-mega': 0.06,
  'attiny85': 0.01,
};

// ---- Union-find -------------------------------------------------------------
class DSU {
  constructor() { this.p = {}; }
  find(x) {
    if (this.p[x] === undefined) this.p[x] = x;
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a, b) { this.p[this.find(a)] = this.find(b); }
}

const key = (node, pin) => `${node}:${pin}`;

export function simulate(nodes, wires, opts = {}) {
  const { codeByNode = null, blinkPhase = true, inputs = {} } = opts;
  const dsu = new DSU();
  // register every pin
  for (const n of nodes) {
    const part = PART_BY_ID[n.partId];
    for (const pin of part.pins) dsu.find(key(n.id, pin));
  }
  // merge by wires
  for (const w of wires) dsu.union(key(w.from.node, w.from.pin), key(w.to.node, w.to.pin));
  // closed switches/buttons conduct: bridge their two terminals
  for (const n of nodes) {
    if ((n.partId === 'push-button' || n.partId === 'toggle-switch') && inputs[n.id]) {
      dsu.union(key(n.id, 'A'), key(n.id, 'B'));
    }
    if (n.partId === 'joystick' && inputs[n.id]?.sw) {
      dsu.union(key(n.id, 'SW'), key(n.id, 'GND'));
    }
  }

  // group pins into nets
  const netMap = {}; // root -> { id, pins:[{node,pin}], voltage, isGround }
  const pinNet = {}; // 'node:pin' -> netId
  for (const n of nodes) {
    const part = PART_BY_ID[n.partId];
    for (const pin of part.pins) {
      const root = dsu.find(key(n.id, pin));
      if (!netMap[root]) netMap[root] = { id: root, pins: [], voltage: 0, isGround: false, short: false };
      netMap[root].pins.push({ node: n.id, pin, partId: n.partId });
      pinNet[key(n.id, pin)] = root;
    }
  }

  // assign voltage / ground role
  for (const net of Object.values(netMap)) {
    let hasSource = false;
    for (const p of net.pins) {
      const src = SOURCE_PINS[p.partId]?.[p.pin];
      if (src !== undefined) { net.voltage = Math.max(net.voltage, src); hasSource = true; }
      if (isGroundName(p.pin)) net.isGround = true;
    }
    // a net that is both a positive source and a declared ground = short
    if (hasSource && net.isGround && net.voltage > 0) net.short = true;
    net.isSource = hasSource; // true power rails (for stats / "no power" check)
  }

  const netOf = (node, pin) => netMap[pinNet[key(node, pin)]];

  // Is an interactive input wired to this board pin currently active?
  // Buttons/switches: pressed. Joystick VRX/VRY: deflected from center.
  // Potentiometer wiper: turned up. Gate strings may list several pins ("A0|A1").
  const inputActiveOnPin = (node, gatePins) => {
    for (const pin of String(gatePins).split('|')) {
      const net = netOf(node, pin);
      if (!net) continue;
      for (const p of net.pins) {
        if (p.partId === 'push-button' || p.partId === 'toggle-switch') {
          if (inputs[p.node]) return true;
        } else if (p.partId === 'joystick') {
          const v = inputs[p.node] || {};
          if (p.pin === 'SW' && v.sw) return true;
          if (p.pin === 'VRX' && Math.abs((v.x ?? 0.5) - 0.5) > 0.12) return true;
          if (p.pin === 'VRY' && Math.abs((v.y ?? 0.5) - 0.5) > 0.12) return true;
        } else if (p.partId === 'potentiometer' && p.pin === 'WIPER') {
          if ((inputs[p.node] ?? 0.5) > 0.08) return true;
        }
      }
    }
    return false;
  };

  // --- run the board's code: GPIO output pins energize their nets ---
  // This is what makes a software-driven LED/motor actually light up & blink
  // in the simulation (e.g. led.on()/digitalWrite(pin, HIGH)), and lets a button
  // wired to a read pin control an output (digitalWrite(LED, digitalRead(BTN))).
  if (codeByNode) {
    for (const n of nodes) {
      const lv = LOGIC_V[n.partId];
      if (!lv) continue;
      const code = codeByNode[n.id];
      if (!code) continue;
      const driven = analyzeDrivenPins(n.partId, code);
      const partPins = PART_BY_ID[n.partId].pins;
      for (const pin of Object.keys(driven)) {
        if (!partPins.includes(pin)) continue;
        const st = driven[pin];
        let on;
        const gated = st && typeof st === 'object' && st.gate;
        if (gated) {
          on = inputActiveOnPin(n.id, st.gate); // output follows the wired input
        } else {
          on = st === 'high' || (st === 'blink' && blinkPhase);
        }
        if (!on) continue;
        const net = netOf(n.id, pin);
        if (net) { net.voltage = Math.max(net.voltage, lv); net.isSource = true; net.driven = true; if (gated) net.gated = true; }
      }
    }
  }

  // --- analog inputs: potentiometer wiper & joystick axes output a fraction of VCC ---
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  for (const n of nodes) {
    if (n.partId === 'potentiometer') {
      const frac = clamp01(inputs[n.id] ?? 0.5);
      const vcc = netOf(n.id, 'VCC')?.voltage || 0;
      const w = netOf(n.id, 'WIPER');
      if (w && vcc > 0) { w.voltage = Math.max(w.voltage, vcc * frac); w.isSource = true; w.driven = true; }
    }
    if (n.partId === 'joystick') {
      const v = inputs[n.id] || {};
      const vcc = netOf(n.id, 'VCC')?.voltage || 0;
      const axis = (pin, val) => {
        const net = netOf(n.id, pin);
        if (net && vcc > 0) { net.voltage = Math.max(net.voltage, vcc * clamp01(val ?? 0.5)); net.isSource = true; net.driven = true; }
      };
      axis('VRX', v.x); axis('VRY', v.y);
    }
  }

  // --- motor drivers (L298N): power flows IN -> OUT ---
  // When the driver has VCC and an INx is energized, the matching OUTx outputs
  // the supply voltage and the opposite OUT acts as the return path, so a motor
  // wired across OUT1/OUT2 actually runs — with a direction.
  //
  // Direction with joystick-gated code: our coarse analysis drives BOTH INs at
  // once, so we disambiguate with the dominant joystick deflection sign:
  // up/right = forward (IN1), down/left = reverse (IN2).
  let joySign = 0;
  for (const n of nodes) {
    if (n.partId !== 'joystick') continue;
    const v = inputs[n.id] || {};
    const dx = (v.x ?? 0.5) - 0.5;
    const dy = (v.y ?? 0.5) - 0.5;
    if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) continue;
    joySign = (Math.abs(dy) >= Math.abs(dx) ? dy : dx) > 0 ? 1 : -1;
  }
  for (const n of nodes) {
    if (n.partId !== 'l298n') continue;
    const vcc = netOf(n.id, 'VCC')?.voltage || 0;
    if (vcc <= 0) continue;
    const n1 = netOf(n.id, 'IN1');
    const n2 = netOf(n.id, 'IN2');
    let in1 = (n1?.voltage || 0) > 0.5;
    let in2 = (n2?.voltage || 0) > 0.5;
    // both INs gated high (coarse analysis) -> pick direction from the joystick
    if (in1 && in2 && (n1?.gated || n2?.gated) && joySign !== 0) {
      if (joySign > 0) in2 = false;
      else in1 = false;
    }
    const out1 = netOf(n.id, 'OUT1');
    const out2 = netOf(n.id, 'OUT2');
    if (in1) {
      if (out1) { out1.voltage = Math.max(out1.voltage, vcc); out1.isSource = true; out1.driven = true; }
      if (out2 && out2.voltage === 0) out2.isGround = true;
    } else if (in2) {
      if (out2) { out2.voltage = Math.max(out2.voltage, vcc); out2.isSource = true; out2.driven = true; }
      if (out1 && out1.voltage === 0) out1.isGround = true;
    }
  }

  // --- propagate voltage & ground through 2-terminal resistors (series paths) ---
  // Without this, a battery/GPIO -> resistor -> LED never lights the LED because
  // the resistor splits the connection into two separate nets.
  const resLinks = [];
  for (const n of nodes) {
    if (/^res-/.test(n.partId)) {
      const a = netOf(n.id, 'A');
      const b = netOf(n.id, 'B');
      if (a && b && a !== b) resLinks.push([a, b]);
    }
  }
  for (let guard = 0; guard < 60; guard++) {
    let changed = false;
    for (const [a, b] of resLinks) {
      const v = Math.max(a.voltage, b.voltage);
      if (a.voltage !== v) { a.voltage = v; changed = true; }
      if (b.voltage !== v) { b.voltage = v; changed = true; }
      const g = a.isGround || b.isGround;
      if (a.isGround !== g) { a.isGround = g; changed = true; }
      if (b.isGround !== g) { b.isGround = g; changed = true; }
    }
    if (!changed) break;
  }
  const warnings = [];
  const components = [];
  let totalCurrent = 0;
  const displayNames = numberedNodeNames(nodes); // "DC Motor 6V #1", "#2"…

  const hasSourceAnywhere = Object.values(netMap).some((n) => n.isSource);
  const hasResistorOnNet = (net) => net && net.pins.some((p) => p.partId.startsWith('res-'));

  for (const n of nodes) {
    const part = PART_BY_ID[n.partId];
    let active = false;
    let dir = 0; // motor direction: 1 = forward (+), -1 = reverse (−)
    let note = '';

    const pv = (pin) => netOf(n.id, pin)?.voltage ?? 0;
    const isGnd = (pin) => netOf(n.id, pin)?.isGround ?? false;

    switch (n.partId) {
      case 'led-5mm': {
        const aV = pv('A');
        active = aV >= 1.8 && (isGnd('K') || pv('K') < aV);
        if (active && !hasResistorOnNet(netOf(n.id, 'A')) && !hasResistorOnNet(netOf(n.id, 'K')) && aV >= 4) {
          warnings.push(`LED "${n.id}" has no current-limiting resistor (may burn out at ${aV} V).`);
        }
        note = active ? 'lit' : 'off';
        break;
      }
      case 'rgb-led': {
        const lit = ['R', 'G', 'B'].some((c) => pv(c) >= 1.8 && (isGnd('K') || pv('K') < pv(c)));
        active = lit;
        note = lit ? 'lit' : 'off';
        break;
      }
      case 'dc-motor':
      case 'pump-12v':
      case 'linear-actuator': {
        // forward = M+ energized with M- as return; reverse = the other way
        // (reverse was previously not detected at all — motor showed idle)
        const fwd = pv('M+') > 0 && isGnd('M-');
        const rev = pv('M-') > 0 && isGnd('M+');
        active = fwd || rev;
        dir = fwd ? 1 : rev ? -1 : 0;
        note = fwd ? 'spinning + (fwd)' : rev ? 'spinning − (rev)' : 'idle';
        break;
      }
      case 'buzzer':
      case 'speaker-8ohm':
      case 'solenoid':
      case 'vibration-motor':
        active = pv('+') > 0 && isGnd('-'); note = active ? 'active' : 'off'; break;
      case 'servo-sg90':
      case 'servo-mg996':
      case 'stepper-28byj':
        active = pv('VCC') > 0 && isGnd('GND'); note = active ? 'powered' : 'unpowered'; break;
      case 'relay-1ch': {
        const powered = pv('VCC') > 0 && isGnd('GND');
        active = powered && pv('IN') > 0;
        note = !powered ? 'unpowered' : active ? 'switched ON' : 'idle';
        break;
      }
      // pure passives / control parts that don't "draw" on their own
      case 'potentiometer':
      case 'transistor-2n2222':
      case 'mosfet-irf520':
      case 'push-button':
      case 'toggle-switch':
        note = '—'; break;
      default: {
        // generic device: powered if it has a VCC-like pin energized + a ground
        const vccPins = part.pins.filter((p) => ['VCC', '5V', '3V3', '+', 'IN+', 'M+'].includes(p));
        const gndPins = part.pins.filter((p) => isGroundName(p));
        if (vccPins.length) {
          const powered = vccPins.some((p) => pv(p) > 0);
          const grounded = gndPins.some((p) => isGnd(p));
          active = powered && grounded;
          note = active ? 'powered' : powered ? 'no ground' : 'unpowered';
        } else {
          note = '—';
        }
      }
    }

    if (active && DRAW[n.partId]) totalCurrent += DRAW[n.partId];
    components.push({ nodeId: n.id, partId: n.partId, name: displayNames[n.id] || part.name, active, note, dir });
  }

  // code-vs-wiring sanity: catching "wrong sketch loaded" — wired board pins
  // the code never touches mean the circuit can't possibly react.
  if (codeByNode) {
    for (const n of nodes) {
      if (!LOGIC_V[n.partId]) continue;
      const part = PART_BY_ID[n.partId];
      const wired = new Set();
      for (const w of wires) {
        if (w.from.node === n.id) wired.add(w.from.pin);
        if (w.to.node === n.id) wired.add(w.to.pin);
      }
      // signal pins only — power/ground wiring is not the code's job
      const signals = [...wired].filter((p) => !/^(5V|3V3|VIN|VBUS|VSYS|GND\d*|RESET|RUN|AREF|ADC_VREF|AGND|3V3_EN|\+|-)$/.test(p));
      if (!signals.length) continue;
      const code = codeByNode[n.id];
      if (!code || !code.trim()) {
        warnings.push(`${displayNames[n.id] || part.name} (${n.id}) has ${signals.length} wired signal pin(s) but no code — write a sketch in the Code panel.`);
        continue;
      }
      const driven = analyzeDrivenPins(n.partId, code);
      const used = new Set(Object.keys(driven));
      for (const st of Object.values(driven)) {
        if (st && typeof st === 'object' && st.gate) String(st.gate).split('|').forEach((p) => used.add(p));
      }
      const unused = signals.filter((p) => !used.has(p));
      if (unused.length === signals.length) {
        warnings.push(`${displayNames[n.id] || part.name} (${n.id}): its code never uses ANY wired pin (${unused.slice(0, 6).join(', ')}${unused.length > 6 ? '…' : ''}) — wrong sketch loaded? Generate one in the Code panel.`);
      } else if (unused.length) {
        warnings.push(`${displayNames[n.id] || part.name} (${n.id}): code never uses wired pin(s) ${unused.slice(0, 6).join(', ')}${unused.length > 6 ? '…' : ''}.`);
      }
    }
  }

  // global warnings
  for (const net of Object.values(netMap)) {
    if (net.short) warnings.push('Short circuit: a power rail is tied directly to ground.');
  }
  if (nodes.length > 0 && !hasSourceAnywhere) warnings.push('No power source connected (add a battery, regulator, or MCU supply pin).');

  const supplyVoltage = Math.max(0, ...Object.values(netMap).map((n) => n.voltage));
  const powerW = +(supplyVoltage * totalCurrent).toFixed(2);

  return {
    nets: Object.values(netMap),
    pinNet,
    netMap,
    components,
    warnings: [...new Set(warnings)],
    totals: {
      current: +totalCurrent.toFixed(3),
      voltage: supplyVoltage,
      powerW,
      sourceCount: Object.values(netMap).filter((n) => n.isSource).length,
      activeCount: components.filter((c) => c.active).length,
    },
  };
}

// Net visual role for canvas coloring.
export function netRole(net) {
  if (!net) return 'signal';
  if (net.short) return 'short';
  if (net.voltage > 0) return 'power';
  if (net.isGround) return 'ground';
  return 'signal';
}

// Hook: recompute when the circuit, the board code, or the blink clock changes.
export function useSimulation() {
  const nodes = useStore((s) => s.nodes);
  const wires = useStore((s) => s.wires);
  const simOn = useStore((s) => s.simOn);
  const codeByNode = useStore((s) => s.codeByNode);
  const simTick = useStore((s) => s.simTick);
  const inputs = useStore((s) => s.inputs);
  return useMemo(
    () => (simOn ? simulate(nodes, wires, { codeByNode, blinkPhase: simTick % 2 === 0, inputs }) : null),
    [nodes, wires, simOn, codeByNode, simTick, inputs]
  );
}
