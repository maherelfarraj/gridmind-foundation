// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-167 — UPS / battery autonomy sizing.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const UPS_STANDARD_KVA = [
  5, 10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800,
] as const;

/** Practical single-string capacity before parallel strings become the norm. */
export const MAX_SINGLE_STRING_AH = 800;

export const CELL_NOMINAL_V = {
  vrla: 2,
  flooded: 2,
  nicd: 1.2,
  li_ion: 3.2,
} as const;

export const UPS_BATTERY_METHOD =
  "Inverter input power is P_dc = P_load / η_inv. Required DC energy is E = P_dc × t/60 (Wh) and the " +
  "raw capacity is Ah = E / V_dc. The installed requirement divides by the ageing factor (end-of-life " +
  "capacity) and adds the design margin: Ah_req = Ah / f_age × (1 + margin/100). Cells in series are " +
  "V_dc / V_end-of-discharge per cell. The suggested UPS rating is the smallest standard kVA at or " +
  "above P_load / pf. When an installed Ah is declared, achievable autonomy is back-calculated from it.";

export const upsBatteryInputSchema = z.object({
  loadKw: z.number().positive(),
  powerFactor: z.number().min(0.5).max(1).default(0.9),
  backupMinutes: z.number().positive(),
  inverterEff: z.number().min(0.5).max(1).default(0.94),
  dcBusVdc: z.number().positive(),
  /** End-of-life capacity retention, e.g. 0.8 for the IEEE 485 ageing allowance. */
  agingFactor: z.number().min(0.5).max(1).default(0.8),
  designMarginPct: z.number().min(0).max(100).default(10),
  endVoltagePerCell: z.number().min(0.8).max(3.2).default(1.75),
  cellType: z.enum(["vrla", "flooded", "nicd", "li_ion"]).default("vrla"),
  /** Optional: capacity actually offered/installed, used for the autonomy check. */
  installedAh: z.number().positive().optional(),
});

export type UpsBatteryInput = z.infer<typeof upsBatteryInputSchema>;

export type UpsBatteryResults = {
  inputSheet: UpsBatteryInput;
  loadKva: number;
  dcPowerKw: number;
  requiredEnergyKwh: number;
  rawAh: number;
  requiredAh: number;
  cellsInSeries: number;
  suggestedUpsKva: number;
  installedAh: number | null;
  achievableMinutes: number | null;
  autonomyOk: boolean;
  parallelStringsSuggested: number;
};

export function sizeUpsBattery(rawInput: UpsBatteryInput): CalcOutput<UpsBatteryResults> {
  const input = upsBatteryInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const loadKva = input.loadKw / input.powerFactor;
  const dcPowerKw = input.loadKw / input.inverterEff;
  const requiredEnergyKwh = (dcPowerKw * input.backupMinutes) / 60;
  const rawAh = (requiredEnergyKwh * 1000) / input.dcBusVdc;
  const requiredAh = (rawAh / input.agingFactor) * (1 + input.designMarginPct / 100);
  const cellsInSeries = Math.ceil(input.dcBusVdc / input.endVoltagePerCell);

  const suggestedUpsKva =
    UPS_STANDARD_KVA.find((k) => k >= loadKva) ?? UPS_STANDARD_KVA[UPS_STANDARD_KVA.length - 1];
  if (loadKva > UPS_STANDARD_KVA[UPS_STANDARD_KVA.length - 1]) {
    warnings.push(
      warn(
        "above_standard_ups_table",
        "warning",
        `The ${round(loadKva, 1)} kVA load exceeds the largest standard UPS module in the table — a ` +
          "parallel-redundant configuration or a custom rating is required.",
      ),
    );
  }

  let achievableMinutes: number | null = null;
  let autonomyOk = true;
  if (input.installedAh !== undefined) {
    const usableWh =
      input.installedAh * input.dcBusVdc * input.agingFactor * (1 - input.designMarginPct / 100);
    achievableMinutes = (usableWh / (dcPowerKw * 1000)) * 60;
    autonomyOk = achievableMinutes >= input.backupMinutes;
    if (!autonomyOk) {
      warnings.push(
        warn(
          "autonomy_below_target",
          "critical",
          `After ageing and margin the installed ${input.installedAh} Ah delivers only ` +
            `${round(achievableMinutes, 1)} min against the ${input.backupMinutes} min target — ` +
            `at least ${round(requiredAh, 0)} Ah is needed.`,
        ),
      );
    }
  }

  const parallelStringsSuggested = Math.max(1, Math.ceil(requiredAh / MAX_SINGLE_STRING_AH));
  if (parallelStringsSuggested > 1) {
    warnings.push(
      warn(
        "parallel_strings_required",
        "warning",
        `The required ${round(requiredAh, 0)} Ah is above the ${MAX_SINGLE_STRING_AH} Ah practical ` +
          `single-string limit — allow ${parallelStringsSuggested} parallel strings with matched ` +
          "cabling and per-string protection.",
      ),
    );
  }

  if (input.agingFactor >= 0.95) {
    warnings.push(
      warn(
        "no_aging_allowance",
        "info",
        "The ageing factor is at or above 0.95, so the battery is sized on beginning-of-life " +
          "capacity — autonomy will fall short late in the battery's service life.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      loadKva: round(loadKva, 2),
      dcPowerKw: round(dcPowerKw, 3),
      requiredEnergyKwh: round(requiredEnergyKwh, 3),
      rawAh: round(rawAh, 2),
      requiredAh: round(requiredAh, 2),
      cellsInSeries,
      suggestedUpsKva,
      installedAh: input.installedAh ?? null,
      achievableMinutes: achievableMinutes === null ? null : round(achievableMinutes, 2),
      autonomyOk,
      parallelStringsSuggested,
    },
    warnings,
    assumptionsEcho: [
      assumption("inverterEff", input.inverterEff, "Input sheet — UPS inverter efficiency"),
      assumption("agingFactor", input.agingFactor, "Input sheet — IEEE 485 style ageing allowance"),
      assumption("designMarginPct", input.designMarginPct, "Input sheet — design margin"),
      assumption(
        "endVoltagePerCell",
        input.endVoltagePerCell,
        "Input sheet — end-of-discharge voltage per cell",
      ),
      assumption(
        "cellNominalV",
        CELL_NOMINAL_V[input.cellType],
        `Library constant — nominal volts per ${input.cellType} cell`,
      ),
      assumption(
        "maxSingleStringAh",
        MAX_SINGLE_STRING_AH,
        "Library constant — practical single-string capacity limit",
      ),
    ],
  };
}
