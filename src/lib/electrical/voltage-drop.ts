// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Voltage drop. EXTENDS the P-055 resistivity constants in src/lib/calculators/cable.ts.
import { z } from "zod";

import { RHO_AL, RHO_CU } from "@/lib/calculators/cable";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const VOLTAGE_DROP_METHOD =
  "Steady-state voltage drop ΔU = k · I · L · (r·cosφ + x·sinφ), with k = √3 for three-phase and " +
  "k = 2 for single-phase circuits. The conductor resistance per metre is r = ρ / A using ρ = " +
  "0.0175 Ω·mm²/m for copper and 0.0282 Ω·mm²/m for aluminium at 20 °C; the reactance per metre " +
  "defaults to 0.00008 Ω/m for LV multicore cable. The drop percentage is ΔU / U_nominal, checked " +
  "against a configurable limit (4% by default).";

export const VOLTAGE_DROP_MATERIALS = ["cu", "al"] as const;

/** Indicative reactance of LV multicore cable, Ω per metre. */
export const DEFAULT_REACTANCE_OHM_PER_M = 0.00008;
export const DEFAULT_DROP_LIMIT_PCT = 4;

export const voltageDropInputSchema = z.object({
  currentA: z.number().positive(),
  lengthM: z.number().positive(),
  mm2: z.number().positive(),
  phases: z.union([z.literal(1), z.literal(3)]).default(3),
  powerFactor: z.number().min(0).max(1).default(0.95),
  material: z.enum(VOLTAGE_DROP_MATERIALS).default("cu"),
  voltageV: z.number().positive(),
  /** Configurable acceptance limit; defaults to 4%. */
  limitPct: z.number().positive().max(20).default(DEFAULT_DROP_LIMIT_PCT),
  reactanceOhmPerM: z.number().min(0).default(DEFAULT_REACTANCE_OHM_PER_M),
});

export type VoltageDropInput = z.infer<typeof voltageDropInputSchema>;

export type VoltageDropResults = {
  inputSheet: VoltageDropInput;
  resistanceOhm: number;
  reactanceOhm: number;
  dropV: number;
  dropPct: number;
  limitPct: number;
  ok: boolean;
};

export function voltageDrop(rawInput: VoltageDropInput): CalcOutput<VoltageDropResults> {
  const input = voltageDropInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const rho = input.material === "cu" ? RHO_CU : RHO_AL;
  const k = input.phases === 3 ? Math.sqrt(3) : 2;
  const resistanceOhm = (rho * input.lengthM) / input.mm2;
  const reactanceOhm = input.reactanceOhmPerM * input.lengthM;
  const sinPhi = Math.sqrt(Math.max(0, 1 - input.powerFactor * input.powerFactor));
  const dropV = k * input.currentA * (resistanceOhm * input.powerFactor + reactanceOhm * sinPhi);
  const dropPct = (dropV / input.voltageV) * 100;
  const ok = dropPct <= input.limitPct;

  if (!ok) {
    warnings.push(
      warn(
        "voltage_drop_exceeded",
        "critical",
        `Drop of ${round(dropPct, 2)}% exceeds the ${input.limitPct}% limit over ${input.lengthM} m. ` +
          "Increase the conductor size, shorten the run or raise the distribution voltage.",
      ),
    );
  } else if (dropPct > input.limitPct * 0.9) {
    warnings.push(
      warn(
        "voltage_drop_near_limit",
        "warning",
        `Drop of ${round(dropPct, 2)}% is within 10% of the ${input.limitPct}% limit — no margin ` +
          "for future load growth.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      resistanceOhm: round(resistanceOhm, 6),
      reactanceOhm: round(reactanceOhm, 6),
      dropV: round(dropV, 4),
      dropPct: round(dropPct, 4),
      limitPct: input.limitPct,
      ok,
    },
    warnings,
    assumptionsEcho: [
      assumption("resistivity_ohm_mm2_per_m", rho, `${input.material.toUpperCase()} at 20 °C`),
      assumption("reactance_ohm_per_m", input.reactanceOhmPerM, "LV multicore indicative value"),
      assumption(
        "phase_factor_k",
        input.phases === 3 ? "√3" : "2",
        `${input.phases}-phase circuit`,
      ),
      assumption("power_factor", input.powerFactor, "Input sheet"),
      assumption("limit_pct", input.limitPct, "Configurable acceptance limit"),
      assumption(
        "conductor_temperature",
        "20 °C — no hot-conductor correction",
        "GridMind default",
      ),
    ],
  };
}
