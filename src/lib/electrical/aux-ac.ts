// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-167 — Auxiliary AC (station service) load list and transformer selection.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { STANDARD_KVA } from "@/lib/calculators/transformer";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const AUX_AC_METHOD =
  "Each load is resolved into P and Q from its declared power factor. Running demand takes continuous " +
  "loads in full and intermittent loads at the declared demand factor; standby loads are excluded from " +
  "the running case but included in the peak case. Both are vector-summed as S = √(ΣP² + ΣQ²) and " +
  "escalated by the growth allowance. The suggested auxiliary transformer is the smallest P-055 " +
  "standard kVA that keeps peak loading at or below 80%.";

export const AUX_AC_TARGET_LOADING_PCT = 80;

export const auxAcInputSchema = z.object({
  loads: z
    .array(
      z.object({
        label: z.string().default(""),
        kw: z.number().positive(),
        pf: z.number().min(0.5).max(1).default(0.85),
        duty: z.enum(["continuous", "intermittent", "standby"]).default("continuous"),
      }),
    )
    .min(1),
  demandFactor: z.number().min(0.1).max(1).default(0.6),
  growthPct: z.number().min(0).max(200).default(10),
});

export type AuxAcInput = z.infer<typeof auxAcInputSchema>;

export type AuxAcResults = {
  inputSheet: AuxAcInput;
  continuousKva: number;
  intermittentKva: number;
  standbyKva: number;
  runningKva: number;
  peakKva: number;
  designKva: number;
  suggestedTransformerKva: number;
  loadingPct: number;
  standbySharePct: number;
};

type Vec = { p: number; q: number };

function vecSum(loads: { kw: number; pf: number }[], factor = 1): Vec {
  return loads.reduce<Vec>(
    (acc, l) => ({
      p: acc.p + l.kw * factor,
      q: acc.q + (l.kw / l.pf) * Math.sin(Math.acos(l.pf)) * factor,
    }),
    { p: 0, q: 0 },
  );
}

const mag = (v: Vec) => Math.hypot(v.p, v.q);

export function auxAcCalc(rawInput: AuxAcInput): CalcOutput<AuxAcResults> {
  const input = auxAcInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const continuous = input.loads.filter((l) => l.duty === "continuous");
  const intermittent = input.loads.filter((l) => l.duty === "intermittent");
  const standby = input.loads.filter((l) => l.duty === "standby");

  const contVec = vecSum(continuous);
  const intVecDemand = vecSum(intermittent, input.demandFactor);
  const intVecFull = vecSum(intermittent);
  const standbyVec = vecSum(standby);

  const continuousKva = mag(contVec);
  const intermittentKva = mag(intVecFull);
  const standbyKva = mag(standbyVec);

  const runningVec = { p: contVec.p + intVecDemand.p, q: contVec.q + intVecDemand.q };
  const peakVec = {
    p: contVec.p + intVecFull.p + standbyVec.p,
    q: contVec.q + intVecFull.q + standbyVec.q,
  };
  const runningKva = mag(runningVec);
  const peakKva = mag(peakVec);
  const designKva = peakKva * (1 + input.growthPct / 100);

  const required = designKva / (AUX_AC_TARGET_LOADING_PCT / 100);
  const suggestedTransformerKva =
    STANDARD_KVA.find((k) => k >= required) ?? STANDARD_KVA[STANDARD_KVA.length - 1];
  const loadingPct = (designKva / suggestedTransformerKva) * 100;
  const standbySharePct = peakKva > 0 ? (standbyKva / peakKva) * 100 : 0;

  if (loadingPct > AUX_AC_TARGET_LOADING_PCT) {
    warnings.push(
      warn(
        "aux_transformer_loading_high",
        "warning",
        `The design load of ${round(designKva, 1)} kVA loads the suggested ` +
          `${suggestedTransformerKva} kVA transformer to ${round(loadingPct, 1)}%, above the ` +
          `${AUX_AC_TARGET_LOADING_PCT}% planning target — step up to the next standard rating.`,
      ),
    );
  }
  if (required > STANDARD_KVA[STANDARD_KVA.length - 1]) {
    warnings.push(
      warn(
        "above_standard_table",
        "warning",
        "The auxiliary demand exceeds the largest standard rating in the P-055 table — split the " +
          "station service across two transformers.",
      ),
    );
  }
  if (standbySharePct > 50) {
    warnings.push(
      warn(
        "standby_dominates_rating",
        "info",
        `Standby loads make up ${round(standbySharePct, 1)}% of the peak case, so the transformer is ` +
          "sized for equipment that rarely runs — confirm which standby loads can be coincident.",
      ),
    );
  }
  if (continuous.length === 0) {
    warnings.push(
      warn(
        "no_continuous_loads",
        "info",
        "No continuous loads were declared — the running case is driven entirely by demand-factored " +
          "intermittent equipment.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      continuousKva: round(continuousKva, 2),
      intermittentKva: round(intermittentKva, 2),
      standbyKva: round(standbyKva, 2),
      runningKva: round(runningKva, 2),
      peakKva: round(peakKva, 2),
      designKva: round(designKva, 2),
      suggestedTransformerKva,
      loadingPct: round(loadingPct, 2),
      standbySharePct: round(standbySharePct, 2),
    },
    warnings,
    assumptionsEcho: [
      assumption(
        "demandFactor",
        input.demandFactor,
        "Input sheet — intermittent load demand factor",
      ),
      assumption("growthPct", input.growthPct, "Input sheet — spare capacity allowance"),
      assumption(
        "targetLoadingPct",
        AUX_AC_TARGET_LOADING_PCT,
        "Library constant — planning loading target for station-service transformers",
      ),
      assumption(
        "ratingTable",
        "P-055 STANDARD_KVA",
        "Library constant — shared standard transformer rating table",
      ),
    ],
  };
}
