// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-167 — Diesel/gas genset sizing: running load, motor-starting surge and voltage dip.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

/** Typical starting kVA per kW by starting method (locked-rotor basis). */
export const STARTING_KVA_MULTIPLIER = {
  dol: 6,
  soft_start: 3,
  vfd: 1.5,
  none: 1,
} as const;

export const GENSET_STANDARD_KVA = [
  20, 30, 40, 60, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500,
] as const;

/** Assumed alternator subtransient reactance used for the dip estimate. */
export const ALTERNATOR_XD_PU = 0.15;

/** Below this loading a diesel genset is at risk of wet stacking. */
export const MIN_HEALTHY_LOADING_PCT = 30;

export const GENERATOR_SIZING_METHOD =
  "Running demand is the vector sum S_run = √((ΣP)² + (ΣQ)²) escalated by the growth allowance. " +
  "The starting case replaces the largest motor's running kVA with its locked-rotor demand " +
  "kVA_start = kW × multiplier (DOL 6, soft-start 3, VFD 1.5). Voltage dip is estimated as " +
  "dip% = 100 × (kVA_start × X''d) / (kVA_gen + kVA_start × X''d) with X''d = 0.15 pu. The selected " +
  "rating is the smallest standard genset kVA meeting both the running demand and the dip limit.";

export const generatorSizingInputSchema = z.object({
  loads: z
    .array(
      z.object({
        label: z.string().default(""),
        kw: z.number().positive(),
        pf: z.number().min(0.5).max(1).default(0.8),
        startingMethod: z.enum(["dol", "soft_start", "vfd", "none"]).default("none"),
        startingKvaMultiplier: z.number().min(1).max(12).optional(),
      }),
    )
    .min(1),
  largestMotorKw: z.number().min(0).default(0),
  voltageDipLimitPct: z.number().min(1).max(40).default(15),
  growthPct: z.number().min(0).max(200).default(10),
});

export type GeneratorSizingInput = z.infer<typeof generatorSizingInputSchema>;

export type GeneratorSizingResults = {
  inputSheet: GeneratorSizingInput;
  runningPKw: number;
  runningQKvar: number;
  runningKva: number;
  designKva: number;
  largestMotorKw: number;
  largestMotorMethod: string;
  startingKva: number;
  surgeKva: number;
  selectedKva: number;
  selectedKw: number;
  voltageDipPct: number;
  dipOk: boolean;
  loadingPct: number;
};

export function sizeGenerator(rawInput: GeneratorSizingInput): CalcOutput<GeneratorSizingResults> {
  const input = generatorSizingInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const runningPKw = input.loads.reduce((s, l) => s + l.kw, 0);
  const runningQKvar = input.loads.reduce(
    (s, l) => s + (l.kw / l.pf) * Math.sin(Math.acos(l.pf)),
    0,
  );
  const runningKva = Math.hypot(runningPKw, runningQKvar);
  const designKva = runningKva * (1 + input.growthPct / 100);

  // The starting case is driven by the largest motor; fall back to the biggest declared load.
  const motorLoad =
    input.loads
      .filter((l) => l.startingMethod !== "none")
      .sort((a, b) => b.kw - a.kw)
      .at(0) ?? input.loads.slice().sort((a, b) => b.kw - a.kw)[0];
  const largestMotorKw = input.largestMotorKw > 0 ? input.largestMotorKw : motorLoad.kw;
  const multiplier =
    motorLoad.startingKvaMultiplier ?? STARTING_KVA_MULTIPLIER[motorLoad.startingMethod];
  const startingKva = largestMotorKw * multiplier;
  const motorRunningKva = largestMotorKw / motorLoad.pf;
  const surgeKva = Math.max(designKva, designKva - motorRunningKva + startingKva);

  const dipFor = (genKva: number) =>
    genKva > 0 ? (100 * (startingKva * ALTERNATOR_XD_PU)) / (genKva + startingKva * ALTERNATOR_XD_PU) : 100;

  const selectedKva =
    GENSET_STANDARD_KVA.find((k) => k >= designKva && dipFor(k) <= input.voltageDipLimitPct) ??
    GENSET_STANDARD_KVA.find((k) => k >= surgeKva) ??
    GENSET_STANDARD_KVA[GENSET_STANDARD_KVA.length - 1];

  const voltageDipPct = dipFor(selectedKva);
  const dipOk = voltageDipPct <= input.voltageDipLimitPct;
  const loadingPct = (designKva / selectedKva) * 100;

  if (!dipOk) {
    warnings.push(
      warn(
        "voltage_dip_exceeded",
        "critical",
        `Starting the ${round(largestMotorKw, 1)} kW motor ${motorLoad.startingMethod === "dol" ? "direct-on-line " : ""}` +
          `draws ${round(startingKva, 0)} kVA and dips the bus ${round(voltageDipPct, 1)}%, above the ` +
          `${input.voltageDipLimitPct}% limit. Use a soft-starter or VFD, or increase the genset rating.`,
      ),
    );
  }
  if (motorLoad.startingMethod === "dol" && voltageDipPct > input.voltageDipLimitPct * 0.8) {
    warnings.push(
      warn(
        "dol_starting_marginal",
        "warning",
        "Direct-on-line starting puts the dip close to the declared limit — confirm the alternator " +
          "reactance with the vendor before freezing the starting method.",
      ),
    );
  }
  if (loadingPct < MIN_HEALTHY_LOADING_PCT) {
    warnings.push(
      warn(
        "low_loading_wet_stacking",
        "info",
        `Continuous loading is only ${round(loadingPct, 1)}% of the selected ${selectedKva} kVA — ` +
          "diesel sets below 30% risk wet stacking; consider a smaller set or a load bank regime.",
      ),
    );
  }
  if (surgeKva > GENSET_STANDARD_KVA[GENSET_STANDARD_KVA.length - 1]) {
    warnings.push(
      warn(
        "above_standard_genset_table",
        "warning",
        "The starting demand exceeds the largest standard genset in the table — multiple sets in " +
          "parallel or a custom machine is required.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      runningPKw: round(runningPKw, 2),
      runningQKvar: round(runningQKvar, 2),
      runningKva: round(runningKva, 2),
      designKva: round(designKva, 2),
      largestMotorKw: round(largestMotorKw, 2),
      largestMotorMethod: motorLoad.startingMethod,
      startingKva: round(startingKva, 2),
      surgeKva: round(surgeKva, 2),
      selectedKva,
      selectedKw: round(selectedKva * 0.8, 1),
      voltageDipPct: round(voltageDipPct, 2),
      dipOk,
      loadingPct: round(loadingPct, 2),
    },
    warnings,
    assumptionsEcho: [
      assumption(
        "startingKvaMultiplier",
        multiplier,
        `Library constant — ${motorLoad.startingMethod} starting kVA per kW`,
      ),
      assumption(
        "alternatorXdPu",
        ALTERNATOR_XD_PU,
        "Library constant — assumed alternator subtransient reactance",
      ),
      assumption("gensetPowerFactor", 0.8, "Library constant — standard genset kW/kVA ratio"),
      assumption("growthPct", input.growthPct, "Input sheet — load growth allowance"),
      assumption(
        "voltageDipLimitPct",
        input.voltageDipLimitPct,
        "Input sheet — permitted starting dip",
      ),
    ],
  };
}
