// P-166 — Server-only helper for the calculator → EA study bridge.
// Kept out of *.functions.ts so the serverfn-split transform cannot drop it.
import {
  getCalculator,
  isCalculatorStudyType,
  type CalcAssumption,
  type CalcWarning,
  type CalculatorStudyType,
} from "@/lib/electrical";

import { eaError, type JsonValue } from "@/lib/ea-studies.server";

export type CalcRun = {
  studyType: CalculatorStudyType;
  method: string;
  results: Record<string, JsonValue>;
  warnings: CalcWarning[];
  assumptions: CalcAssumption[];
};

/**
 * Validates the raw input sheet against the calculator's own zod schema and
 * runs it. Rejects study types that have no wave-1 calculator.
 */
export function runCalculator(studyType: string, inputSheet: unknown): CalcRun {
  if (!isCalculatorStudyType(studyType)) {
    eaError(400, "no_calculator", `No calculator is wired for study type "${studyType}".`);
  }
  const calculator = getCalculator(studyType);
  const parsed = calculator.inputSchema.safeParse(inputSheet);
  if (!parsed.success) {
    eaError(400, "invalid_input_sheet", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const output = calculator.compute(parsed.data);
  return {
    studyType,
    method: calculator.method,
    results: output.results as Record<string, JsonValue>,
    warnings: output.warnings,
    assumptions: output.assumptionsEcho,
  };
}

/** Counts warnings by severity for the audit metadata. */
export function summariseWarnings(warnings: CalcWarning[]): Record<string, number> {
  return warnings.reduce<Record<string, number>>((acc, w) => {
    acc[w.severity] = (acc[w.severity] ?? 0) + 1;
    return acc;
  }, {});
}
