// P-169 — Presentation helpers shared by the study workspace and the report PDF.
// Pure module: no React, no Supabase.
import { labelFor } from "./form-spec";
import type { EaWarning, EaWarningSeverity } from "./study-types";

export type ScalarRow = { label: string; value: string };
export type ResultTable = { title: string; columns: string[]; rows: string[][] };
export type ResultSections = { scalars: ScalarRow[]; tables: ResultTable[] };

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (Number.isInteger(value)) return String(value);
    if (abs >= 1000) return value.toFixed(1);
    if (abs >= 1) return value.toFixed(3);
    return value.toPrecision(3);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Splits a calculator result object into scalar rows plus one table per array. */
export function resultSections(results: unknown): ResultSections {
  const scalars: ScalarRow[] = [];
  const tables: ResultTable[] = [];
  if (!results || typeof results !== "object" || Array.isArray(results)) return { scalars, tables };

  for (const [key, value] of Object.entries(results as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const objectRows = value.filter(
        (v) => v && typeof v === "object" && !Array.isArray(v),
      ) as Array<Record<string, unknown>>;
      if (objectRows.length === value.length && objectRows.length > 0) {
        const columns: string[] = [];
        for (const row of objectRows) {
          for (const col of Object.keys(row)) if (!columns.includes(col)) columns.push(col);
        }
        tables.push({
          title: labelFor(key),
          columns: columns.map(labelFor),
          rows: objectRows.map((row) => columns.map((col) => formatValue(row[col]))),
        });
        continue;
      }
      if (value.length > 0) {
        scalars.push({ label: labelFor(key), value: value.map(formatValue).join(", ") });
      }
      continue;
    }
    if (value && typeof value === "object") {
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (subValue && typeof subValue === "object") continue;
        scalars.push({
          label: `${labelFor(key)} — ${labelFor(sub)}`,
          value: formatValue(subValue),
        });
      }
      continue;
    }
    scalars.push({ label: labelFor(key), value: formatValue(value) });
  }
  return { scalars, tables };
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 4;
}

/** Critical first, then error / warning / info; stable within a severity. */
export function sortWarnings<T extends { severity: string }>(warnings: readonly T[]): T[] {
  return [...warnings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export function normalizeWarnings(raw: unknown): EaWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === "object")
    .map((w) => ({
      code: String(w.code ?? "warning"),
      severity: String(w.severity ?? "info") as EaWarningSeverity,
      message: String(w.message ?? ""),
    }));
}

export function normalizeAssumptions(raw: unknown): Array<{ text: string; source: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
    .map((a) => ({ text: String(a.text ?? ""), source: String(a.source ?? "") }))
    .filter((a) => a.text !== "");
}

/** Flat "key: value" rows for the stored input sheet (arrays collapse to a count). */
export function inputSheetRows(inputSheet: unknown): ScalarRow[] {
  if (!inputSheet || typeof inputSheet !== "object") return [];
  const rows: ScalarRow[] = [];
  for (const [key, value] of Object.entries(inputSheet as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      rows.push({ label: labelFor(key), value: `${value.length} row(s)` });
      continue;
    }
    if (value && typeof value === "object") {
      rows.push({ label: labelFor(key), value: JSON.stringify(value) });
      continue;
    }
    rows.push({ label: labelFor(key), value: formatValue(value) });
  }
  return rows;
}

/** Grid-code progress: percent of answered items marked compliant. */
export function gridCodeProgress(
  itemCount: number,
  statuses: readonly string[],
): { compliant: number; applicable: number; percent: number } {
  const compliant = statuses.filter((s) => s === "compliant").length;
  const notApplicable = statuses.filter((s) => s === "not_applicable").length;
  const applicable = Math.max(itemCount - notApplicable, 0);
  const percent = applicable === 0 ? 0 : Math.round((compliant / applicable) * 100);
  return { compliant, applicable, percent };
}
