// Simplified engineering estimates — not validated against commercial analysis software; qualified-engineer review required.
// P-166 — Shared primitives for the electrical calculator library.
// Pure module: no React, no Supabase, no route imports.
import { z } from "zod";

export const CALC_SEVERITIES = ["info", "warning", "critical"] as const;
export type CalcSeverity = (typeof CALC_SEVERITIES)[number];

export const calcWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(CALC_SEVERITIES),
  message: z.string().min(1),
});
export type CalcWarning = z.infer<typeof calcWarningSchema>;

/** Assumption echoed back with every result so a reviewer can reproduce the run. */
export type CalcAssumption = { key: string; value: string; source: string };

export type CalcOutput<TResults> = {
  results: TResults;
  warnings: CalcWarning[];
  assumptionsEcho: CalcAssumption[];
};

export function warn(code: string, severity: CalcSeverity, message: string): CalcWarning {
  return { code, severity, message };
}

export function assumption(key: string, value: string | number, source: string): CalcAssumption {
  return { key, value: String(value), source };
}

/** Deterministic rounding — keeps snapshots byte-stable across runs. */
export function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export type Complex = { re: number; im: number };

export const cx = (re: number, im: number): Complex => ({ re, im });
export const cAdd = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
export const cSub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
export const cMul = (a: Complex, b: Complex): Complex =>
  cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cConj = (a: Complex): Complex => cx(a.re, -a.im);
export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cArgDeg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
export function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return cx(0, 0);
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
