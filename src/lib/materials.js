// Physical material model — drives the 3D look of projected parts AND the
// life-simulator thermal/mechanical physics. Values are realistic (ordered and
// proportioned like the real world) though the sim integrates them in a
// stylized, stable way so results read clearly on a human timescale.
//
// Fields:
//   density       g/cm³
//   specificHeat  J/(g·K)   — resistance to temperature change
//   conductivity  W/(m·K)   — how fast heat flows between touching parts
//   maxTempC      °C        — service limit; integrity starts degrading above
//   meltC         °C        — softens / melts / chars at this point
//   ignitionC     °C        — flammable materials catch fire here (null = none)
//   burn          0..1      — how vigorously it burns once ignited
//   toughness     0..1      — structural resilience (slows integrity loss)
//   metal         bool      — render hint (PBR metalness)

import { PART_BY_ID } from '../data/parts.js';

export const MATERIALS = {
  pla:      { name: 'PLA',         color: '#e8e0d0', density: 1.24, specificHeat: 1.80, conductivity: 0.13, maxTempC: 55,   meltC: 160,  ignitionC: 300,  burn: 0.7, toughness: 0.40, metal: false },
  abs:      { name: 'ABS',         color: '#d9d2c5', density: 1.05, specificHeat: 1.90, conductivity: 0.17, maxTempC: 90,   meltC: 200,  ignitionC: 400,  burn: 0.8, toughness: 0.60, metal: false },
  petg:     { name: 'PETG',        color: '#cfd8dc', density: 1.27, specificHeat: 1.95, conductivity: 0.20, maxTempC: 75,   meltC: 250,  ignitionC: 430,  burn: 0.6, toughness: 0.70, metal: false },
  nylon:    { name: 'Nylon',       color: '#eceff1', density: 1.15, specificHeat: 1.70, conductivity: 0.25, maxTempC: 150,  meltC: 220,  ignitionC: 450,  burn: 0.5, toughness: 0.85, metal: false },
  resin:    { name: 'Resin (SLA)', color: '#b0bec5', density: 1.18, specificHeat: 1.60, conductivity: 0.20, maxTempC: 65,   meltC: 240,  ignitionC: 360,  burn: 0.6, toughness: 0.30, metal: false },
  fr4:      { name: 'FR-4 PCB',    color: '#15803d', density: 1.85, specificHeat: 1.20, conductivity: 0.30, maxTempC: 130,  meltC: 320,  ignitionC: 520,  burn: 0.3, toughness: 0.50, metal: false },
  silicon:  { name: 'Silicon IC',  color: '#222831', density: 2.33, specificHeat: 0.71, conductivity: 1.00, maxTempC: 150,  meltC: 1410, ignitionC: null, burn: 0,   toughness: 0.30, metal: false },
  rubber:   { name: 'Rubber',      color: '#2b2b2b', density: 1.20, specificHeat: 1.70, conductivity: 0.16, maxTempC: 120,  meltC: 300,  ignitionC: 300,  burn: 0.9, toughness: 0.88, metal: false },
  glass:    { name: 'Glass/Epoxy', color: '#a7d3d8', density: 2.50, specificHeat: 0.84, conductivity: 1.00, maxTempC: 500,  meltC: 1400, ignitionC: null, burn: 0,   toughness: 0.20, metal: false },
  aluminum: { name: 'Aluminum',    color: '#c2c7cd', density: 2.70, specificHeat: 0.90, conductivity: 237,  maxTempC: 400,  meltC: 660,  ignitionC: null, burn: 0,   toughness: 0.90, metal: true },
  copper:   { name: 'Copper',      color: '#b87333', density: 8.96, specificHeat: 0.39, conductivity: 400,  maxTempC: 600,  meltC: 1085, ignitionC: null, burn: 0,   toughness: 0.80, metal: true },
  steel:    { name: 'Steel',       color: '#9aa1ab', density: 7.85, specificHeat: 0.49, conductivity: 50,   maxTempC: 700,  meltC: 1370, ignitionC: null, burn: 0,   toughness: 1.00, metal: true },
  titanium: { name: 'Titanium',    color: '#8d8f94', density: 4.51, specificHeat: 0.52, conductivity: 22,   maxTempC: 900,  meltC: 1668, ignitionC: null, burn: 0,   toughness: 0.98, metal: true },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

// Parts whose dominant body material differs from their category default.
const PART_MATERIAL = {
  'stepper-nema17': 'steel', 'dc-motor': 'steel', 'pump-12v': 'steel',
  'linear-actuator': 'steel', 'solenoid': 'copper', 'vibration-motor': 'steel',
  'servo-mg996': 'aluminum', 'vreg-7805': 'aluminum', 'mosfet-irf520': 'aluminum',
  'transistor-2n2222': 'silicon',
  'led-5mm': 'glass', 'rgb-led': 'glass', 'oled-ssd1306': 'glass', 'lcd1602': 'glass',
  'crystal-16mhz': 'steel', 'fuse': 'glass',
  'battery-9v': 'steel', 'battery-aa': 'steel', 'coin-cell': 'steel',
};

const CATEGORY_MATERIAL = {
  Microcontrollers: 'fr4',
  Power: 'fr4',
  Drivers: 'fr4',
  Actuators: 'abs',
  Sensors: 'fr4',
  Inputs: 'abs',
  Passives: 'silicon',
  Output: 'abs',
};

export function partMaterialKey(partId) {
  if (PART_MATERIAL[partId]) return PART_MATERIAL[partId];
  const p = PART_BY_ID[partId];
  return CATEGORY_MATERIAL[p?.category] || 'abs';
}

// Returns { key, ...all material fields }.
export function partMaterial(partId) {
  const key = partMaterialKey(partId);
  return { key, ...MATERIALS[key] };
}
