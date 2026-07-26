// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-167 — Capacitor bank / reactive power / power-factor correction.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

/** Harmonic orders screened for resonance proximity. */
export const SCREENED_HARMONICS = [5, 7, 11, 13] as const;
export const RESONANCE_BAND = 0.5;

export const CAPACITOR_BANK_METHOD =
  "Required compensation is Qc = P × (tan φ₁ − tan φ₂) kvar with φ = acos(pf). Qc is divided into " +
  "equal switching steps and the step current is I = Q_step / (√3 × U). Parallel-resonance order is " +
  "screened as h = √(S_sc / Qc) using the declared upstream fault level; an order landing within " +
  "±0.5 of the 5th or 7th harmonic requires a detuned reactor.";

export const capacitorBankInputSchema = z.object({
  loadKw: z.number().positive(),
  pfExisting: z.number().min(0.1).max(1),
  pfTarget: z.number().min(0.1).max(1).default(0.95),
  voltageKv: z.number().positive(),
  steps: z.number().int().min(1).max(24).default(1),
  /** Upstream three-phase fault level in MVA — drives the resonance screen. */
  faultLevelMva: z.number().positive().optional(),
});

export type CapacitorBankInput = z.infer<typeof capacitorBankInputSchema>;

export type CapacitorBankResults = {
  inputSheet: CapacitorBankInput;
  tanPhiExisting: number;
  tanPhiTarget: number;
  requiredKvar: number;
  stepKvar: number;
  stepCurrentA: number;
  totalCurrentA: number;
  resonanceOrder: number | null;
  detunedReactorRequired: boolean;
};

const tanPhi = (pf: number) => Math.tan(Math.acos(pf));

export function sizeCapacitorBank(
  rawInput: CapacitorBankInput,
): CalcOutput<CapacitorBankResults> {
  const input = capacitorBankInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const tanPhiExisting = tanPhi(input.pfExisting);
  const tanPhiTarget = tanPhi(input.pfTarget);
  const requiredKvar = input.loadKw * (tanPhiExisting - tanPhiTarget);

  if (requiredKvar <= 0) {
    warnings.push(
      warn(
        "no_compensation_required",
        "info",
        `The existing power factor of ${input.pfExisting} already meets the ${input.pfTarget} target — ` +
          "no capacitors are required.",
      ),
    );
  }

  const stepKvar = requiredKvar / input.steps;
  const stepCurrentA =
    requiredKvar > 0 ? stepKvar / (Math.sqrt(3) * input.voltageKv) : 0;
  const totalCurrentA = stepCurrentA * input.steps;

  let resonanceOrder: number | null = null;
  let detunedReactorRequired = false;
  if (input.faultLevelMva === undefined) {
    warnings.push(
      warn(
        "fault_level_missing",
        "critical",
        "No upstream fault level was declared, so the parallel-resonance order could not be screened. " +
          "The bank must not be released for procurement until this check is done.",
      ),
    );
  } else if (requiredKvar > 0) {
    resonanceOrder = Math.sqrt((input.faultLevelMva * 1000) / requiredKvar);
    const near = SCREENED_HARMONICS.find((h) => Math.abs(resonanceOrder! - h) <= RESONANCE_BAND);
    if (near === 5 || near === 7) {
      detunedReactorRequired = true;
      warnings.push(
        warn(
          "resonance_near_characteristic_harmonic",
          "critical",
          `The bank resonates at order ${round(resonanceOrder, 2)}, within ±${RESONANCE_BAND} of the ` +
            `${near}th harmonic. Fit a detuned reactor (typically 5.67% or 7% tuning) before installing.`,
        ),
      );
    } else if (near !== undefined) {
      warnings.push(
        warn(
          "resonance_near_higher_harmonic",
          "warning",
          `The resonance order ${round(resonanceOrder, 2)} sits near the ${near}th harmonic — confirm ` +
            "the site harmonic spectrum before finalising the bank.",
        ),
      );
    }
  }

  if (input.pfTarget > 0.99) {
    warnings.push(
      warn(
        "overcompensation_risk",
        "warning",
        "Targeting a power factor above 0.99 risks leading power factor at light load — use " +
          "automatic step control with a no-volt release.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      tanPhiExisting: round(tanPhiExisting, 4),
      tanPhiTarget: round(tanPhiTarget, 4),
      requiredKvar: round(Math.max(0, requiredKvar), 2),
      stepKvar: round(Math.max(0, stepKvar), 2),
      stepCurrentA: round(stepCurrentA, 2),
      totalCurrentA: round(totalCurrentA, 2),
      resonanceOrder: resonanceOrder === null ? null : round(resonanceOrder, 3),
      detunedReactorRequired,
    },
    warnings,
    assumptionsEcho: [
      assumption("pfTarget", input.pfTarget, "Input sheet — contractual/utility power-factor target"),
      assumption("steps", input.steps, "Input sheet — number of switching steps"),
      assumption(
        "screenedHarmonics",
        SCREENED_HARMONICS.join(", "),
        "Library constant — harmonic orders screened for resonance",
      ),
      assumption(
        "faultLevelMva",
        input.faultLevelMva ?? "not declared",
        "Input sheet — upstream three-phase fault level",
      ),
    ],
  };
}

// --- Shared math reused by the reactive_power and pf_correction study types ---

export const REACTIVE_POWER_METHOD =
  "Apparent power is S = P / pf, reactive demand is Q = P × tan(acos(pf)) and the phase angle is " +
  "φ = acos(pf).";

export const reactivePowerInputSchema = z.object({
  loadKw: z.number().positive(),
  pf: z.number().min(0.1).max(1),
});

export type ReactivePowerInput = z.infer<typeof reactivePowerInputSchema>;

export type ReactivePowerResults = {
  inputSheet: ReactivePowerInput;
  apparentKva: number;
  reactiveKvar: number;
  phiDeg: number;
};

export function reactivePowerRequirement(
  rawInput: ReactivePowerInput,
): CalcOutput<ReactivePowerResults> {
  const input = reactivePowerInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];
  const reactiveKvar = input.loadKw * tanPhi(input.pf);

  if (input.pf < 0.9) {
    warnings.push(
      warn(
        "poor_power_factor",
        "warning",
        `A power factor of ${input.pf} draws ${round(reactiveKvar, 1)} kvar and will normally attract ` +
          "a utility reactive-energy penalty.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      apparentKva: round(input.loadKw / input.pf, 2),
      reactiveKvar: round(reactiveKvar, 2),
      phiDeg: round((Math.acos(input.pf) * 180) / Math.PI, 3),
    },
    warnings,
    assumptionsEcho: [
      assumption("pf", input.pf, "Input sheet — measured/declared power factor"),
      assumption("convention", "lagging", "Library constant — inductive (lagging) load convention"),
    ],
  };
}

export const PF_CORRECTION_METHOD =
  "The installed bank is checked back against the load: Q_after = P × tan(acos(pf_before)) − Q_installed " +
  "and the resulting power factor is pf = cos(atan(Q_after / P)). A negative Q_after means the bank " +
  "over-compensates and the site runs leading.";

export const pfCorrectionInputSchema = z.object({
  loadKw: z.number().positive(),
  /** Power factor before correction. */
  pfBefore: z.number().min(0.1).max(1),
  qInstalledKvar: z.number().min(0),
  /** Contractual target used for the pass/fail verdict. */
  pfAfter: z.number().min(0.1).max(1).default(0.95),
});

export type PfCorrectionInput = z.infer<typeof pfCorrectionInputSchema>;

export type PfCorrectionResults = {
  inputSheet: PfCorrectionInput;
  qBeforeKvar: number;
  qAfterKvar: number;
  achievedPf: number;
  targetPf: number;
  targetMet: boolean;
  leading: boolean;
  shortfallKvar: number;
};

export function pfCorrectionCheck(rawInput: PfCorrectionInput): CalcOutput<PfCorrectionResults> {
  const input = pfCorrectionInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const qBeforeKvar = input.loadKw * tanPhi(input.pfBefore);
  const qAfterKvar = qBeforeKvar - input.qInstalledKvar;
  const achievedPf = Math.cos(Math.atan(qAfterKvar / input.loadKw));
  const targetMet = achievedPf >= input.pfAfter - 1e-9;
  const leading = qAfterKvar < 0;
  const requiredKvar = input.loadKw * (tanPhi(input.pfBefore) - tanPhi(input.pfAfter));
  const shortfallKvar = Math.max(0, requiredKvar - input.qInstalledKvar);

  if (!targetMet) {
    warnings.push(
      warn(
        "target_pf_not_met",
        "warning",
        `The installed ${input.qInstalledKvar} kvar reaches ${round(achievedPf, 3)} against the ` +
          `${input.pfAfter} target — a further ${round(shortfallKvar, 1)} kvar is needed.`,
      ),
    );
  }
  if (leading) {
    warnings.push(
      warn(
        "leading_power_factor",
        "critical",
        `The bank over-compensates by ${round(Math.abs(qAfterKvar), 1)} kvar, driving the site leading. ` +
          "Leading power factor raises bus voltage and can trip utility protection.",
      ),
    );
  }

  return {
    results: {
      inputSheet: input,
      qBeforeKvar: round(qBeforeKvar, 2),
      qAfterKvar: round(qAfterKvar, 2),
      achievedPf: round(achievedPf, 4),
      targetPf: input.pfAfter,
      targetMet,
      leading,
      shortfallKvar: round(shortfallKvar, 2),
    },
    warnings,
    assumptionsEcho: [
      assumption("pfBefore", input.pfBefore, "Input sheet — uncorrected power factor"),
      assumption("qInstalledKvar", input.qInstalledKvar, "Input sheet — installed capacitor kvar"),
      assumption(
        "loadKwConstant",
        input.loadKw,
        "Assumption — active power unchanged by the correction",
      ),
    ],
  };
}
