// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-168 — Harmonics worksheet: THD/TDD arithmetic against a CONFIGURABLE limit table.
// The default rows are IEEE 519-style and are a screening aid only — no compliance claim.
// Pure module: no React, no Supabase, no route imports.
import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

import { z } from "zod";

export const HARMONICS_METHOD =
  "Each harmonic source is declared as a percentage of the fundamental current. Individual harmonic " +
  "currents are Ih = (magnitudePctOfFundamental/100)·I₁ with I₁ taken as the declared load current. " +
  "THD is √(ΣIh²)/I₁ and TDD is √(ΣIh²)/I_L with I_L the maximum demand load current. The short-circuit " +
  "ratio Isc/I_L selects a row from the limit table; Isc is derived from the declared POI short-circuit " +
  "level as Isc = S_sc/(√3·V). Background distortion is added arithmetically to the computed THD, which " +
  "is conservative. Exceedances are reported as WARNINGS for engineering review — this worksheet makes " +
  "no compliance claim against IEEE 519 or any other standard.";

export const harmonicLimitRowSchema = z.object({
  orderMin: z.number().int().min(2),
  orderMax: z.number().int().min(2),
  limitPct: z.number().positive(),
});
export type HarmonicLimitRow = z.infer<typeof harmonicLimitRowSchema>;

/** Default IEEE 519-style odd-order limits for Isc/I_L < 20 — editable per project. */
export const DEFAULT_HARMONIC_LIMITS: HarmonicLimitRow[] = [
  { orderMin: 2, orderMax: 10, limitPct: 4.0 },
  { orderMin: 11, orderMax: 16, limitPct: 2.0 },
  { orderMin: 17, orderMax: 22, limitPct: 1.5 },
  { orderMin: 23, orderMax: 34, limitPct: 0.6 },
  { orderMin: 35, orderMax: 100, limitPct: 0.3 },
];

export const DEFAULT_TDD_LIMIT_PCT = 5.0;

export const harmonicsInputSchema = z.object({
  sources: z
    .array(
      z.object({
        order: z.number().int().min(2).max(100),
        magnitudePctOfFundamental: z.number().min(0).max(100),
        label: z.string().default(""),
      }),
    )
    .min(1),
  backgroundThdPct: z.number().min(0).max(100).default(0),
  sccMvaAtPoi: z.number().positive(),
  loadCurrentA: z.number().positive(),
  nominalVoltageKv: z.number().positive().default(33),
  limits: z.array(harmonicLimitRowSchema).default(DEFAULT_HARMONIC_LIMITS),
  tddLimitPct: z.number().positive().default(DEFAULT_TDD_LIMIT_PCT),
});

export type HarmonicsInput = z.infer<typeof harmonicsInputSchema>;

export type HarmonicOrderResult = {
  order: number;
  label: string;
  currentA: number;
  distortionPct: number;
  limitPct: number | null;
  exceeds: boolean;
};

export type HarmonicsResults = {
  inputSheet: HarmonicsInput;
  orders: HarmonicOrderResult[];
  harmonicRmsA: number;
  thdPct: number;
  thdWithBackgroundPct: number;
  tddPct: number;
  tddLimitPct: number;
  iscA: number;
  iscOverIl: number;
  exceedingOrders: number[];
  tddExceeds: boolean;
};

function limitFor(order: number, limits: HarmonicLimitRow[]): number | null {
  const row = limits.find((r) => order >= r.orderMin && order <= r.orderMax);
  return row ? row.limitPct : null;
}

export function harmonicsWorksheet(input: HarmonicsInput): CalcOutput<HarmonicsResults> {
  const warnings: CalcWarning[] = [];
  const i1 = input.loadCurrentA;

  const merged = new Map<number, { pct: number; label: string }>();
  for (const s of input.sources) {
    const prev = merged.get(s.order);
    // Same-order contributions from different sources add arithmetically (conservative).
    merged.set(s.order, {
      pct: (prev?.pct ?? 0) + s.magnitudePctOfFundamental,
      label: prev?.label ? `${prev.label}, ${s.label}` : s.label,
    });
  }

  const orders: HarmonicOrderResult[] = [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([order, v]) => {
      const limitPct = limitFor(order, input.limits);
      return {
        order,
        label: v.label,
        currentA: round((v.pct / 100) * i1, 4),
        distortionPct: round(v.pct, 4),
        limitPct,
        exceeds: limitPct !== null && v.pct > limitPct,
      };
    });

  const harmonicRms = Math.sqrt(orders.reduce((sum, o) => sum + o.currentA ** 2, 0));
  const thdPct = (harmonicRms / i1) * 100;
  const thdWithBackgroundPct = thdPct + input.backgroundThdPct;
  const tddPct = (harmonicRms / i1) * 100; // I_L is the declared load current
  const iscA = (input.sccMvaAtPoi * 1e6) / (Math.sqrt(3) * input.nominalVoltageKv * 1000);
  const iscOverIl = iscA / i1;

  const exceedingOrders = orders.filter((o) => o.exceeds).map((o) => o.order);
  const tddExceeds = tddPct > input.tddLimitPct;

  for (const o of orders.filter((x) => x.exceeds)) {
    warnings.push(
      warn(
        "harmonic_order_exceeds_limit",
        "warning",
        `Order ${o.order} at ${round(o.distortionPct, 2)}% exceeds the configured ${o.limitPct}% limit — review with the utility. No compliance determination is made here.`,
      ),
    );
  }
  if (tddExceeds) {
    warnings.push(
      warn(
        "tdd_exceeds_limit",
        "warning",
        `Total demand distortion ${round(tddPct, 2)}% exceeds the configured ${input.tddLimitPct}% limit — mitigation study recommended.`,
      ),
    );
  }
  if (input.backgroundThdPct > 0 && thdWithBackgroundPct > input.tddLimitPct && !tddExceeds) {
    warnings.push(
      warn(
        "background_pushes_over_limit",
        "info",
        `Plant distortion is within the limit but the declared ${input.backgroundThdPct}% background THD pushes the combined figure to ${round(thdWithBackgroundPct, 2)}%.`,
      ),
    );
  }
  if (iscOverIl < 20) {
    warnings.push(
      warn(
        "weak_grid_ratio",
        "warning",
        `Isc/I_L is ${round(iscOverIl, 1)} (< 20): a weak connection point. Confirm the correct limit row with the utility.`,
      ),
    );
  }
  if (orders.some((o) => o.limitPct === null)) {
    warnings.push(
      warn(
        "order_outside_limit_table",
        "info",
        "One or more harmonic orders fall outside the configured limit table and were not screened.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      orders,
      harmonicRmsA: round(harmonicRms, 4),
      thdPct: round(thdPct, 4),
      thdWithBackgroundPct: round(thdWithBackgroundPct, 4),
      tddPct: round(tddPct, 4),
      tddLimitPct: input.tddLimitPct,
      iscA: round(iscA, 2),
      iscOverIl: round(iscOverIl, 3),
      exceedingOrders,
      tddExceeds,
    },
    warnings,
    assumptionsEcho: [
      assumption("i1_source", "load current declared as the fundamental", "input sheet"),
      assumption("background_combination", "arithmetic addition (conservative)", "GridMind"),
      assumption("limit_table", `${input.limits.length} rows, configurable`, "IEEE 519-style default"),
      assumption("nominal_voltage_kv", input.nominalVoltageKv, "input sheet"),
    ],
  };
}
