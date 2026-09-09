// Physical material model — drives the 3D look of projected parts, the
// life-simulator thermal model, AND the engineering analysis.
//
// ── HONESTY CONTRACT ──────────────────────────────────────────────────────
// Every number here is a HANDBOOK TYPICAL value for the specific grade named
// in `grade`. They are not certified lot data, and real parts vary with
// temper, temperature, moisture, print orientation and infill. Any analysis
// built on them must report that provenance (see engineeringReport.js) rather
// than presenting a result as a certified figure.
//
// FDM-printed plastics are the sharpest caveat: a printed part is an
// anisotropic laminate, typically 40-80% of the bulk strength listed here in
// the Z (layer) direction. `printAnisotropy` records that Z-vs-XY factor so a
// consumer can refuse to make a strength claim it cannot support.
//
// Fields — thermal / visual (pre-existing):
//   density       g/cm³
//   specificHeat  J/(g·K)   — resistance to temperature change
//   conductivity  W/(m·K)   — how fast heat flows between touching parts
//   maxTempC      °C        — service limit; integrity starts degrading above
//   meltC         °C        — softens / melts / chars at this point
//   ignitionC     °C        — flammable materials catch fire here (null = none)
//   burn          0..1      — how vigorously it burns once ignited
//   toughness     0..1      — stylized sim resilience (NOT an engineering value)
//   metal         bool      — render hint (PBR metalness)
//
// Fields — structural / electrical (engineering analysis):
//   grade            what the numbers actually describe
//   youngsGPa        Young's modulus E, GPa
//   poisson          Poisson's ratio ν
//   yieldMPa         0.2% offset yield strength, MPa (null = brittle, no yield)
//   ultimateMPa      ultimate tensile strength, MPa
//   cteUmPerMK       linear thermal expansion, µm/(m·K)
//   elecConductivity electrical conductivity, S/m (insulators ~1e-14)
//   printAnisotropy  Z-direction strength as a fraction of XY (null = n/a)

import { PART_BY_ID } from '../data/parts.js';

export const MATERIALS = {
  pla: {
    name: 'PLA', color: '#e8e0d0', metal: false,
    density: 1.24, specificHeat: 1.80, conductivity: 0.13,
    maxTempC: 55, meltC: 160, ignitionC: 300, burn: 0.7, toughness: 0.40,
    grade: 'Generic PLA, injection-moulded bulk',
    youngsGPa: 3.5, poisson: 0.36, yieldMPa: 60, ultimateMPa: 60,
    cteUmPerMK: 68, elecConductivity: 1e-14, printAnisotropy: 0.50,
  },
  abs: {
    name: 'ABS', color: '#d9d2c5', metal: false,
    density: 1.05, specificHeat: 1.90, conductivity: 0.17,
    maxTempC: 90, meltC: 200, ignitionC: 400, burn: 0.8, toughness: 0.60,
    grade: 'Generic ABS, injection-moulded bulk',
    youngsGPa: 2.3, poisson: 0.35, yieldMPa: 43, ultimateMPa: 43,
    cteUmPerMK: 90, elecConductivity: 1e-14, printAnisotropy: 0.45,
  },
  petg: {
    name: 'PETG', color: '#cfd8dc', metal: false,
    density: 1.27, specificHeat: 1.95, conductivity: 0.20,
    maxTempC: 75, meltC: 250, ignitionC: 430, burn: 0.6, toughness: 0.70,
    grade: 'Generic PETG, injection-moulded bulk',
    youngsGPa: 2.1, poisson: 0.38, yieldMPa: 50, ultimateMPa: 50,
    cteUmPerMK: 68, elecConductivity: 1e-14, printAnisotropy: 0.60,
  },
  nylon: {
    name: 'Nylon', color: '#eceff1', metal: false,
    density: 1.15, specificHeat: 1.70, conductivity: 0.25,
    maxTempC: 150, meltC: 220, ignitionC: 450, burn: 0.5, toughness: 0.85,
    grade: 'PA12, dry-as-moulded (absorbs moisture — wet E drops ~40%)',
    youngsGPa: 1.7, poisson: 0.39, yieldMPa: 45, ultimateMPa: 48,
    cteUmPerMK: 100, elecConductivity: 1e-13, printAnisotropy: 0.70,
  },
  resin: {
    name: 'Resin (SLA)', color: '#b0bec5', metal: false,
    density: 1.18, specificHeat: 1.60, conductivity: 0.20,
    maxTempC: 65, meltC: 240, ignitionC: 360, burn: 0.6, toughness: 0.30,
    grade: 'Generic photopolymer, fully post-cured',
    youngsGPa: 2.8, poisson: 0.35, yieldMPa: null, ultimateMPa: 60,
    cteUmPerMK: 90, elecConductivity: 1e-14, printAnisotropy: 0.95,
  },
  fr4: {
    name: 'FR-4 PCB', color: '#15803d', metal: false,
    density: 1.85, specificHeat: 1.20, conductivity: 0.30,
    maxTempC: 130, meltC: 320, ignitionC: 520, burn: 0.3, toughness: 0.50,
    grade: 'FR-4 woven glass/epoxy laminate, in-plane (warp) direction',
    youngsGPa: 24, poisson: 0.136, yieldMPa: null, ultimateMPa: 310,
    cteUmPerMK: 16, elecConductivity: 1e-14, printAnisotropy: null,
  },
  silicon: {
    name: 'Silicon IC', color: '#222831', metal: false,
    density: 2.33, specificHeat: 0.71, conductivity: 1.00,
    maxTempC: 150, meltC: 1410, ignitionC: null, burn: 0, toughness: 0.30,
    grade: 'Single-crystal silicon (brittle — fractures with no yielding)',
    youngsGPa: 165, poisson: 0.22, yieldMPa: null, ultimateMPa: 165,
    cteUmPerMK: 2.6, elecConductivity: 4.35e-4, printAnisotropy: null,
  },
  rubber: {
    name: 'Rubber', color: '#2b2b2b', metal: false,
    density: 1.20, specificHeat: 1.70, conductivity: 0.16,
    maxTempC: 120, meltC: 300, ignitionC: 300, burn: 0.9, toughness: 0.88,
    grade: 'EPDM ~60 Shore A — HYPERELASTIC: linear E is a small-strain fiction',
    youngsGPa: 0.01, poisson: 0.49, yieldMPa: null, ultimateMPa: 15,
    cteUmPerMK: 200, elecConductivity: 1e-14, printAnisotropy: null,
  },
  glass: {
    name: 'Glass/Epoxy', color: '#a7d3d8', metal: false,
    density: 2.50, specificHeat: 0.84, conductivity: 1.00,
    maxTempC: 500, meltC: 1400, ignitionC: null, burn: 0, toughness: 0.20,
    grade: 'E-glass (brittle — tensile strength is flaw-dependent)',
    youngsGPa: 72, poisson: 0.22, yieldMPa: null, ultimateMPa: 50,
    cteUmPerMK: 9, elecConductivity: 1e-14, printAnisotropy: null,
  },
  aluminum: {
    name: 'Aluminum', color: '#c2c7cd', metal: true,
    density: 2.70, specificHeat: 0.90, conductivity: 237,
    maxTempC: 400, meltC: 660, ignitionC: null, burn: 0, toughness: 0.90,
    grade: '6061-T6 (properties vary strongly with alloy and temper)',
    youngsGPa: 68.9, poisson: 0.33, yieldMPa: 276, ultimateMPa: 310,
    cteUmPerMK: 23.6, elecConductivity: 2.5e7, printAnisotropy: null,
  },
  copper: {
    name: 'Copper', color: '#b87333', metal: true,
    density: 8.96, specificHeat: 0.39, conductivity: 400,
    maxTempC: 600, meltC: 1085, ignitionC: null, burn: 0, toughness: 0.80,
    grade: 'C11000 ETP, annealed (cold work raises yield sharply)',
    youngsGPa: 117, poisson: 0.34, yieldMPa: 70, ultimateMPa: 220,
    cteUmPerMK: 16.5, elecConductivity: 5.96e7, printAnisotropy: null,
  },
  steel: {
    name: 'Steel', color: '#9aa1ab', metal: true,
    density: 7.85, specificHeat: 0.49, conductivity: 50,
    maxTempC: 700, meltC: 1370, ignitionC: null, burn: 0, toughness: 1.00,
    grade: 'AISI 1018 mild steel, cold drawn',
    youngsGPa: 200, poisson: 0.29, yieldMPa: 370, ultimateMPa: 440,
    cteUmPerMK: 11.7, elecConductivity: 6.99e6, printAnisotropy: null,
  },
  titanium: {
    name: 'Titanium', color: '#8d8f94', metal: true,
    density: 4.51, specificHeat: 0.52, conductivity: 22,
    maxTempC: 900, meltC: 1668, ignitionC: null, burn: 0, toughness: 0.98,
    grade: 'Ti-6Al-4V (Grade 5), annealed',
    youngsGPa: 113.8, poisson: 0.342, yieldMPa: 880, ultimateMPa: 950,
    cteUmPerMK: 8.6, elecConductivity: 5.8e5, printAnisotropy: null,
  },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

// True when the material has every field a linear-elastic stress estimate
// needs. Brittle materials (yieldMPa null) are still usable — the caller must
// compare against ultimateMPa instead and say so.
export function hasStructuralData(key) {
  const m = MATERIALS[key];
  return Boolean(m && Number.isFinite(m.youngsGPa) && Number.isFinite(m.ultimateMPa) && Number.isFinite(m.poisson));
}

// The stress a safety factor should be measured against, plus which limit it
// is — callers must surface `basis` so "SF 2.1" is never ambiguous.
export function strengthLimit(key) {
  const m = MATERIALS[key];
  if (!m) return null;
  if (Number.isFinite(m.yieldMPa)) return { limitMPa: m.yieldMPa, basis: 'yield' };
  if (Number.isFinite(m.ultimateMPa)) return { limitMPa: m.ultimateMPa, basis: 'ultimate (brittle — no yield point)' };
  return null;
}
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
