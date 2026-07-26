// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Transformer loading. Reuses the P-055 standard kVA table.
import { z } from "zod";

import { STANDARD_KVA } from "@/lib/calculators/transformer";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const TRANSFORMER_LOADING_METHOD =
  "Connected load is vector-summed as S = √((ΣP)² + (ΣQ)²) in kVA, then escalated by the declared " +
  "growth allowance. Loading is S_design / (rating × units in service). The suggested nameplate is " +
  "the smallest P-055 standard kVA rating that keeps loading at or below 80%. When parallel units " +
  "are declared, the n-1 case re-evaluates loading with one unit out of service.";

export const transformerLoadingInputSchema = z.object({
  ratingKva: z.number().positive(),
  loads: z
    .array(z.object({ label: z.string().default(""), pKw: z.number(), qKvar: z.number().default(0) }))
    .min(1),
  growthPct: z.number().min(0).max(200).default(0),
  /** Number of transformers in parallel; n-1 requires at least 2. */
  units: z.number().int().min(1).max(10).default(1),
  nMinus1: z.boolean().default(false),
  targetLoadingPct: z.number().min(10).max(100).default(80),
});

export type TransformerLoadingInput = z.infer<typeof transformerLoadingInputSchema>;

export type TransformerLoadingResults = {
  inputSheet: TransformerLoadingInput;
  totalPKw: number;
  totalQKvar: number;
  loadKva: number;
  designKva: number;
  powerFactor: number;
  installedKva: number;
  loadingPct: number;
  nMinus1LoadingPct: number | null;
  nMinus1Ok: boolean | null;
  suggestedKva: number;
  upsizeRequired: boolean;
};

export function transformerLoading(
  rawInput: TransformerLoadingInput,
): CalcOutput<TransformerLoadingResults> {
  const input = transformerLoadingInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const totalPKw = input.loads.reduce((sum, l) => sum + l.pKw, 0);
  const totalQKvar = input.loads.reduce((sum, l) => sum + l.qKvar, 0);
  const loadKva = Math.hypot(totalPKw, totalQKvar);
  const designKva = loadKva * (1 + input.growthPct / 100);
  const installedKva = input.ratingKva * input.units;
  const loadingPct = installedKva > 0 ? (designKva / installedKva) * 100 : 0;

  let nMinus1LoadingPct: number | null = null;
  let nMinus1Ok: boolean | null = null;
  if (input.nMinus1) {
    if (input.units < 2) {
      warnings.push(
        warn(
          "n_minus_1_not_possible",
          "critical",
          "An n-1 check was requested but only one transformer is declared — loss of that unit " +
            "drops the whole load.",
        ),
      );
    } else {
      nMinus1LoadingPct = (designKva / (input.ratingKva * (input.units - 1))) * 100;
      nMinus1Ok = nMinus1LoadingPct <= 100;
      if (!nMinus1Ok) {
        warnings.push(
          warn(
            "n_minus_1_overload",
            "critical",
            `With one unit out of service the remaining transformers reach ` +
              `${round(nMinus1LoadingPct, 1)}% — firm capacity is not met.`,
          ),
        );
      } else if (nMinus1LoadingPct > input.targetLoadingPct) {
        warnings.push(
          warn(
            "n_minus_1_high",
            "warning",
            `The n-1 case loads the remaining units to ${round(nMinus1LoadingPct, 1)}%, above the ` +
              `${input.targetLoadingPct}% target.`,
          ),
        );
      }
    }
  }

  if (loadingPct > 100) {
    warnings.push(
      warn(
        "transformer_overloaded",
        "critical",
        `Design load ${round(designKva, 1)} kVA exceeds the installed ${installedKva} kVA ` +
          `(${round(loadingPct, 1)}%). Upsize before issuing for construction.`,
      ),
    );
  } else if (loadingPct > input.targetLoadingPct) {
    warnings.push(
      warn(
        "transformer_loading_high",
        "info",
        `Loading is ${round(loadingPct, 1)}%, above the ${input.targetLoadingPct}% planning target — ` +
          "little room for load growth.",
      ),
    );
  }

  const requiredPerUnit = designKva / Math.max(1, input.units) / (input.targetLoadingPct / 100);
  const suggestedKva =
    STANDARD_KVA.find((k) => k >= requiredPerUnit) ?? STANDARD_KVA[STANDARD_KVA.length - 1];
  if (requiredPerUnit > STANDARD_KVA[STANDARD_KVA.length - 1]) {
    warnings.push(
      warn(
        "above_standard_table",
        "warning",
        `The required ${round(requiredPerUnit, 0)} kVA per unit exceeds the largest standard rating ` +
          "in the table — more units or a custom nameplate is needed.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      totalPKw: round(totalPKw, 4),
      totalQKvar: round(totalQKvar, 4),
      loadKva: round(loadKva, 4),
      designKva: round(designKva, 4),
      powerFactor: loadKva > 0 ? round(totalPKw / loadKva, 4) : 1,
      installedKva,
      loadingPct: round(loadingPct, 4),
      nMinus1LoadingPct: nMinus1LoadingPct === null ? null : round(nMinus1LoadingPct, 4),
      nMinus1Ok,
      suggestedKva,
      upsizeRequired: suggestedKva > input.ratingKva,
    },
    warnings,
    assumptionsEcho: [
      assumption("rating_table", "P-055 standard IEC nameplate kVA ratings", "IEC indicative list"),
      assumption("target_loading_pct", input.targetLoadingPct, "Planning target"),
      assumption("growth_pct", input.growthPct, "Input sheet"),
      assumption("units_in_service", input.units, "Input sheet"),
      assumption("diversity", "None applied — loads summed at full value", "GridMind default"),
      assumption("ambient_derating", "Not applied", "GridMind default"),
    ],
  };
}
