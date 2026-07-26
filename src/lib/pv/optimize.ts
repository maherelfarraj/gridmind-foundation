// P-163 — Pure, deterministic layout optimization scenario engine.
// No IO, no randomness: the same input always yields the same candidates,
// which is what makes the scored comparison defensible in an engineering review.
import {
  arrangeBlocks,
  makeTable,
  pitchFromGcr,
  ringArea,
  type AlternativeParams,
  type AlternativeSiteConfig,
  type ArrangeResult,
  type PointM,
  type RingM,
} from "@/lib/pv/layout";

export const OPTIMIZATION_ENGINE_ID = "gridmind-layout-optimizer";
export const OPTIMIZATION_CALC_VERSION = "1.0.0";

export const OPTIMIZATION_METRICS = [
  "capacity",
  "grading",
  "cable_length",
  "road_length",
  "epc_cost",
  "energy_yield",
] as const;
export type OptimizationMetric = (typeof OPTIMIZATION_METRICS)[number];

/** Metrics where a bigger raw value is a better outcome. */
export const HIGHER_IS_BETTER: Record<OptimizationMetric, boolean> = {
  capacity: true,
  grading: false,
  cable_length: false,
  road_length: false,
  epc_cost: false,
  energy_yield: true,
};

export const METRIC_LABELS: Record<OptimizationMetric, string> = {
  capacity: "DC capacity",
  grading: "Grading volume",
  cable_length: "DC cable length",
  road_length: "Internal road length",
  epc_cost: "EPC cost",
  energy_yield: "Energy yield",
};

export const METRIC_UNITS: Record<OptimizationMetric, string> = {
  capacity: "kWp",
  grading: "m³",
  cable_length: "m",
  road_length: "m",
  epc_cost: "USD",
  energy_yield: "MWh/yr",
};

export type MetricWeights = Record<OptimizationMetric, number>;

export const SCENARIO_TYPES = [
  "max_capacity",
  "min_grading",
  "min_cable_length",
  "min_road_length",
  "lowest_epc_cost",
  "max_energy_yield",
  "balanced",
] as const;
export type LayoutScenarioType = (typeof SCENARIO_TYPES)[number];

export const SCENARIO_LABELS: Record<LayoutScenarioType, string> = {
  max_capacity: "Max capacity",
  min_grading: "Minimum grading",
  min_cable_length: "Minimum cable length",
  min_road_length: "Minimum road length",
  lowest_epc_cost: "Lowest EPC cost",
  max_energy_yield: "Max energy yield",
  balanced: "Balanced",
};

function single(metric: OptimizationMetric): MetricWeights {
  return OPTIMIZATION_METRICS.reduce((acc, m) => {
    acc[m] = m === metric ? 1 : 0;
    return acc;
  }, {} as MetricWeights);
}

export const BALANCED_WEIGHTS: MetricWeights = {
  capacity: 0.2,
  grading: 0.15,
  cable_length: 0.15,
  road_length: 0.1,
  epc_cost: 0.2,
  energy_yield: 0.2,
};

export const SCENARIO_PRESETS: Record<LayoutScenarioType, MetricWeights> = {
  max_capacity: single("capacity"),
  min_grading: single("grading"),
  min_cable_length: single("cable_length"),
  min_road_length: single("road_length"),
  lowest_epc_cost: single("epc_cost"),
  max_energy_yield: single("energy_yield"),
  balanced: BALANCED_WEIGHTS,
};

export function presetWeights(scenario: LayoutScenarioType): MetricWeights {
  return { ...SCENARIO_PRESETS[scenario] };
}

/** Weights are valid when every key is known, non-negative and the sum is ≈ 1. */
export function weightsAreValid(weights: Partial<MetricWeights>, tolerance = 0.01): boolean {
  const keys = Object.keys(weights);
  if (keys.length !== OPTIMIZATION_METRICS.length) return false;
  let sum = 0;
  for (const key of keys) {
    if (!(OPTIMIZATION_METRICS as readonly string[]).includes(key)) return false;
    const value = weights[key as OptimizationMetric];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
    sum += value;
  }
  return Math.abs(sum - 1) <= tolerance;
}

/** Rescales arbitrary non-negative weights onto a sum of exactly 1. */
export function normalizeWeights(weights: MetricWeights): MetricWeights {
  const sum = OPTIMIZATION_METRICS.reduce((s, m) => s + Math.max(0, weights[m] ?? 0), 0);
  if (sum <= 0) return { ...BALANCED_WEIGHTS };
  return OPTIMIZATION_METRICS.reduce((acc, m) => {
    acc[m] = round6(Math.max(0, weights[m] ?? 0) / sum);
    return acc;
  }, {} as MetricWeights);
}

export interface UnitCosts {
  moduleUsdPerWp: number;
  structureUsdPerWp: number;
  bosUsdPerWp: number;
  gradingUsdPerM3: number;
  cableUsdPerM: number;
  roadUsdPerM: number;
}

export const DEFAULT_UNIT_COSTS: UnitCosts = {
  moduleUsdPerWp: 0.11,
  structureUsdPerWp: 0.08,
  bosUsdPerWp: 0.14,
  gradingUsdPerM3: 6,
  cableUsdPerM: 9,
  roadUsdPerM: 55,
};

export interface OptimizationSweep {
  gcrs: number[];
  azimuthsDeg: number[];
  roadEveryNRows: number[];
  /** Optional inverter-station placement strategies to sweep. */
  stationCounts?: number[];
}

export const DEFAULT_SWEEP: OptimizationSweep = {
  gcrs: [0.3, 0.35, 0.4, 0.45],
  azimuthsDeg: [180],
  roadEveryNRows: [4, 6, 8],
  stationCounts: [2],
};

export interface OptimizationConstraints {
  /** Structure slope tolerance; anything above needs grading. */
  maxSlopePct?: number;
  maxGradingM3?: number | null;
  minCapacityKwp?: number | null;
  maxEpcCostUsd?: number | null;
  /** Discard candidates whose compliance report fails. */
  requireCompliance?: boolean;
}

export interface YieldReference {
  /** Site specific yield at the reference GCR, kWh per kWp per year. */
  specificYieldKwhPerKwp: number;
  referenceGcr: number;
  /** Yield penalty per +0.01 GCR above the reference, in percent. */
  shadingPenaltyPctPerGcrPoint: number;
}

export const DEFAULT_YIELD_REFERENCE: YieldReference = {
  specificYieldKwhPerKwp: 1750,
  referenceGcr: 0.35,
  shadingPenaltyPctPerGcrPoint: 0.35,
};

export interface OptimizationInput {
  site: AlternativeSiteConfig;
  base: AlternativeParams;
  sweep?: OptimizationSweep;
  costs?: UnitCosts;
  yieldRef?: YieldReference;
  constraints?: OptimizationConstraints;
  weights: MetricWeights;
  maxCandidates?: number;
}

export type CandidateMetrics = Record<OptimizationMetric, number>;

export interface OptimizationCandidate {
  index: number;
  label: string;
  params: AlternativeParams;
  pitchM: number;
  metrics: CandidateMetrics;
  normalized: CandidateMetrics;
  score: number;
  compliance: { status: string; warnings: number; failures: number };
  tableCount: number;
  moduleCount: number;
  achievedGcr: number;
  excludedReason?: string;
}

export interface OptimizationResults {
  engine_id: string;
  calc_version: string;
  weights: MetricWeights;
  candidates: OptimizationCandidate[];
  winner_index: number | null;
  candidate_count: number;
  excluded_count: number;
  costs: UnitCosts;
  yield_reference: YieldReference;
  constraints: OptimizationConstraints;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function centroid(ring: RingM): PointM {
  if (ring.length === 0) return { x: 0, y: 0 };
  const sx = ring.reduce((s, p) => s + p.x, 0);
  const sy = ring.reduce((s, p) => s + p.y, 0);
  return { x: sx / ring.length, y: sy / ring.length };
}

/**
 * Cut/fill proxy: each block that sits above the slope tolerance needs its
 * footprint levelled. Volume ≈ area × excess-slope × half the block run.
 */
export function gradingVolumeM3(result: ArrangeResult, maxSlopePct: number): number {
  let total = 0;
  for (const block of result.blocks) {
    if (block.type === "setback") continue;
    const slope = block.slopePct;
    if (slope === undefined || slope === null) continue;
    const excess = Math.max(0, Math.abs(slope) - maxSlopePct) / 100;
    if (excess <= 0) continue;
    const area = ringArea(block.polygon);
    total += area * excess * (Math.sqrt(area) / 4);
  }
  return round2(total);
}

/** DC cable proxy: Manhattan run from every array table to its nearest station. */
export function cableLengthM(result: ArrangeResult): number {
  const stations = result.blocks
    .filter((b) => b.type === "inverter_station" || b.type === "equipment_pad")
    .map((b) => centroid(b.polygon));
  const fallback = [centroid(result.buildable)];
  const targets = stations.length > 0 ? stations : fallback;
  let total = 0;
  for (const block of result.blocks) {
    if (block.type !== "array_table") continue;
    const c = centroid(block.polygon);
    let best = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.x - c.x) + Math.abs(t.y - c.y);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) total += best;
  }
  return round2(total);
}

/** Road length derived from the generated road corridors and their width. */
export function roadLengthM(result: ArrangeResult, roadWidthM: number): number {
  if (roadWidthM <= 0) return 0;
  let total = 0;
  for (const block of result.blocks) {
    if (block.type !== "internal_road") continue;
    total += ringArea(block.polygon) / roadWidthM;
  }
  return round2(total);
}

export function epcCostUsd(
  dcKwp: number,
  grading: number,
  cable: number,
  road: number,
  costs: UnitCosts,
): number {
  const wp = dcKwp * 1000;
  const equipment = wp * (costs.moduleUsdPerWp + costs.structureUsdPerWp + costs.bosUsdPerWp);
  return round2(
    equipment + grading * costs.gradingUsdPerM3 + cable * costs.cableUsdPerM + road * costs.roadUsdPerM,
  );
}

/** Denser packing costs yield: linear shading derate above the reference GCR. */
export function energyYieldMwh(dcKwp: number, gcr: number, ref: YieldReference): number {
  const points = (gcr - ref.referenceGcr) * 100;
  const deratePct = Math.max(0, points) * ref.shadingPenaltyPctPerGcrPoint;
  const factor = Math.max(0, 1 - deratePct / 100);
  return round2((dcKwp * ref.specificYieldKwhPerKwp * factor) / 1000);
}

/** Min–max normalization; a single candidate always scores 1 on every metric. */
export function normalizeMetric(
  values: number[],
  value: number,
  higherIsBetter: boolean,
): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return 1;
  const unit = (value - min) / (max - min);
  return round6(higherIsBetter ? unit : 1 - unit);
}

function buildSweep(sweep: OptimizationSweep | undefined): OptimizationSweep {
  const s = sweep ?? DEFAULT_SWEEP;
  return {
    gcrs: s.gcrs.length > 0 ? s.gcrs : DEFAULT_SWEEP.gcrs,
    azimuthsDeg: s.azimuthsDeg.length > 0 ? s.azimuthsDeg : DEFAULT_SWEEP.azimuthsDeg,
    roadEveryNRows: s.roadEveryNRows.length > 0 ? s.roadEveryNRows : DEFAULT_SWEEP.roadEveryNRows,
    stationCounts: s.stationCounts && s.stationCounts.length > 0 ? s.stationCounts : [2],
  };
}

export interface CandidateBuild {
  candidate: OptimizationCandidate;
  result: ArrangeResult;
}

/** Arranges one parameter set and measures the six metrics on it. */
export function evaluateCandidate(
  site: AlternativeSiteConfig,
  params: AlternativeParams,
  index: number,
  costs: UnitCosts,
  yieldRef: YieldReference,
  constraints: OptimizationConstraints,
  stationCount: number,
): CandidateBuild {
  const table = makeTable({
    module: params.module,
    orientation: params.orientation,
    modulesAcross: params.modulesAcross,
    modulesUp: params.modulesUp,
    tiltDeg: params.tracker ? 0 : params.tiltDeg,
  });
  const pitchM = pitchFromGcr(table.collectorWidthM, params.gcr);
  const pads = (site.equipmentPads ?? []).length
    ? site.equipmentPads!
    : [
        {
          label: "Inverter station",
          widthM: 12,
          depthM: 6,
          count: stationCount,
          type: "inverter_station" as const,
        },
      ];
  const result = arrangeBlocks({
    boundary: site.boundary,
    exclusionZones: site.exclusionZones ?? [],
    table,
    moduleWp: params.moduleWp,
    pitchM,
    setbackM: params.setbackM,
    azimuthDeg: params.azimuthDeg,
    roadEveryNRows: params.roadEveryNRows,
    roadWidthM: params.roadWidthM,
    equipmentPads: pads,
    terrainRef: site.terrainRef ?? null,
  });

  const maxSlopePct = constraints.maxSlopePct ?? site.terrainRef?.slopeLimitPct ?? 8;
  const grading = gradingVolumeM3(result, maxSlopePct);
  const cable = cableLengthM(result);
  const road = roadLengthM(result, params.roadWidthM);
  const capacity = round2(result.metrics.dcKwp);
  const cost = epcCostUsd(capacity, grading, cable, road, costs);
  const yieldMwh = energyYieldMwh(capacity, params.gcr, yieldRef);

  const metrics: CandidateMetrics = {
    capacity,
    grading,
    cable_length: cable,
    road_length: road,
    epc_cost: cost,
    energy_yield: yieldMwh,
  };

  const zero = OPTIMIZATION_METRICS.reduce((acc, m) => {
    acc[m] = 0;
    return acc;
  }, {} as CandidateMetrics);

  return {
    result,
    candidate: {
      index,
      label: `C${index + 1} · GCR ${params.gcr.toFixed(2)} · ${params.azimuthDeg}° · road/${params.roadEveryNRows}`,
      params,
      pitchM: round6(pitchM),
      metrics,
      normalized: zero,
      score: 0,
      compliance: {
        status: result.compliance.status,
        warnings: result.compliance.warningCount,
        failures: result.compliance.failureCount,
      },
      tableCount: result.metrics.tableCount,
      moduleCount: result.metrics.moduleCount,
      achievedGcr: result.metrics.achievedGcr,
    },
  };
}

function violatesConstraints(
  metrics: CandidateMetrics,
  compliance: { failures: number },
  constraints: OptimizationConstraints,
): string | null {
  if (constraints.requireCompliance && compliance.failures > 0) return "compliance_failed";
  if (constraints.maxGradingM3 != null && metrics.grading > constraints.maxGradingM3)
    return "grading_over_limit";
  if (constraints.minCapacityKwp != null && metrics.capacity < constraints.minCapacityKwp)
    return "capacity_under_minimum";
  if (constraints.maxEpcCostUsd != null && metrics.epc_cost > constraints.maxEpcCostUsd)
    return "cost_over_budget";
  return null;
}

/**
 * Sweeps the parameter space, scores every surviving candidate against the
 * weighted six-metric model and returns the full comparison payload.
 */
export function runLayoutOptimizationEngine(input: OptimizationInput): OptimizationResults {
  const sweep = buildSweep(input.sweep);
  const costs = input.costs ?? DEFAULT_UNIT_COSTS;
  const yieldRef = input.yieldRef ?? DEFAULT_YIELD_REFERENCE;
  const constraints = input.constraints ?? {};
  const weights = normalizeWeights(input.weights);
  const maxCandidates = Math.max(1, Math.min(input.maxCandidates ?? 24, 48));

  const builds: CandidateBuild[] = [];
  let index = 0;
  for (const gcr of sweep.gcrs) {
    for (const azimuthDeg of sweep.azimuthsDeg) {
      for (const roadEveryNRows of sweep.roadEveryNRows) {
        for (const stationCount of sweep.stationCounts ?? [2]) {
          if (builds.length >= maxCandidates) break;
          const params: AlternativeParams = {
            ...input.base,
            gcr,
            azimuthDeg,
            roadEveryNRows,
          };
          builds.push(
            evaluateCandidate(
              input.site,
              params,
              index++,
              costs,
              yieldRef,
              constraints,
              stationCount,
            ),
          );
        }
      }
    }
  }

  const kept: OptimizationCandidate[] = [];
  const excluded: OptimizationCandidate[] = [];
  for (const build of builds) {
    const reason = violatesConstraints(
      build.candidate.metrics,
      build.candidate.compliance,
      constraints,
    );
    if (reason) excluded.push({ ...build.candidate, excludedReason: reason });
    else kept.push(build.candidate);
  }

  const scored = kept.length > 0 ? kept : excluded;
  for (const metric of OPTIMIZATION_METRICS) {
    const values = scored.map((c) => c.metrics[metric]);
    for (const candidate of scored) {
      candidate.normalized[metric] = normalizeMetric(
        values,
        candidate.metrics[metric],
        HIGHER_IS_BETTER[metric],
      );
    }
  }
  for (const candidate of scored) {
    candidate.score = round6(
      OPTIMIZATION_METRICS.reduce((s, m) => s + weights[m] * candidate.normalized[m], 0),
    );
  }

  let winner: OptimizationCandidate | null = null;
  for (const candidate of scored) {
    if (candidate.excludedReason) continue;
    if (!winner || candidate.score > winner.score) winner = candidate;
  }

  const candidates = [...scored, ...(kept.length > 0 ? excluded : [])].sort(
    (a, b) => a.index - b.index,
  );

  return {
    engine_id: OPTIMIZATION_ENGINE_ID,
    calc_version: OPTIMIZATION_CALC_VERSION,
    weights,
    candidates,
    winner_index: winner ? winner.index : null,
    candidate_count: candidates.length,
    excluded_count: excluded.length,
    costs,
    yield_reference: yieldRef,
    constraints,
  };
}
