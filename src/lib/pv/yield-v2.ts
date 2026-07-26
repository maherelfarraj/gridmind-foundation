// P-156 — GridMind transparent energy-yield engine v2.
// Pure and deterministic: no randomness, no wall-clock reads (computed_at is
// injected by the caller). Every loss step emits its formula, inputs and input
// sources so any number in the result can be explained to a lender.

export const YIELD_ENGINE_ID = "gridmind-yield-v2";
export const YIELD_CALC_VERSION = 2;
export const YIELD_DISCLAIMER =
  "GridMind transparent model — not yet validated against commercial tools.";

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Representative day-of-year per month (Klein), used for solar declination. */
export const REPRESENTATIVE_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344];

const DEG = Math.PI / 180;

/** Deterministic rounding — every emitted number passes through this. */
export function r3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export interface LossStep {
  /** 1-based position in the 16-step chain. */
  index: number;
  step: string;
  label: string;
  formula: string;
  inputs: Record<string, number | string | null>;
  input_sources: Record<string, string>;
  /** Loss applied by this step, in % of the energy entering the step. */
  loss_pct: number;
  /** Energy leaving this step, kWh/year. */
  energy_kwh: number;
  /** Energy leaving this step, kWh per month. */
  monthly_kwh: number[];
}

export interface TrackerConfig {
  type: "fixed" | "single_axis";
  /** Maximum rotation of a single-axis tracker, degrees. */
  maxAngleDeg?: number;
}

export interface BessConfig {
  /** Round-trip efficiency of the battery, %. */
  roundTripEffPct: number;
  /** Share of plant output cycled through the battery, 0..1. */
  throughputFraction: number;
  libraryId?: string | null;
}

export interface YieldInput {
  /** Site geometry. */
  latitudeDeg: number;
  tiltDeg: number;
  /** Array azimuth, degrees from true south (0 = equator-facing). */
  azimuthDeg: number;
  albedo?: number;
  tracker?: TrackerConfig | null;
  /** Ground coverage ratio used for the row-shading derate. */
  gcr: number;

  /** Monthly resource + weather, index 0 = January. */
  monthlyGhiKwhM2: number[];
  monthlyAmbientTempC: number[];
  monthlyDiffuseFraction?: number[] | null;
  monthlySoilingPct: number[];

  /** Plant sizing. */
  arrayDcKwp: number;
  inverterAcKw: number;

  /** Module electrical (library). */
  modulePmaxPctPerC: number;
  moduleNoctC: number;
  degradationYear1Pct: number;

  /** Electrical losses. */
  mismatchPct: number;
  /** Aggregate DC cable loss from the P-154 stringing design. */
  dcWiringLossPct: number;
  inverterEffCurve: Array<{ loadFraction: number; effPct: number }>;
  transformerLossPct: number;
  mvCollectionLossPct: number;
  gridAvailabilityPct: number;
  plantAvailabilityPct: number;
  /** Site grid export limit in kW (null = unconstrained). */
  gridLimitKw?: number | null;
  /** Auxiliary/parasitic consumption, kW continuous. */
  auxiliaryLoadKw: number;
  bess?: BessConfig | null;

  /** Interannual variability (σ) in %. Null → P-scenarios are not computed. */
  interannualVariabilitySigmaPct?: number | null;

  /** Mean daylight hours per day used for irradiance/peak shaping. */
  daylightHours?: number;
  /** Monthly-energy-to-peak-power shape factor used for clipping/curtailment. */
  loadShapeFactor?: number;

  /** Provenance labels: field name → where the value came from. */
  inputSources?: Record<string, string>;
  /** Injected timestamp — the engine never reads the clock. */
  computedAt: string;
}

export interface PScenarios {
  p50_kwh: number;
  p75_kwh: number | null;
  p90_kwh: number | null;
  p99_kwh: number | null;
  sigma_pct: number | null;
  formula: string;
  note: string | null;
}

export interface YieldResult {
  engine_id: string;
  calc_version: number;
  computed_at: string;
  disclaimer: string;
  monthly: Array<{
    month: number;
    poa_kwh_m2: number;
    energy_kwh: number;
    cell_temp_c: number;
  }>;
  annual: {
    poa_kwh_m2: number;
    energy_kwh: number;
    specific_yield_kwh_per_kwp: number;
    performance_ratio_pct: number;
    capacity_factor_pct: number;
    array_dc_kwp: number;
  };
  loss_chain: LossStep[];
  p_scenarios: PScenarios;
  warnings: Array<{ code: string; message: string }>;
}

function src(sources: Record<string, string> | undefined, key: string, fallback: string): string {
  return sources?.[key] ?? fallback;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Liu–Jordan monthly-average beam transposition factor Rb. */
export function beamTranspositionFactor(latDeg: number, tiltDeg: number, month: number): number {
  const phi = latDeg * DEG;
  const beta = tiltDeg * DEG;
  const n = REPRESENTATIVE_DAY[month];
  const delta = 23.45 * Math.sin(((360 * (284 + n)) / 365) * DEG) * DEG;
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta)));
  const wsTilt = Math.min(ws, Math.acos(clamp(-Math.tan(phi - beta) * Math.tan(delta))));
  const num =
    Math.cos(phi - beta) * Math.cos(delta) * Math.sin(wsTilt) +
    wsTilt * Math.sin(delta) * Math.sin(phi - beta);
  const den =
    Math.cos(phi) * Math.cos(delta) * Math.sin(ws) + ws * Math.sin(delta) * Math.sin(phi);
  if (den <= 0) return 0;
  return Math.max(0, num / den);
}

/** Piecewise-linear inverter efficiency lookup on the library curve. */
export function inverterEfficiencyAt(
  curve: Array<{ loadFraction: number; effPct: number }>,
  loadFraction: number,
): number {
  if (curve.length === 0) return 98;
  const pts = [...curve].sort((a, b) => a.loadFraction - b.loadFraction);
  if (loadFraction <= pts[0].loadFraction) return pts[0].effPct;
  const last = pts[pts.length - 1];
  if (loadFraction >= last.loadFraction) return last.effPct;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (loadFraction <= b.loadFraction) {
      const t = (loadFraction - a.loadFraction) / (b.loadFraction - a.loadFraction);
      return a.effPct + t * (b.effPct - a.effPct);
    }
  }
  return last.effPct;
}

/**
 * Runs the 16-step transparent loss chain.
 * Same inputs → byte-identical output.
 */
export function runYieldV2(input: YieldInput): YieldResult {
  const warnings: Array<{ code: string; message: string }> = [];
  const S = input.inputSources;
  const albedo = input.albedo ?? 0.2;
  const daylightHours = input.daylightHours ?? 12;
  const loadShape = input.loadShapeFactor ?? 0.6;
  const kwp = input.arrayDcKwp;
  const steps: LossStep[] = [];

  const push = (
    step: Omit<LossStep, "index" | "energy_kwh" | "monthly_kwh" | "loss_pct"> & {
      lossPct: number[];
    },
    before: number[],
  ): number[] => {
    const after = before.map((e, m) => e * (1 - step.lossPct[m] / 100));
    const beforeAnnual = sum(before);
    const afterAnnual = sum(after);
    steps.push({
      index: steps.length + 1,
      step: step.step,
      label: step.label,
      formula: step.formula,
      inputs: step.inputs,
      input_sources: step.input_sources,
      loss_pct: r3(beforeAnnual > 0 ? ((beforeAnnual - afterAnnual) / beforeAnnual) * 100 : 0),
      energy_kwh: r3(afterAnnual),
      monthly_kwh: after.map(r3),
    });
    return after;
  };

  // ---- Step 1: POA irradiance from GHI (transposition) -------------------
  const trackerGain =
    input.tracker && input.tracker.type === "single_axis"
      ? 1 + 0.25 * (1 - Math.min(0.9, input.gcr))
      : 1;
  const azDev = Math.abs(input.azimuthDeg);
  const azFactor = Math.max(0.5, Math.cos(azDev * DEG));
  const poa: number[] = [];
  const cellTemp: number[] = [];
  for (let m = 0; m < 12; m += 1) {
    const ghi = input.monthlyGhiKwhM2[m] ?? 0;
    const df = input.monthlyDiffuseFraction?.[m] ?? 0.25;
    const rb = beamTranspositionFactor(input.latitudeDeg, input.tiltDeg, m) * azFactor;
    const beta = input.tiltDeg * DEG;
    const value =
      ghi *
      ((1 - df) * rb +
        df * ((1 + Math.cos(beta)) / 2) +
        albedo * ((1 - Math.cos(beta)) / 2)) *
      trackerGain;
    poa.push(value);
  }
  const poaAnnual = sum(poa);

  let energy = poa.map((p) => p * kwp); // kWh at STC efficiency reference
  steps.push({
    index: 1,
    step: "poa_irradiance",
    label: "POA irradiance from GHI",
    formula:
      "POA = GHI · [(1−Df)·Rb + Df·(1+cosβ)/2 + ρ·(1−cosβ)/2] · tracker_gain; " +
      "Rb = Liu–Jordan monthly average, azimuth factor = max(0.5, cos(az)); " +
      "E_ref = POA · P_dc_stc",
    inputs: {
      tilt_deg: input.tiltDeg,
      azimuth_deg: input.azimuthDeg,
      albedo,
      tracker: input.tracker?.type ?? "fixed",
      tracker_gain: r3(trackerGain),
      gcr: input.gcr,
      ghi_annual_kwh_m2: r3(sum(input.monthlyGhiKwhM2)),
      poa_annual_kwh_m2: r3(poaAnnual),
      array_dc_kwp: kwp,
    },
    input_sources: {
      tilt_deg: src(S, "tilt_deg", "pv_site_configs"),
      azimuth_deg: src(S, "azimuth_deg", "pv_site_configs"),
      ghi: src(S, "ghi", "pv_site_configs.weather_source"),
      array_dc_kwp: src(S, "array_dc_kwp", "pv_layouts"),
      tracker: src(S, "tracker", "pv_site_configs"),
    },
    loss_pct: 0,
    energy_kwh: r3(sum(energy)),
    monthly_kwh: energy.map(r3),
  });

  // ---- Step 2: temperature ------------------------------------------------
  const tempLoss: number[] = [];
  for (let m = 0; m < 12; m += 1) {
    const meanIrrW = (poa[m] * 1000) / (DAYS_IN_MONTH[m] * daylightHours);
    const tcell = (input.monthlyAmbientTempC[m] ?? 25) + ((input.moduleNoctC - 20) / 800) * meanIrrW;
    cellTemp.push(tcell);
    tempLoss.push(Math.max(0, -input.modulePmaxPctPerC * (tcell - 25)));
  }
  energy = push(
    {
      step: "temperature",
      label: "Cell temperature loss",
      formula:
        "T_cell = T_amb + (NOCT−20)/800 · G_poa_mean; loss% = −γ_pmax · (T_cell − 25); " +
        "G_poa_mean = POA_month·1000/(days·daylight_hours)",
      inputs: {
        noct_c: input.moduleNoctC,
        pmax_pct_per_c: input.modulePmaxPctPerC,
        daylight_hours: daylightHours,
        mean_cell_temp_c: r3(sum(cellTemp) / 12),
      },
      input_sources: {
        noct_c: src(S, "noct_c", "pv_equipment_library.module"),
        pmax_pct_per_c: src(S, "pmax_pct_per_c", "pv_equipment_library.module"),
        ambient_temp: src(S, "ambient_temp", "pv_site_configs.weather_source"),
      },
      lossPct: tempLoss,
    },
    energy,
  );

  // ---- Step 3: soiling ----------------------------------------------------
  energy = push(
    {
      step: "soiling",
      label: "Soiling",
      formula: "E = E · (1 − soiling_month%/100), monthly soiling array from the site config",
      inputs: { soiling_annual_mean_pct: r3(sum(input.monthlySoilingPct) / 12) },
      input_sources: { soiling: src(S, "soiling", "pv_site_configs.loss_assumptions") },
      lossPct: input.monthlySoilingPct.map((v) => v ?? 0),
    },
    energy,
  );

  // ---- Step 4: shading (GCR derate) --------------------------------------
  const shadingPct = Math.max(0, 100 * (0.02 + 0.18 * Math.max(0, input.gcr - 0.3)));
  energy = push(
    {
      step: "shading",
      label: "Row-to-row shading",
      formula: "loss% = 100 · (0.02 + 0.18 · max(0, GCR − 0.30))",
      inputs: { gcr: input.gcr, loss_pct: r3(shadingPct) },
      input_sources: { gcr: src(S, "gcr", "pv_layouts.params") },
      lossPct: new Array(12).fill(shadingPct),
    },
    energy,
  );

  // ---- Step 5: mismatch ---------------------------------------------------
  energy = push(
    {
      step: "mismatch",
      label: "Module mismatch",
      formula: "E = E · (1 − mismatch%/100)",
      inputs: { mismatch_pct: input.mismatchPct },
      input_sources: { mismatch_pct: src(S, "mismatch_pct", "pv_site_configs.loss_assumptions") },
      lossPct: new Array(12).fill(input.mismatchPct),
    },
    energy,
  );

  // ---- Step 6: DC wiring --------------------------------------------------
  energy = push(
    {
      step: "dc_wiring",
      label: "DC wiring",
      formula: "E = E · (1 − Σ cable loss%/100) — aggregate of the P-154 string cable losses",
      inputs: { dc_wiring_loss_pct: input.dcWiringLossPct },
      input_sources: { dc_wiring_loss_pct: src(S, "dc_wiring_loss_pct", "pv_strings.cable") },
      lossPct: new Array(12).fill(input.dcWiringLossPct),
    },
    energy,
  );

  // ---- Step 7: inverter efficiency ---------------------------------------
  const invLoss = energy.map((e, m) => {
    const hours = DAYS_IN_MONTH[m] * daylightHours;
    const loadFraction = input.inverterAcKw > 0 ? e / hours / input.inverterAcKw : 0;
    return 100 - inverterEfficiencyAt(input.inverterEffCurve, Math.min(1, loadFraction));
  });
  energy = push(
    {
      step: "inverter",
      label: "Inverter conversion",
      formula:
        "load_fraction = E_month/(days·daylight_hours)/P_ac; η = piecewise-linear library curve; loss% = 100 − η",
      inputs: {
        inverter_ac_kw: input.inverterAcKw,
        curve_points: input.inverterEffCurve.length,
        mean_loss_pct: r3(sum(invLoss) / 12),
      },
      input_sources: {
        efficiency_curve: src(S, "efficiency_curve", "pv_equipment_library.inverter.electrical"),
        inverter_ac_kw: src(S, "inverter_ac_kw", "pv_equipment_library.inverter"),
      },
      lossPct: invLoss,
    },
    energy,
  );

  // ---- Step 8: clipping ---------------------------------------------------
  const clipLoss = energy.map((e, m) => {
    const cap = input.inverterAcKw * DAYS_IN_MONTH[m] * daylightHours * loadShape;
    return e > cap && e > 0 ? ((e - cap) / e) * 100 : 0;
  });
  energy = push(
    {
      step: "clipping",
      label: "Inverter AC clipping",
      formula: "cap_month = P_ac · days · daylight_hours · shape; loss% = max(0, (E−cap)/E)·100",
      inputs: { inverter_ac_kw: input.inverterAcKw, load_shape_factor: loadShape },
      input_sources: { inverter_ac_kw: src(S, "inverter_ac_kw", "pv_equipment_library.inverter") },
      lossPct: clipLoss,
    },
    energy,
  );

  // ---- Step 9: transformer -------------------------------------------------
  energy = push(
    {
      step: "transformer",
      label: "Transformer",
      formula: "E = E · (1 − transformer_loss%/100)",
      inputs: { transformer_loss_pct: input.transformerLossPct },
      input_sources: {
        transformer_loss_pct: src(S, "transformer_loss_pct", "pv_equipment_library.transformer"),
      },
      lossPct: new Array(12).fill(input.transformerLossPct),
    },
    energy,
  );

  // ---- Step 10: MV collection ---------------------------------------------
  energy = push(
    {
      step: "mv_collection",
      label: "MV collection network",
      formula: "E = E · (1 − mv_loss%/100)",
      inputs: { mv_collection_loss_pct: input.mvCollectionLossPct },
      input_sources: { mv_collection_loss_pct: src(S, "mv_collection_loss_pct", "pv_strings.mv") },
      lossPct: new Array(12).fill(input.mvCollectionLossPct),
    },
    energy,
  );

  // ---- Step 11: grid availability ------------------------------------------
  energy = push(
    {
      step: "grid_availability",
      label: "Grid availability",
      formula: "E = E · grid_availability%/100",
      inputs: { grid_availability_pct: input.gridAvailabilityPct },
      input_sources: {
        grid_availability_pct: src(S, "grid_availability_pct", "pv_site_configs.grid_limits"),
      },
      lossPct: new Array(12).fill(100 - input.gridAvailabilityPct),
    },
    energy,
  );

  // ---- Step 12: plant availability -----------------------------------------
  energy = push(
    {
      step: "plant_availability",
      label: "Plant availability",
      formula: "E = E · plant_availability%/100",
      inputs: { plant_availability_pct: input.plantAvailabilityPct },
      input_sources: {
        plant_availability_pct: src(S, "plant_availability_pct", "pv_site_configs.loss_assumptions"),
      },
      lossPct: new Array(12).fill(100 - input.plantAvailabilityPct),
    },
    energy,
  );

  // ---- Step 13: curtailment -------------------------------------------------
  const curtailLoss = energy.map((e, m) => {
    if (!input.gridLimitKw || input.gridLimitKw <= 0) return 0;
    const cap = input.gridLimitKw * DAYS_IN_MONTH[m] * daylightHours * loadShape;
    return e > cap && e > 0 ? ((e - cap) / e) * 100 : 0;
  });
  energy = push(
    {
      step: "curtailment",
      label: "Grid export curtailment",
      formula: "cap_month = P_grid_limit · days · daylight_hours · shape; loss% = max(0,(E−cap)/E)·100",
      inputs: { grid_limit_kw: input.gridLimitKw ?? null, load_shape_factor: loadShape },
      input_sources: { grid_limit_kw: src(S, "grid_limit_kw", "pv_site_configs.grid_limits") },
      lossPct: curtailLoss,
    },
    energy,
  );

  // ---- Step 14: year-1 degradation ------------------------------------------
  energy = push(
    {
      step: "degradation",
      label: "Year-1 degradation",
      formula: "E = E · (1 − degradation_year1%/100)",
      inputs: { degradation_year1_pct: input.degradationYear1Pct },
      input_sources: {
        degradation_year1_pct: src(S, "degradation_year1_pct", "pv_equipment_library.module"),
      },
      lossPct: new Array(12).fill(input.degradationYear1Pct),
    },
    energy,
  );

  // ---- Step 15: auxiliary consumption ---------------------------------------
  const auxLoss = energy.map((e, m) => {
    const aux = input.auxiliaryLoadKw * DAYS_IN_MONTH[m] * 24;
    return e > 0 ? Math.min(100, (aux / e) * 100) : 0;
  });
  energy = push(
    {
      step: "auxiliary",
      label: "Auxiliary consumption",
      formula: "aux_month = P_aux · days · 24; loss% = aux_month/E · 100",
      inputs: { auxiliary_load_kw: input.auxiliaryLoadKw },
      input_sources: { auxiliary_load_kw: src(S, "auxiliary_load_kw", "pv_site_configs") },
      lossPct: auxLoss,
    },
    energy,
  );

  // ---- Step 16: BESS round-trip ----------------------------------------------
  const bess = input.bess ?? null;
  const bessLoss = bess ? bess.throughputFraction * (100 - bess.roundTripEffPct) : 0;
  energy = push(
    {
      step: "bess_round_trip",
      label: "BESS round-trip",
      formula: "loss% = throughput_fraction · (100 − round_trip_efficiency%)",
      inputs: {
        round_trip_eff_pct: bess?.roundTripEffPct ?? null,
        throughput_fraction: bess?.throughputFraction ?? null,
        bess_library_id: bess?.libraryId ?? null,
      },
      input_sources: { bess: src(S, "bess", bess ? "project_bess_config" : "not_configured") },
      lossPct: new Array(12).fill(bessLoss),
    },
    energy,
  );

  const annual = sum(energy);
  const specificYield = kwp > 0 ? annual / kwp : 0;
  const pr = poaAnnual > 0 && kwp > 0 ? (annual / (poaAnnual * kwp)) * 100 : 0;
  const cf = kwp > 0 ? (annual / (kwp * 8760)) * 100 : 0;

  if (pr > 95) {
    warnings.push({ code: "pr_implausible", message: "Performance ratio above 95% — review inputs." });
  }

  const sigma = input.interannualVariabilitySigmaPct ?? null;
  let scenarios: PScenarios;
  if (sigma === null || !Number.isFinite(sigma)) {
    scenarios = {
      p50_kwh: r3(annual),
      p75_kwh: null,
      p90_kwh: null,
      p99_kwh: null,
      sigma_pct: null,
      formula: "P75 = P50·(1−0.675σ); P90 = P50·(1−1.282σ); P99 = P50·(1−2.326σ)",
      note: "insufficient_data — interannual variability σ was not provided.",
    };
    warnings.push({
      code: "insufficient_data",
      message: "P75/P90/P99 not computed — provide interannual variability σ.",
    });
  } else {
    const s = sigma / 100;
    const p75 = annual * (1 - 0.675 * s);
    const p90 = annual * (1 - 1.282 * s);
    const p99 = annual * (1 - 2.326 * s);
    // Ordering invariant P50 ≥ P75 ≥ P90 ≥ P99 enforced in code.
    const c75 = Math.min(annual, p75);
    const c90 = Math.min(c75, p90);
    const c99 = Math.min(c90, p99);
    scenarios = {
      p50_kwh: r3(annual),
      p75_kwh: r3(c75),
      p90_kwh: r3(c90),
      p99_kwh: r3(c99),
      sigma_pct: sigma,
      formula: "P75 = P50·(1−0.675σ); P90 = P50·(1−1.282σ); P99 = P50·(1−2.326σ)",
      note: null,
    };
  }

  return {
    engine_id: YIELD_ENGINE_ID,
    calc_version: YIELD_CALC_VERSION,
    computed_at: input.computedAt,
    disclaimer: YIELD_DISCLAIMER,
    monthly: energy.map((e, m) => ({
      month: m + 1,
      poa_kwh_m2: r3(poa[m]),
      energy_kwh: r3(e),
      cell_temp_c: r3(cellTemp[m]),
    })),
    annual: {
      poa_kwh_m2: r3(poaAnnual),
      energy_kwh: r3(annual),
      specific_yield_kwh_per_kwp: r3(specificYield),
      performance_ratio_pct: r3(pr),
      capacity_factor_pct: r3(cf),
      array_dc_kwp: kwp,
    },
    loss_chain: steps,
    p_scenarios: scenarios,
    warnings,
  };
}
