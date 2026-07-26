// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — IEC 60909-style initial symmetrical short-circuit current. Pure, deterministic.
import { z } from "zod";

import { assumption, round, warn, type CalcOutput, type CalcWarning } from "./types";

export const SHORT_CIRCUIT_METHOD =
  "IEC 60909-style initial symmetrical short-circuit current I″k = c · Un / (√3 · |Z|), with " +
  "|Z| = √(R² + X²) of the chained source and feeder impedances. The voltage factor c defaults " +
  "to 1.05 for Un ≤ 1 kV and 1.10 above it. The peak current is ip = κ · √2 · I″k with " +
  "κ = 1.02 + 0.98 · e^(−3R/X), and the short-circuit power is S″k = √3 · Un · I″k. " +
  "Feeder sections are chained by adding R and X cumulatively from the source to each bus.";

/** IEC 60909 voltage factor c for the maximum-current case. */
export function voltageFactor(unKv: number): number {
  return unKv <= 1 ? 1.05 : 1.1;
}

/** κ from the R/X ratio at the fault location. */
export function kappaFromRx(rOhm: number, xOhm: number): number {
  if (xOhm <= 0) return 1.02;
  return 1.02 + 0.98 * Math.exp((-3 * rOhm) / xOhm);
}

export const faultInputSchema = z.object({
  unKv: z.number().positive(),
  rOhm: z.number().min(0),
  xOhm: z.number().min(0),
  cFactor: z.number().min(1).max(1.2).optional(),
  /** Set when R/X came from a default rather than measured/vendor data. */
  impedanceAssumed: z.boolean().default(false),
});

export type FaultInput = z.infer<typeof faultInputSchema>;

export type FaultResult = {
  unKv: number;
  cFactor: number;
  rOhm: number;
  xOhm: number;
  zOhm: number;
  rxRatio: number | null;
  kappa: number;
  ikKa: number;
  ipKa: number;
  skMva: number;
};

/** Single-point fault duty. Also used per bus by the chained calculator. */
export function computeFault(input: FaultInput): { result: FaultResult; warnings: CalcWarning[] } {
  const warnings: CalcWarning[] = [];
  const c = input.cFactor ?? voltageFactor(input.unKv);
  const z = Math.hypot(input.rOhm, input.xOhm);

  if (z <= 0) {
    warnings.push(
      warn(
        "impedance_missing",
        "critical",
        "No source or feeder impedance was supplied — the fault level cannot be computed. " +
          "The returned figures are a placeholder, not an engineering result.",
      ),
    );
    return {
      result: {
        unKv: input.unKv,
        cFactor: c,
        rOhm: input.rOhm,
        xOhm: input.xOhm,
        zOhm: 0,
        rxRatio: null,
        kappa: 1.02,
        ikKa: 0,
        ipKa: 0,
        skMva: 0,
      },
      warnings,
    };
  }

  if (input.impedanceAssumed) {
    warnings.push(
      warn(
        "impedance_assumed",
        "critical",
        "Impedance data was assumed, not taken from vendor test certificates. Treat this fault " +
          "level as a placeholder until the network data is confirmed.",
      ),
    );
  }

  const kappa = kappaFromRx(input.rOhm, input.xOhm);
  const ikKa = (c * input.unKv) / (Math.sqrt(3) * z);
  const ipKa = kappa * Math.SQRT2 * ikKa;
  const skMva = Math.sqrt(3) * input.unKv * ikKa;

  return {
    result: {
      unKv: input.unKv,
      cFactor: c,
      rOhm: round(input.rOhm, 6),
      xOhm: round(input.xOhm, 6),
      zOhm: round(z, 6),
      rxRatio: input.xOhm > 0 ? round(input.rOhm / input.xOhm, 6) : null,
      kappa: round(kappa, 6),
      ikKa: round(ikKa, 6),
      ipKa: round(ipKa, 6),
      skMva: round(skMva, 6),
    },
    warnings,
  };
}

export const shortCircuitInputSchema = z.object({
  unKv: z.number().positive(),
  cFactor: z.number().min(1).max(1.2).optional(),
  /** Source (grid/transformer) impedance at the first bus. */
  sourceROhm: z.number().min(0).default(0),
  sourceXOhm: z.number().min(0).default(0),
  impedanceAssumed: z.boolean().default(false),
  /** Feeder sections in order from the source; impedances chain cumulatively. */
  sections: z
    .array(
      z.object({
        busId: z.string().min(1),
        name: z.string().min(1),
        rOhm: z.number().min(0),
        xOhm: z.number().min(0),
      }),
    )
    .default([]),
});

export type ShortCircuitInput = z.infer<typeof shortCircuitInputSchema>;

export type ShortCircuitResults = {
  inputSheet: ShortCircuitInput;
  source: FaultResult;
  buses: Array<{ busId: string; name: string } & FaultResult>;
};

/** Single-bus entry point kept for direct use by the study workspace. */
export function initialSymmetricalFault(rawInput: FaultInput): CalcOutput<FaultResult> {
  const input = faultInputSchema.parse(rawInput);
  const { result, warnings } = computeFault(input);
  return { results: result, warnings, assumptionsEcho: faultAssumptions(result) };
}

/** Chains section impedances to give the fault duty at every downstream bus. */
export function shortCircuitStudy(rawInput: ShortCircuitInput): CalcOutput<ShortCircuitResults> {
  const input = shortCircuitInputSchema.parse(rawInput);
  const warnings: CalcWarning[] = [];

  const source = computeFault({
    unKv: input.unKv,
    rOhm: input.sourceROhm,
    xOhm: input.sourceXOhm,
    cFactor: input.cFactor,
    impedanceAssumed: input.impedanceAssumed,
  });
  warnings.push(...source.warnings);

  let r = input.sourceROhm;
  let x = input.sourceXOhm;
  const buses = input.sections.map((section) => {
    r += section.rOhm;
    x += section.xOhm;
    const fault = computeFault({
      unKv: input.unKv,
      rOhm: r,
      xOhm: x,
      cFactor: input.cFactor,
      impedanceAssumed: false,
    });
    for (const w of fault.warnings) {
      warnings.push(warn(w.code, w.severity, `${section.name}: ${w.message}`));
    }
    return { busId: section.busId, name: section.name, ...fault.result };
  });

  return {
    results: { inputSheet: input, source: source.result, buses },
    warnings,
    assumptionsEcho: faultAssumptions(source.result),
  };
}

function faultAssumptions(result: FaultResult) {
  return [
    assumption("standard_reference", "IEC 60909 (descriptive reference)", "GridMind method note"),
    assumption("voltage_factor_c", result.cFactor, "IEC 60909 maximum-current case"),
    assumption("kappa_formula", "1.02 + 0.98·e^(−3R/X)", "IEC 60909 series-circuit form"),
    assumption("fault_type", "Three-phase symmetrical", "GridMind default"),
    assumption("pre_fault_load", "Neglected", "GridMind default"),
  ];
}
