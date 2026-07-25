// P-045 — Deterministic 8760-hour yield simulation stub.
//
// Engine ID: gridmind-stub-v1
//
// Pure, seeded, offline. No external calls, no Date.now(), no Math.random().
// Identical inputs → byte-identical outputs. Replaced by the real PVsyst
// import in Stage 2 (Engineering, P-056).

export const YIELD_ENGINE_ID = "gridmind-stub-v1";

export type Tracking = "fixed" | "single_axis";

export interface YieldLosses {
  soiling: number;
  temperature: number;
  mismatch: number;
  wiring: number;
  inverter: number;
  availability: number;
}

export interface ArrayConfig {
  dc_capacity_kw: number;
  ac_capacity_kw: number;
  tilt: number;
  azimuth: number;
  gcr: number;
  tracking: Tracking;
  latitude: number;
  module_w: number;
  inverter: string;
  losses: YieldLosses;
  degradation_y1_pct: number;
  p90_sigma: number;
}

export interface YieldResult {
  engine: string;
  computed_at: string;
  p50_kwh: number;
  p90_kwh: number;
  specific_yield_kwh_kwp: number;
  performance_ratio: number;
  monthly: number[]; // 12 entries, kWh per month
}

// ---------------------------------------------------------------------------
// PRNG + hash — pure functions
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sorted, rounded JSON so semantically-identical configs hash identically. */
function normalizeConfig(cfg: ArrayConfig): string {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const norm = {
    ac: round(cfg.ac_capacity_kw),
    az: round(cfg.azimuth),
    dc: round(cfg.dc_capacity_kw),
    deg: round(cfg.degradation_y1_pct),
    gcr: round(cfg.gcr),
    inv: cfg.inverter,
    lat: round(cfg.latitude),
    losses: {
      availability: round(cfg.losses.availability),
      inverter: round(cfg.losses.inverter),
      mismatch: round(cfg.losses.mismatch),
      soiling: round(cfg.losses.soiling),
      temperature: round(cfg.losses.temperature),
      wiring: round(cfg.losses.wiring),
    },
    module: round(cfg.module_w),
    sigma: round(cfg.p90_sigma),
    tilt: round(cfg.tilt),
    tracking: cfg.tracking,
  };
  return JSON.stringify(norm);
}

// ---------------------------------------------------------------------------
// Solar geometry (approximate NOAA-style)
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180;

function solarDeclination(dayOfYear: number): number {
  // Cooper's equation, in radians.
  return 23.45 * DEG * Math.sin((360 / 365) * (dayOfYear - 81) * DEG);
}

function daylightHours(latitudeRad: number, declinationRad: number): number {
  const cosH = -Math.tan(latitudeRad) * Math.tan(declinationRad);
  if (cosH >= 1) return 0; // polar night
  if (cosH <= -1) return 24; // polar day
  const H = Math.acos(cosH);
  return (2 * H * 12) / Math.PI;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function monthOfDay(dayOfYear: number): number {
  let d = dayOfYear;
  for (let m = 0; m < 12; m++) {
    if (d <= DAYS_IN_MONTH[m]) return m;
    d -= DAYS_IN_MONTH[m];
  }
  return 11;
}

// ---------------------------------------------------------------------------
// Simulate — pure, deterministic
// ---------------------------------------------------------------------------
export function simulateYield(cfg: ArrayConfig): Omit<YieldResult, "engine" | "computed_at"> {
  const seed = fnv1a(normalizeConfig(cfg));
  const rand = mulberry32(seed);

  // Monthly weather derates in [0.82, 1.00], drawn from the seeded PRNG so
  // location/config uniquely determine the pattern. Latitude nudges seasonal
  // shape (northern lats → summer boost, winter dip).
  const latRad = cfg.latitude * DEG;
  const monthlyDerate: number[] = [];
  for (let m = 0; m < 12; m++) {
    const base = 0.82 + rand() * 0.18;
    const seasonal =
      1 +
      0.06 *
        Math.sin(((m - 5) / 12) * 2 * Math.PI) *
        Math.sign(cfg.latitude || 1) *
        Math.min(Math.abs(latRad), 1);
    monthlyDerate.push(Math.max(0.82, Math.min(1.0, base * seasonal)));
  }

  const losses =
    cfg.losses.soiling +
    cfg.losses.temperature +
    cfg.losses.mismatch +
    cfg.losses.wiring +
    cfg.losses.inverter +
    cfg.losses.availability;
  // losses is a fraction sum (e.g. 0.02 + 0.03 + ...). Clip to sane band.
  const lossFactor = Math.max(0.4, 1 - Math.min(0.6, losses));
  const degFactor = 1 - Math.max(0, cfg.degradation_y1_pct) / 200; // half-year avg
  const trackingBoost = cfg.tracking === "single_axis" ? 1.18 : 1.0;
  const tiltFactor = 1 - 0.002 * Math.abs(cfg.tilt - Math.abs(cfg.latitude));
  const azimuthFactor = 1 - 0.001 * Math.min(90, Math.abs(180 - cfg.azimuth));
  const gcrFactor = 1 - 0.04 * Math.max(0, cfg.gcr - 0.5);

  const geoBoost = Math.max(0.6, tiltFactor * azimuthFactor * gcrFactor);

  // Reference clear-sky peak POA irradiance (kW/m²) — the bell curve peak.
  // We convert to kW output via a simple performance-index scaling so nameplate
  // × capacity factor lands in a plausible band.
  const monthly: number[] = new Array(12).fill(0);
  let annualKwh = 0;

  for (let day = 1; day <= 365; day++) {
    const decl = solarDeclination(day);
    const dayLen = daylightHours(latRad, decl);
    if (dayLen <= 0) continue;
    const sunrise = 12 - dayLen / 2;
    const sunset = 12 + dayLen / 2;
    const m = monthOfDay(day);
    const weather = monthlyDerate[m];

    // Peak POA irradiance ~ solar altitude at noon (cos zenith).
    const cosZenithNoon = Math.max(
      0,
      Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl),
    );
    const peakIrradiance = 1.0 * cosZenithNoon * trackingBoost; // kW/m² proxy

    for (let h = 0; h < 24; h++) {
      if (h < sunrise || h > sunset) continue;
      // Bell curve across daylight window
      const phase = ((h - sunrise) / dayLen) * Math.PI;
      const bell = Math.sin(phase);
      const irr = peakIrradiance * bell; // kW/m² proxy in [0, ~1]

      // DC power: nameplate × normalized irradiance × geometry × weather × loss × deg
      let dcKw = cfg.dc_capacity_kw * irr * geoBoost * weather * lossFactor * degFactor;
      if (dcKw < 0) dcKw = 0;
      if (dcKw > cfg.dc_capacity_kw) dcKw = cfg.dc_capacity_kw;

      // AC clipping
      const acKw = Math.min(dcKw, cfg.ac_capacity_kw);
      monthly[m] += acKw; // 1-hour steps → kWh
      annualKwh += acKw;
    }
  }

  const p50 = Math.round(annualKwh);
  const sigma = Math.max(0, Math.min(0.2, cfg.p90_sigma));
  const p90 = Math.round(p50 * (1 - 1.2816 * sigma));

  const specific = cfg.dc_capacity_kw > 0 ? p50 / cfg.dc_capacity_kw : 0;
  // Performance ratio = kWh_ac / (kWh_reference @ 1000 W/m² × dc_kw × sunHours)
  // Approx by the applied factor stack.
  const pr = Math.max(
    0,
    Math.min(
      1,
      geoBoost * lossFactor * degFactor * (monthlyDerate.reduce((s, v) => s + v, 0) / 12),
    ),
  );

  return {
    p50_kwh: p50,
    p90_kwh: p90,
    specific_yield_kwh_kwp: Math.round(specific * 10) / 10,
    performance_ratio: Math.round(pr * 1000) / 1000,
    monthly: monthly.map((v) => Math.round(v)),
  };
}
