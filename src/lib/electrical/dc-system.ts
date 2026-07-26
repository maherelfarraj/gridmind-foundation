// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-167 — Station DC system: duty-cycle profile, battery autonomy and charger sizing.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

/** Momentary loads are counted for this long in the duty-cycle energy. */
export const MOMENTARY_DUTY_MIN = 1;

export const DC_SYSTEM_METHOD =
  "Each load is converted to amps as I = W / V_dc. Continuous loads run for the whole duty cycle; " +
  "intermittent loads run for their declared duration; momentary loads are counted for one minute of " +
  "energy but set the worst-case demand. Required capacity is Ah = Σ(I × t/60) / f_age × " +
  "(1 + margin/100). Charger output is I_continuous + Ah_installed / recharge hours, and the boost " +
  "rating adds 10% for the equalising charge.";

export const dcSystemInputSchema = z.object({
  systemVdc: z.union([
    z.literal(24),
    z.literal(48),
    z.literal(110),
    z.literal(125),
    z.literal(220),
  ]),
  loads: z
    .array(
      z.object({
        label: z.string().default(""),
        watts: z.number().positive(),
        duty: z.enum(["continuous", "intermittent", "momentary"]).default("continuous"),
        durationMin: z.number().min(0).default(0),
      }),
    )
    .min(1),
  /** Autonomy the battery must deliver, in minutes. */
  autonomyMinutes: z.number().positive().default(480),
  batteryAh: z.number().positive(),
  agingFactor: z.number().min(0.5).max(1).default(0.8),
  designMarginPct: z.number().min(0).max(100).default(10),
  rechargeHours: z.number().positive().default(12),
  installedChargerA: z.number().positive().optional(),
});

export type DcSystemInput = z.infer<typeof dcSystemInputSchema>;

export type DcProfileEntry = {
  label: string;
  duty: "continuous" | "intermittent" | "momentary";
  currentA: number;
  durationMin: number;
  ampHours: number;
};

export type DcSystemResults = {
  inputSheet: DcSystemInput;
  profile: DcProfileEntry[];
  continuousA: number;
  worstCaseDemandA: number;
  dutyCycleAh: number;
  requiredAh: number;
  installedAh: number;
  autonomyOk: boolean;
  achievableMinutes: number;
  chargerFloatA: number;
  chargerBoostA: number;
  chargerOk: boolean;
};

export function dcSystemCalc(rawInput: DcSystemInput): CalcOutput<DcSystemResults> {
  const input = dcSystemInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const profile: DcProfileEntry[] = input.loads.map((l) => {
    const currentA = l.watts / input.systemVdc;
    const durationMin =
      l.duty === "continuous"
        ? input.autonomyMinutes
        : l.duty === "momentary"
          ? MOMENTARY_DUTY_MIN
          : Math.min(l.durationMin, input.autonomyMinutes);
    if (l.duty === "intermittent" && l.durationMin <= 0) {
      warnings.push(
        warn(
          "intermittent_duration_missing",
          "warning",
          `Intermittent load "${l.label || `${l.watts} W`}" has no declared duration, so it adds no ` +
            "energy to the duty cycle — confirm the operating profile.",
        ),
      );
    }
    return {
      label: l.label,
      duty: l.duty,
      currentA: round(currentA, 3),
      durationMin: round(durationMin, 2),
      ampHours: round((currentA * durationMin) / 60, 4),
    };
  });

  const continuousA = profile
    .filter((p) => p.duty === "continuous")
    .reduce((s, p) => s + p.currentA, 0);
  const momentaryA = profile
    .filter((p) => p.duty === "momentary")
    .reduce((s, p) => s + p.currentA, 0);
  const intermittentA = profile
    .filter((p) => p.duty === "intermittent")
    .reduce((s, p) => s + p.currentA, 0);
  const worstCaseDemandA = continuousA + intermittentA + momentaryA;

  const dutyCycleAh = profile.reduce((s, p) => s + p.ampHours, 0);
  const requiredAh = (dutyCycleAh / input.agingFactor) * (1 + input.designMarginPct / 100);

  const usableAh = input.batteryAh * input.agingFactor * (1 - input.designMarginPct / 100);
  const achievableMinutes = continuousA > 0 ? (usableAh / continuousA) * 60 : input.autonomyMinutes;
  const autonomyOk = input.batteryAh >= requiredAh;

  if (!autonomyOk) {
    warnings.push(
      warn(
        "autonomy_below_target",
        "critical",
        `The duty cycle needs ${round(requiredAh, 1)} Ah after ageing and margin but only ` +
          `${input.batteryAh} Ah is installed — roughly ${round(achievableMinutes, 0)} min of ` +
          `autonomy against the ${input.autonomyMinutes} min target.`,
      ),
    );
  }

  const chargerFloatA = continuousA + input.batteryAh / input.rechargeHours;
  const chargerBoostA = chargerFloatA * 1.1;
  let chargerOk = true;
  if (input.installedChargerA !== undefined) {
    chargerOk = input.installedChargerA >= chargerFloatA;
    if (!chargerOk) {
      warnings.push(
        warn(
          "charger_undersized",
          "critical",
          `The installed ${input.installedChargerA} A charger cannot carry the ${round(continuousA, 1)} A ` +
            `standing load while recharging in ${input.rechargeHours} h — at least ` +
            `${round(chargerFloatA, 1)} A is required.`,
        ),
      );
    }
  }

  return {
    results: {
      inputSheet: input,
      profile,
      continuousA: round(continuousA, 3),
      worstCaseDemandA: round(worstCaseDemandA, 3),
      dutyCycleAh: round(dutyCycleAh, 3),
      requiredAh: round(requiredAh, 2),
      installedAh: input.batteryAh,
      autonomyOk,
      achievableMinutes: round(achievableMinutes, 1),
      chargerFloatA: round(chargerFloatA, 2),
      chargerBoostA: round(chargerBoostA, 2),
      chargerOk,
    },
    warnings,
    assumptionsEcho: [
      assumption("systemVdc", input.systemVdc, "Input sheet — nominal DC system voltage"),
      assumption("autonomyMinutes", input.autonomyMinutes, "Input sheet — required autonomy"),
      assumption("agingFactor", input.agingFactor, "Input sheet — end-of-life capacity allowance"),
      assumption("designMarginPct", input.designMarginPct, "Input sheet — design margin"),
      assumption("rechargeHours", input.rechargeHours, "Input sheet — battery recharge time"),
      assumption(
        "momentaryDutyMin",
        MOMENTARY_DUTY_MIN,
        "Library constant — energy window credited to momentary loads",
      ),
    ],
  };
}
