/**
 * P-172 — CSV / historian import: pure parsing, column mapping and preview
 * validation. No React, no Supabase, no server imports.
 */
import { isValid, parse as parseDate, parseISO } from "date-fns";
import { z } from "zod";

export const IMPORT_CHUNK_SIZE = 500;
export const MAX_IMPORT_ROWS = 20_000;
export const MAX_PREVIEW_ROWS = 25;
export const MAX_IMPORT_ERRORS = 20;

export const TIMESTAMP_FORMATS = [
  { value: "iso", label: "ISO 8601 (2026-07-26T09:00:00Z)" },
  { value: "yyyy-MM-dd HH:mm:ss", label: "yyyy-MM-dd HH:mm:ss" },
  { value: "yyyy-MM-dd HH:mm", label: "yyyy-MM-dd HH:mm" },
  { value: "dd/MM/yyyy HH:mm", label: "dd/MM/yyyy HH:mm" },
  { value: "MM/dd/yyyy HH:mm", label: "MM/dd/yyyy HH:mm" },
] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMATS)[number]["value"];

export interface CsvTable {
  header: string[];
  rows: string[][];
  truncated: boolean;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** Parse a wide CSV (timestamp column + one column per tag) into a table. */
export function parseCsvTable(text: string): CsvTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [], truncated: false };
  const header = splitCsvLine(lines[0]);
  const body = lines.slice(1);
  const truncated = body.length > MAX_IMPORT_ROWS;
  return {
    header,
    rows: body.slice(0, MAX_IMPORT_ROWS).map(splitCsvLine),
    truncated,
  };
}

/** Parse a cell into an ISO timestamp, or null when unparseable. */
export function parseTimestamp(raw: string, format: TimestampFormat): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const d = format === "iso" ? parseISO(value) : parseDate(value, format, new Date());
  if (!isValid(d)) return null;
  return d.toISOString();
}

export const columnMappingSchema = z.object({
  column: z.string().trim().min(1).max(256),
  tag: z.string().trim().min(1).max(120),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const importMappingSchema = z.object({
  timestamp_column: z.string().trim().min(1).max(256),
  timestamp_format: z.enum(TIMESTAMP_FORMATS.map((f) => f.value) as [string, ...string[]]),
  columns: z.array(columnMappingSchema).min(1).max(200),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export interface ImportError {
  line: number;
  column: string | null;
  reason: string;
}

export interface ResolvedReading {
  tag: string;
  ts: string;
  value: number;
}

export interface CsvValidationResult {
  readings: ResolvedReading[];
  rowsReceived: number;
  accepted: number;
  rejected: number;
  errors: ImportError[];
}

/**
 * Validate + resolve a parsed CSV against a column mapping.
 * `knownTags` is the set of tag_dictionary.tag values for the project; an empty
 * set skips the unknown-tag check (used before the dictionary is loaded).
 */
export function validateCsvRows(
  table: CsvTable,
  mapping: ImportMapping,
  knownTags: ReadonlySet<string>,
  limit = Number.POSITIVE_INFINITY,
): CsvValidationResult {
  const errors: ImportError[] = [];
  const readings: ResolvedReading[] = [];
  const pushError = (e: ImportError) => {
    if (errors.length < MAX_IMPORT_ERRORS) errors.push(e);
  };

  const tsIndex = table.header.indexOf(mapping.timestamp_column);
  if (tsIndex < 0) {
    return {
      readings: [],
      rowsReceived: 0,
      accepted: 0,
      rejected: 0,
      errors: [{ line: 1, column: mapping.timestamp_column, reason: "timestamp_column_missing" }],
    };
  }

  const cols = mapping.columns
    .map((c) => ({ ...c, index: table.header.indexOf(c.column) }))
    .filter((c) => {
      if (c.index < 0) {
        pushError({ line: 1, column: c.column, reason: "column_missing" });
        return false;
      }
      if (knownTags.size > 0 && !knownTags.has(c.tag)) {
        pushError({ line: 1, column: c.column, reason: `unknown_tag:${c.tag}` });
        return false;
      }
      return true;
    });

  let rejected = 0;
  const max = Math.min(table.rows.length, limit);
  for (let i = 0; i < max; i += 1) {
    const row = table.rows[i];
    const line = i + 2;
    const ts = parseTimestamp(row[tsIndex] ?? "", mapping.timestamp_format as TimestampFormat);
    if (!ts) {
      rejected += 1;
      pushError({ line, column: mapping.timestamp_column, reason: "invalid_timestamp" });
      continue;
    }
    for (const col of cols) {
      const cell = row[col.index];
      if (cell === undefined || cell === "") continue;
      const value = Number(cell);
      if (!Number.isFinite(value)) {
        rejected += 1;
        pushError({ line, column: col.column, reason: "non_numeric_value" });
        continue;
      }
      readings.push({ tag: col.tag, ts, value });
    }
  }

  return {
    readings,
    rowsReceived: max,
    accepted: readings.length,
    rejected,
    errors,
  };
}

/** Suggest a tag for a CSV column by exact/normalised match. */
export function suggestTagForColumn(column: string, tags: readonly string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(column);
  return tags.find((t) => norm(t) === target) ?? null;
}

export function chunkRows<T>(rows: readonly T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size) as T[]);
  return out;
}

/** Storage object path for an uploaded historian file (private bucket). */
export function importStoragePath(companyId: string, projectId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return `scada-imports/${companyId}/${projectId}/${Date.now()}-${safe}`;
}
