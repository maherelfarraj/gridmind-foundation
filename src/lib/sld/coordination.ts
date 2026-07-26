// P-143 — Pure electrical coordination checks for SLD drawings.
// No React / Supabase imports. Sizing math is REUSED from the P-055 calculators
// (evaluateSolarString / selectTransformer / selectCableSize) — never reimplemented.
import { selectCableSize } from "@/lib/calculators/cable";
import { evaluateSolarString } from "@/lib/calculators/solar-string";
import { selectTransformer } from "@/lib/calculators/transformer";

import {
  buildGraph,
  reachableFrom,
  type ConnEdge,
  type ConnGraph,
  type ConnObject,
  type ConnSymbolMeta,
  type IssueSeverity,
} from "./connectivity";

/** Every coordination result carries this disclaimer — studies land in Batch 19. */
export const COORDINATION_DISCLAIMER =
  "preliminary — verify with project studies (Batch 19)";

export type CoordinationCheckId =
  | "string_inverter"
  | "dc_ac_ratio"
  | "inverter_transformer"
  | "bess"
  | "transformer_loading"
  | "protection_references"
  | "cable_references";

export const COORDINATION_CHECK_LABELS: Record<CoordinationCheckId, string> = {
  string_inverter: "String / inverter matching",
  dc_ac_ratio: "DC/AC ratio",
  inverter_transformer: "Inverter / transformer matching",
  bess: "BESS coordination",
  transformer_loading: "Transformer loading",
  protection_references: "Protection references",
  cable_references: "Cable references",
};

export type CoordinationIssue = {
  check: CoordinationCheckId;
  severity: IssueSeverity | "info";
  code: string;
  objectIds: string[];
  connectionIds?: string[];
  message: string;
  /** Displayed values, e.g. { "DC/AC ratio": "1.42" }. */
  values?: Record<string, string>;
  /** Human-readable formula, rendered in the UI tooltip. */
  formula?: string;
  note: string;
};

export type ProtectionReferenceRow = {
  objectId: string;
  tag: string | null;
  deviceType: string;
  ratedCurrentA: number | null;
  breakingKa: number | null;
  ansiFunctions: string | null;
  protectedTags: string[];
  protectedObjectIds: string[];
};

export type CableReferenceRow = {
  connectionId: string;
  cableNumber: string | null;
  fromTag: string | null;
  toTag: string | null;
  currentA: number | null;
  lengthM: number | null;
  voltageV: number | null;
  declaredMm2: number | null;
  standardMm2: number | null;
  voltageDropPct: number | null;
  verify: boolean;
};

export type CoordinationSnapshot = {
  ran_at: string;
  issue_count: number;
  error_count: number;
  warning_count: number;
  info_count: number;
  issues: CoordinationIssue[];
  protection_references: ProtectionReferenceRow[];
  cable_references: CableReferenceRow[];
  note: string;
};

export type CoordinationOptions = {
  /** Bounds from project_pv_config; defaults 1.0 – 1.6. */
  dcAcMin?: number;
  dcAcMax?: number;
  /** Record cold / hot temperatures for the Voc/Vmp correction. */
  minTempC?: number;
  maxTempC?: number;
  /** Load growth factor applied to transformer loading (e.g. 1.1 = +10%). */
  growthFactor?: number;
  /** Transformer target nameplate loading (%), fed to selectTransformer. */
  transformerTargetLoadingPct?: number;
  /** Cable voltage-drop budget (%). */
  maxCableDropPct?: number;
};

const DEFAULTS = {
  dcAcMin: 1.0,
  dcAcMax: 1.6,
  minTempC: -10,
  maxTempC: 70,
  growthFactor: 1,
  transformerTargetLoadingPct: 80,
  maxCableDropPct: 3,
};

const INVERTER_TYPES = new Set(["inverter", "pcs"]);
const TRANSFORMER_TYPES = new Set(["transformer", "aux_transformer"]);
const PROTECTION_TYPES = new Set([
  "circuit_breaker",
  "fuse",
  "protection_relay",
  "disconnector",
]);
const BESS_TYPES = new Set(["bess_rack", "battery_container"]);
const NON_POWER = new Set(["earth", "signal"]);

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** First finite value among the given property aliases. */
export function propOf(obj: ConnObject | undefined, ...keys: string[]): number | null {
  const bag = (obj?.properties ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = num(bag[k]);
    if (v !== null) return v;
  }
  return null;
}

function textProp(obj: ConnObject | undefined, key: string): string | null {
  const v = (obj?.properties as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function edgePropOf(edge: ConnEdge, ...keys: string[]): number | null {
  const bag = (edge.properties ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = num(bag[k]);
    if (v !== null) return v;
  }
  return null;
}

function label(obj: ConnObject | undefined): string {
  return obj?.tag ?? obj?.symbol_type ?? "object";
}

function round(n: number, dp = 2): number {
  return Number(n.toFixed(dp));
}

function issue(
  check: CoordinationCheckId,
  severity: CoordinationIssue["severity"],
  code: string,
  objectIds: string[],
  message: string,
  extra: Partial<Pick<CoordinationIssue, "values" | "formula" | "connectionIds">> = {},
): CoordinationIssue {
  return { check, severity, code, objectIds, message, note: COORDINATION_DISCLAIMER, ...extra };
}

/** Power rating of an inverter/PCS in kW, tolerating both property spellings. */
export function inverterKw(obj: ConnObject): number | null {
  return propOf(obj, "rated_power_kw", "rating_kw", "ac_power_kw");
}

/** PV kWp attached (directly or through combiners) to a given inverter. */
function pvKwpFor(graph: ConnGraph, inverterId: string): { kwp: number; sources: string[] } {
  const reached = reachableFrom(graph, inverterId, (id) => {
    const o = graph.objects.get(id);
    return Boolean(o && (INVERTER_TYPES.has(o.symbol_type) || TRANSFORMER_TYPES.has(o.symbol_type)));
  });
  let kwp = 0;
  const sources: string[] = [];
  for (const id of reached) {
    const o = graph.objects.get(id);
    if (!o) continue;
    if (o.symbol_type === "pv_string") {
      const wp = propOf(o, "module_wp", "wp");
      const modules = propOf(o, "modules_in_series", "modules_per_string");
      const strings = propOf(o, "string_count") ?? 1;
      const direct = propOf(o, "kwp", "capacity_kwp");
      const value =
        direct !== null
          ? direct
          : wp !== null && modules !== null
            ? (wp * modules * strings) / 1000
            : null;
      if (value !== null && value > 0) {
        kwp += value;
        sources.push(id);
      }
    } else if (o.symbol_type === "pv_module") {
      const wp = propOf(o, "wp");
      const count = propOf(o, "count") ?? 1;
      if (wp !== null) {
        kwp += (wp * count) / 1000;
        sources.push(id);
      }
    }
  }
  return { kwp: round(kwp, 3), sources };
}

// ---------------------------------------------------------------------------
// checkStringInverter
// ---------------------------------------------------------------------------

/** String ↔ inverter matching: cold Voc, MPPT window, strings per MPPT. */
export function checkStringInverter(
  objects: ConnObject[],
  connections: ConnEdge[],
  options: CoordinationOptions = {},
): CoordinationIssue[] {
  const opts = { ...DEFAULTS, ...options };
  const graph = buildGraph(objects, connections);
  const issues: CoordinationIssue[] = [];

  for (const inv of objects) {
    if (!INVERTER_TYPES.has(inv.symbol_type)) continue;
    const maxDc = propOf(inv, "max_dc_voltage_v", "max_dc_v");
    const mpptMin = propOf(inv, "mppt_min_v", "mppt_min_vdc") ?? 0;
    const mpptMax = propOf(inv, "mppt_max_v", "mppt_max_vdc") ?? maxDc ?? 0;
    const mpptCount = propOf(inv, "mppt_count");

    const strings = [...(graph.adjacency.get(inv.id) ?? [])]
      .map((id) => graph.objects.get(id))
      .filter((o): o is ConnObject => Boolean(o) && o!.symbol_type === "pv_string");

    if (mpptCount !== null && mpptCount > 0 && strings.length > mpptCount) {
      issues.push(
        issue(
          "string_inverter",
          "warning",
          "strings_exceed_mppt",
          [inv.id, ...strings.map((s) => s.id)],
          `${label(inv)} has ${strings.length} strings on ${mpptCount} MPPT inputs.`,
          {
            values: { Strings: String(strings.length), MPPTs: String(mpptCount) },
            formula: "strings connected ≤ mppt_count",
          },
        ),
      );
    }

    if (maxDc === null) continue;

    for (const str of strings) {
      const modulesPerString = propOf(str, "modules_in_series", "modules_per_string");
      const moduleVoc = propOf(str, "module_voc_v", "voc_v");
      const moduleVmp = propOf(str, "module_vmp_v", "vmp_v");
      const coeff = propOf(str, "temp_coeff_voc_pct_per_c") ?? -0.28;
      if (modulesPerString === null || moduleVoc === null) continue;

      const result = evaluateSolarString({
        moduleVoc,
        moduleVmp: moduleVmp ?? moduleVoc * 0.8,
        tempCoeffVocPctPerC: coeff,
        minTempC: propOf(str, "min_temp_c") ?? opts.minTempC,
        maxTempC: propOf(str, "max_temp_c") ?? opts.maxTempC,
        inverterMaxVdc: maxDc,
        inverterMpptMinVdc: mpptMin,
        inverterMpptMaxVdc: mpptMax || maxDc,
        modulesPerString,
      });

      const values = {
        "String Voc at min temp": `${round(result.stringVocCold)} V`,
        "Inverter max DC": `${maxDc} V`,
        "String Vmp at max temp": `${round(result.stringVmpHot)} V`,
        "Max modules allowed": String(result.maxModulesForVocMax),
      };
      const formula =
        "Voc(cold) = Voc_stc × (1 + coeff/100 × (Tmin − 25)) × modules_in_series";

      if (result.reason === "voc_exceeds_inverter_max") {
        issues.push(
          issue(
            "string_inverter",
            "error",
            "voc_exceeds_inverter_max",
            [str.id, inv.id],
            `${label(str)} cold Voc ${round(result.stringVocCold)} V exceeds ${label(inv)} max DC ${maxDc} V.`,
            { values, formula },
          ),
        );
      } else if (result.reason === "vmp_below_mppt_min") {
        issues.push(
          issue(
            "string_inverter",
            "warning",
            "vmp_below_mppt_min",
            [str.id, inv.id],
            `${label(str)} hot Vmp ${round(result.stringVmpHot)} V is below the ${mpptMin} V MPPT minimum.`,
            { values, formula },
          ),
        );
      } else if (result.reason === "vmp_above_mppt_max") {
        issues.push(
          issue(
            "string_inverter",
            "warning",
            "vmp_above_mppt_max",
            [str.id, inv.id],
            `${label(str)} hot Vmp ${round(result.stringVmpHot)} V is above the ${mpptMax} V MPPT maximum.`,
            { values, formula },
          ),
        );
      } else {
        issues.push(
          issue(
            "string_inverter",
            "info",
            "string_ok",
            [str.id, inv.id],
            `${label(str)} matches ${label(inv)} across the temperature range.`,
            { values, formula },
          ),
        );
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// checkDcAcRatio
// ---------------------------------------------------------------------------

/** Per-inverter and plant-wide DC/AC ratio. */
export function checkDcAcRatio(
  objects: ConnObject[],
  connections: ConnEdge[] = [],
  options: CoordinationOptions = {},
): CoordinationIssue[] {
  const opts = { ...DEFAULTS, ...options };
  const graph = buildGraph(objects, connections);
  const issues: CoordinationIssue[] = [];
  const formula = "DC/AC = Σ PV kWp ÷ inverter kWac";

  let plantKwp = 0;
  let plantKwac = 0;
  const inverterIds: string[] = [];

  for (const inv of objects) {
    if (!INVERTER_TYPES.has(inv.symbol_type)) continue;
    const kwac = inverterKw(inv);
    if (kwac === null || kwac <= 0) continue;
    inverterIds.push(inv.id);
    plantKwac += kwac;

    const { kwp, sources } = pvKwpFor(graph, inv.id);
    plantKwp += kwp;
    if (kwp <= 0) continue;

    const ratio = kwp / kwac;
    const values = {
      "DC/AC ratio": ratio.toFixed(2),
      "PV kWp": String(round(kwp, 1)),
      "Inverter kWac": String(round(kwac, 1)),
    };
    const outside = ratio < opts.dcAcMin || ratio > opts.dcAcMax;
    issues.push(
      issue(
        "dc_ac_ratio",
        outside ? "warning" : "info",
        outside ? "dc_ac_out_of_range" : "dc_ac_in_range",
        [inv.id, ...sources],
        outside
          ? `${label(inv)} DC/AC ratio ${ratio.toFixed(2)} is outside ${opts.dcAcMin.toFixed(2)}–${opts.dcAcMax.toFixed(2)}.`
          : `${label(inv)} DC/AC ratio ${ratio.toFixed(2)}.`,
        { values, formula },
      ),
    );
  }

  if (plantKwac > 0 && plantKwp > 0) {
    const ratio = plantKwp / plantKwac;
    const outside = ratio < opts.dcAcMin || ratio > opts.dcAcMax;
    issues.push(
      issue(
        "dc_ac_ratio",
        outside ? "warning" : "info",
        outside ? "plant_dc_ac_out_of_range" : "plant_dc_ac_in_range",
        inverterIds,
        `Plant-wide DC/AC ratio ${ratio.toFixed(2)}${
          outside ? ` is outside ${opts.dcAcMin.toFixed(2)}–${opts.dcAcMax.toFixed(2)}` : ""
        }.`,
        {
          values: {
            "DC/AC ratio": ratio.toFixed(2),
            "Plant kWp": String(round(plantKwp, 1)),
            "Plant kWac": String(round(plantKwac, 1)),
          },
          formula,
        },
      ),
    );
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Transformer helpers
// ---------------------------------------------------------------------------

type TransformerLoad = {
  transformer: ConnObject;
  inverters: ConnObject[];
  loadKw: number;
  nameplateKva: number | null;
};

/** Inverters/PCS electrically downstream of each transformer. */
export function transformerLoads(graph: ConnGraph): TransformerLoad[] {
  const out: TransformerLoad[] = [];
  for (const t of graph.objects.values()) {
    if (!TRANSFORMER_TYPES.has(t.symbol_type)) continue;
    const downstream = reachableFrom(graph, t.id, (id) => {
      const o = graph.objects.get(id);
      return Boolean(o && TRANSFORMER_TYPES.has(o.symbol_type));
    });
    const inverters: ConnObject[] = [];
    let loadKw = 0;
    for (const id of downstream) {
      const o = graph.objects.get(id);
      if (!o || !INVERTER_TYPES.has(o.symbol_type)) continue;
      const kw = inverterKw(o);
      if (kw === null || kw <= 0) continue;
      inverters.push(o);
      loadKw += kw;
    }
    out.push({
      transformer: t,
      inverters,
      loadKw: round(loadKw, 3),
      nameplateKva: propOf(t, "rated_kva", "rating_kva") ?? (propOf(t, "rating_mva") ?? 0) * 1000 || null,
    });
  }
  return out;
}

/** Inverter ↔ transformer matching: loading vs sizing reference and LV match. */
export function checkInverterTransformer(
  objects: ConnObject[],
  connections: ConnEdge[],
  options: CoordinationOptions = {},
): CoordinationIssue[] {
  const opts = { ...DEFAULTS, ...options };
  const graph = buildGraph(objects, connections);
  const issues: CoordinationIssue[] = [];

  for (const load of transformerLoads(graph)) {
    const { transformer, inverters, loadKw, nameplateKva } = load;
    if (inverters.length === 0) continue;

    const pf = propOf(transformer, "power_factor") ?? 0.95;
    const sizing = selectTransformer({
      loadKw,
      powerFactor: pf,
      loadingPctTarget: opts.transformerTargetLoadingPct,
    });

    if (nameplateKva && nameplateKva > 0) {
      const loadingPct = (sizing.loadKva / nameplateKva) * 100;
      const values = {
        "Loading": `${loadingPct.toFixed(1)} %`,
        "Load kVA": String(round(sizing.loadKva, 1)),
        "Nameplate kVA": String(nameplateKva),
        "Suggested nameplate": `${sizing.nameplateKva} kVA`,
      };
      const formula = "loading % = (Σ inverter kW ÷ pf) ÷ nameplate kVA × 100";
      if (loadingPct > 100) {
        issues.push(
          issue(
            "inverter_transformer",
            "error",
            "transformer_overloaded",
            [transformer.id, ...inverters.map((i) => i.id)],
            `${label(transformer)} is loaded to ${loadingPct.toFixed(1)}% of its ${nameplateKva} kVA nameplate.`,
            { values, formula },
          ),
        );
      } else if (loadingPct > 90) {
        issues.push(
          issue(
            "inverter_transformer",
            "warning",
            "transformer_high_loading",
            [transformer.id, ...inverters.map((i) => i.id)],
            `${label(transformer)} is loaded to ${loadingPct.toFixed(1)}% — above the 90% planning threshold.`,
            { values, formula },
          ),
        );
      } else {
        issues.push(
          issue(
            "inverter_transformer",
            "info",
            "transformer_loading_ok",
            [transformer.id],
            `${label(transformer)} is loaded to ${loadingPct.toFixed(1)}%.`,
            { values, formula },
          ),
        );
      }
    } else {
      issues.push(
        issue(
          "inverter_transformer",
          "warning",
          "transformer_rating_missing",
          [transformer.id],
          `${label(transformer)} has no nameplate rating; ${sizing.nameplateKva} kVA would suit ${round(loadKw, 1)} kW.`,
          {
            values: { "Suggested nameplate": `${sizing.nameplateKva} kVA` },
            formula: "nameplate = next IEC size ≥ (kW ÷ pf) ÷ target loading",
          },
        ),
      );
    }

    // LV side voltage match against the inverters feeding it.
    const lvKv = propOf(transformer, "lv_kv");
    if (lvKv !== null && lvKv > 0) {
      for (const inv of inverters) {
        const invKv =
          propOf(inv, "ac_voltage_kv", "voltage_kv") ??
          (propOf(inv, "ac_voltage_v") ?? 0) / 1000 ||
          null;
        if (invKv === null || invKv <= 0) continue;
        if (Math.abs(invKv - lvKv) / Math.max(invKv, lvKv) > 0.05) {
          issues.push(
            issue(
              "inverter_transformer",
              "error",
              "lv_voltage_mismatch",
              [transformer.id, inv.id],
              `${label(inv)} AC output ${invKv} kV does not match ${label(transformer)} LV winding ${lvKv} kV.`,
              {
                values: { "Inverter AC": `${invKv} kV`, "Transformer LV": `${lvKv} kV` },
                formula: "|V_inv − V_lv| ÷ max(V) ≤ 5%",
              },
            ),
          );
        }
      }
    }
  }
  return issues;
}

/** Downstream kW aggregation per transformer including the growth factor. */
export function checkTransformerLoading(
  graph: ConnGraph,
  options: CoordinationOptions = {},
): CoordinationIssue[] {
  const opts = { ...DEFAULTS, ...options };
  const growth = opts.growthFactor > 0 ? opts.growthFactor : 1;
  const issues: CoordinationIssue[] = [];

  for (const { transformer, inverters, loadKw, nameplateKva } of transformerLoads(graph)) {
    if (inverters.length === 0 || !nameplateKva || nameplateKva <= 0) continue;
    const pf = propOf(transformer, "power_factor") ?? 0.95;
    const grownKva = (loadKw * growth) / pf;
    const loadingPct = (grownKva / nameplateKva) * 100;
    const values = {
      "Loading with growth": `${loadingPct.toFixed(1)} %`,
      "Growth factor": growth.toFixed(2),
      "Downstream kW": String(round(loadKw, 1)),
      "Nameplate kVA": String(nameplateKva),
    };
    const formula = "loading % = (Σ downstream kW × growth ÷ pf) ÷ nameplate kVA × 100";
    issues.push(
      issue(
        "transformer_loading",
        loadingPct > 100 ? "error" : loadingPct > 90 ? "warning" : "info",
        loadingPct > 100
          ? "growth_loading_exceeded"
          : loadingPct > 90
            ? "growth_loading_high"
            : "growth_loading_ok",
        [transformer.id],
        `${label(transformer)} reaches ${loadingPct.toFixed(1)}% loading at a ${growth.toFixed(2)}× growth factor.`,
        { values, formula },
      ),
    );
  }
  return issues;
}

// ---------------------------------------------------------------------------
// checkBess
// ---------------------------------------------------------------------------

/** BESS duration sanity, PCS power adequacy and aux/EMS presence. */
export function checkBess(
  objects: ConnObject[],
  connections: ConnEdge[],
  _options: CoordinationOptions = {},
): CoordinationIssue[] {
  const graph = buildGraph(objects, connections);
  const issues: CoordinationIssue[] = [];

  for (const bess of objects) {
    if (!BESS_TYPES.has(bess.symbol_type)) continue;
    const energyKwh = propOf(bess, "energy_kwh");
    const powerKw = propOf(bess, "power_kw");

    if (energyKwh !== null && powerKw !== null && powerKw > 0) {
      const duration = energyKwh / powerKw;
      const values = {
        Duration: `${duration.toFixed(2)} h`,
        Energy: `${energyKwh} kWh`,
        Power: `${powerKw} kW`,
      };
      const formula = "duration h = energy kWh ÷ power kW";
      if (duration < 0.25 || duration > 8) {
        issues.push(
          issue(
            "bess",
            "warning",
            "bess_duration_implausible",
            [bess.id],
            `${label(bess)} duration ${duration.toFixed(2)} h is outside the plausible 0.25–8 h range.`,
            { values, formula },
          ),
        );
      } else {
        issues.push(
          issue("bess", "info", "bess_duration_ok", [bess.id], `${label(bess)} duration ${duration.toFixed(2)} h.`, {
            values,
            formula,
          }),
        );
      }
    }

    const neighbours = [...(graph.adjacency.get(bess.id) ?? [])]
      .map((id) => graph.objects.get(id))
      .filter((o): o is ConnObject => Boolean(o));
    const pcsUnits = neighbours.filter((o) => o.symbol_type === "pcs");

    if (pcsUnits.length === 0) {
      issues.push(
        issue(
          "bess",
          "warning",
          "bess_no_pcs",
          [bess.id],
          `${label(bess)} has no PCS connection — auxiliary and EMS coordination cannot be assessed.`,
          { formula: "battery_container / bess_rack must connect to a pcs" },
        ),
      );
      continue;
    }

    const pcsKw = pcsUnits.reduce((sum, p) => sum + (inverterKw(p) ?? 0), 0);
    if (powerKw !== null && pcsKw > 0 && pcsKw < powerKw) {
      issues.push(
        issue(
          "bess",
          "warning",
          "pcs_under_rack_power",
          [bess.id, ...pcsUnits.map((p) => p.id)],
          `PCS capacity ${round(pcsKw, 1)} kW is below ${label(bess)} rack power ${powerKw} kW.`,
          {
            values: { "PCS kW": String(round(pcsKw, 1)), "Rack kW": String(powerKw) },
            formula: "Σ PCS kW ≥ battery power kW",
          },
        ),
      );
    }

    const hasEms = neighbours.some((o) => o.symbol_type === "ems" || o.symbol_type === "scada_gateway");
    if (!hasEms) {
      issues.push(
        issue(
          "bess",
          "warning",
          "bess_no_ems",
          [bess.id],
          `${label(bess)} has no EMS or SCADA gateway reference on this drawing.`,
        ),
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Reference tables (feed P-144 schedules)
// ---------------------------------------------------------------------------

/**
 * NOT a coordination study: pairs each protective device with the equipment it
 * protects, for the P-144 protection schedule.
 */
export function protectionReferences(
  objects: ConnObject[],
  connections: ConnEdge[],
): { rows: ProtectionReferenceRow[]; issues: CoordinationIssue[] } {
  const graph = buildGraph(objects, connections);
  const rows: ProtectionReferenceRow[] = [];
  const issues: CoordinationIssue[] = [];

  for (const dev of objects) {
    if (!PROTECTION_TYPES.has(dev.symbol_type)) continue;
    const protectedObjects = [...(graph.adjacency.get(dev.id) ?? [])]
      .map((id) => graph.objects.get(id))
      .filter((o): o is ConnObject => Boolean(o));

    rows.push({
      objectId: dev.id,
      tag: dev.tag ?? null,
      deviceType: dev.symbol_type,
      ratedCurrentA: propOf(dev, "rated_current_a"),
      breakingKa: propOf(dev, "breaking_ka"),
      ansiFunctions: textProp(dev, "ansi_functions"),
      protectedTags: protectedObjects.map((o) => o.tag ?? o.symbol_type),
      protectedObjectIds: protectedObjects.map((o) => o.id),
    });

    if (protectedObjects.length < 2) {
      issues.push(
        issue(
          "protection_references",
          "warning",
          "protection_device_unpaired",
          [dev.id],
          `${label(dev)} has no upstream/downstream pair — protection schedule row is incomplete.`,
          { formula: "each protective device needs an upstream and a downstream device" },
        ),
      );
    }
  }
  return { rows, issues };
}

/** Cable reference rows via selectCableSize (P-055) — reference only. */
export function cableReferences(
  objects: ConnObject[],
  connections: ConnEdge[],
  options: CoordinationOptions = {},
): { rows: CableReferenceRow[]; issues: CoordinationIssue[] } {
  const opts = { ...DEFAULTS, ...options };
  const byId = new Map(objects.map((o) => [o.id, o]));
  const rows: CableReferenceRow[] = [];
  const issues: CoordinationIssue[] = [];

  for (const edge of connections) {
    if (NON_POWER.has(edge.connection_type)) continue;
    const currentA = edgePropOf(edge, "current_a", "load_a");
    const lengthM = edgePropOf(edge, "length_m");
    const voltageV =
      edgePropOf(edge, "voltage_v") ?? (edgePropOf(edge, "voltage_kv") ?? 0) * 1000 || null;
    const declaredMm2 = edgePropOf(edge, "size_mm2", "conductor_mm2");
    const from = byId.get(edge.from_object_id);
    const to = byId.get(edge.to_object_id);

    let standardMm2: number | null = null;
    let voltageDropPct: number | null = null;
    if (currentA !== null && lengthM !== null && voltageV !== null && voltageV > 0) {
      const sizing = selectCableSize({
        loadA: currentA,
        lengthM,
        voltageV,
        maxDropPct: opts.maxCableDropPct,
        phase: edge.connection_type === "dc_string" ? 1 : 3,
      });
      standardMm2 = sizing.sizeMm2;
      voltageDropPct = sizing.voltageDropPct;
    }

    const verify = standardMm2 !== null && declaredMm2 !== null && standardMm2 > declaredMm2;
    rows.push({
      connectionId: edge.id,
      cableNumber: edge.cable_number ?? null,
      fromTag: from?.tag ?? null,
      toTag: to?.tag ?? null,
      currentA,
      lengthM,
      voltageV,
      declaredMm2,
      standardMm2,
      voltageDropPct,
      verify,
    });

    if (verify) {
      issues.push(
        issue(
          "cable_references",
          "warning",
          "cable_size_below_reference",
          [edge.from_object_id, edge.to_object_id],
          `Verify cable size — reference only: ${edge.cable_number ?? "cable"} declares ${declaredMm2} mm² but ${standardMm2} mm² is indicated.`,
          {
            connectionIds: [edge.id],
            values: {
              Declared: `${declaredMm2} mm²`,
              Reference: `${standardMm2} mm²`,
              "Voltage drop": `${voltageDropPct?.toFixed(2)} %`,
            },
            formula: "smallest IEC 60228 size meeting ampacity and voltage-drop budget",
          },
        ),
      );
    }
  }
  return { rows, issues };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<CoordinationIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export function sortCoordinationIssues(issues: CoordinationIssue[]): CoordinationIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.check.localeCompare(b.check) ||
      a.code.localeCompare(b.code) ||
      (a.objectIds[0] ?? "").localeCompare(b.objectIds[0] ?? ""),
  );
}

/** Runs every coordination check and returns a persistable snapshot payload. */
export function runCoordination(
  objects: ConnObject[],
  connections: ConnEdge[],
  _symbolTypes: ConnSymbolMeta[] = [],
  options: CoordinationOptions = {},
): Omit<CoordinationSnapshot, "ran_at"> {
  const graph = buildGraph(objects, connections);
  const protection = protectionReferences(objects, connections);
  const cables = cableReferences(objects, connections, options);

  const issues = sortCoordinationIssues([
    ...checkStringInverter(objects, connections, options),
    ...checkDcAcRatio(objects, connections, options),
    ...checkInverterTransformer(objects, connections, options),
    ...checkBess(objects, connections, options),
    ...checkTransformerLoading(graph, options),
    ...protection.issues,
    ...cables.issues,
  ]);

  return {
    issue_count: issues.length,
    error_count: issues.filter((i) => i.severity === "error").length,
    warning_count: issues.filter((i) => i.severity === "warning").length,
    info_count: issues.filter((i) => i.severity === "info").length,
    issues,
    protection_references: protection.rows,
    cable_references: cables.rows,
    note: COORDINATION_DISCLAIMER,
  };
}
