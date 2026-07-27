// P-210 — Pure estimating rules: schemas, money math, rate validity, CSV parsing.
// No server imports — safe for components and offline unit tests.
import { z } from "zod";

export const ESTIMATE_RATE_TYPES = ["material", "labor", "plant", "subcontract", "other"] as const;
export type EstimateRateType = (typeof ESTIMATE_RATE_TYPES)[number];

export const ESTIMATE_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "priced",
  "superseded",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const RATE_TYPE_LABELS: Record<EstimateRateType, string> = {
  material: "Material",
  labor: "Labour",
  plant: "Plant",
  subcontract: "Subcontract",
  other: "Other",
};

/** Roles allowed to write estimates + lines (mirrors the RLS policies). */
export const ESTIMATE_WRITE_ROLES = [
  "engineering_admin",
  "procurement_admin",
  "company_admin",
] as const;
/** Rate-library writes additionally allow finance_admin. */
export const RATE_WRITE_ROLES = [...ESTIMATE_WRITE_ROLES, "finance_admin"] as const;

/** Lines are only editable while the estimate is a draft. */
export function isEstimateEditable(status: EstimateStatus | string): boolean {
  return status === "draft";
}

export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export function lineAmount(qty: number, unitRate: number): number {
  return round2((Number(qty) || 0) * (Number(unitRate) || 0));
}

export function sumAmounts(lines: readonly { amount: number }[]): number {
  return round2(lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0));
}

/* ----------------------------------------------------------------- rates */

export type RateValidity = "current" | "expiring" | "expired";

/** `valid_to` null or in the future = current; ≤30 days out = expiring. */
export function rateValidity(validTo: string | null | undefined, today: string): RateValidity {
  if (!validTo) return "current";
  const end = Date.parse(`${validTo}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return "current";
  if (end < now) return "expired";
  const days = Math.round((end - now) / 86_400_000);
  return days <= 30 ? "expiring" : "current";
}

/* --------------------------------------------------------------- schemas */

const uuid = z.string().uuid();
const optionalUuid = uuid.nullish().transform((v) => v ?? null);

export const ListEstimatesSchema = z.object({
  status: z.enum(ESTIMATE_STATUSES).nullish(),
  project_id: uuid.nullish(),
  q: z.string().trim().max(120).nullish(),
});
export type ListEstimatesInput = z.infer<typeof ListEstimatesSchema>;

export const EstimateIdSchema = z.object({ id: uuid });

export const CreateEstimateSchema = z.object({
  title: z.string().trim().min(2, "Title is required").max(160),
  project_id: uuid,
  opportunity_id: optionalUuid,
  bom_snapshot_id: optionalUuid,
  currency_code: z.string().trim().length(3).toUpperCase(),
});
export type CreateEstimateInput = z.infer<typeof CreateEstimateSchema>;

export const UpsertEstimateLineSchema = z.object({
  id: uuid.nullish(),
  estimate_id: uuid,
  line_type: z.enum(ESTIMATE_RATE_TYPES),
  description: z.string().trim().min(1, "Description is required").max(400),
  qty: z.coerce.number().min(0, "Quantity cannot be negative"),
  uom: z.string().trim().min(1, "Unit is required").max(24),
  unit_rate: z.coerce.number().min(0, "Rate cannot be negative"),
  rate_library_id: optionalUuid,
  notes: z.string().trim().max(500).nullish(),
});
export type UpsertEstimateLineInput = z.infer<typeof UpsertEstimateLineSchema>;

export const DeleteEstimateLineSchema = z.object({
  estimate_id: uuid,
  line_id: uuid,
});

export const ReorderEstimateLinesSchema = z.object({
  estimate_id: uuid,
  line_ids: z.array(uuid).min(1).max(1000),
});

export const RateRowSchema = z
  .object({
    rate_type: z.enum(ESTIMATE_RATE_TYPES),
    name: z.string().trim().min(2).max(160),
    uom: z.string().trim().min(1).max(24),
    unit_rate: z.coerce.number().min(0),
    currency_code: z.string().trim().length(3).toUpperCase(),
    category: z.string().trim().max(80).nullish(),
    supplier: z.string().trim().max(120).nullish(),
    valid_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullish(),
    valid_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullish(),
    notes: z.string().trim().max(400).nullish(),
  })
  .refine((r) => !r.valid_from || !r.valid_to || r.valid_to >= r.valid_from, {
    message: "valid_to must be on or after valid_from",
    path: ["valid_to"],
  });
export type RateRow = z.infer<typeof RateRowSchema>;

export const UpsertRateSchema = z.object({ id: uuid.nullish(), row: RateRowSchema });
export const DeleteRateSchema = z.object({ id: uuid });
export const ImportRateLibrarySchema = z.object({ rows: z.array(RateRowSchema).min(1).max(500) });

/* ------------------------------------------------------------ CSV import */

export const RATE_CSV_HEADERS = [
  "rate_type",
  "name",
  "uom",
  "unit_rate",
  "currency_code",
  "category",
  "supplier",
  "valid_from",
  "valid_to",
] as const;

export interface ParsedRateCsvRow {
  line: number;
  raw: string[];
  row: RateRow | null;
  errors: string[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Parse pasted CSV into per-row results; header row optional. */
export function parseRateCsv(text: string): ParsedRateCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const first = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first[0] === "rate_type" && first.includes("name");
  const body = hasHeader ? lines.slice(1) : lines;

  return body.map((line, idx) => {
    const cells = splitCsvLine(line);
    const candidate = {
      rate_type: cells[0] ?? "",
      name: cells[1] ?? "",
      uom: cells[2] ?? "",
      unit_rate: cells[3] ?? "",
      currency_code: cells[4] ?? "",
      category: cells[5] || null,
      supplier: cells[6] || null,
      valid_from: cells[7] || null,
      valid_to: cells[8] || null,
    };
    const parsed = RateRowSchema.safeParse(candidate);
    return {
      line: idx + 1 + (hasHeader ? 1 : 0),
      raw: cells,
      row: parsed.success ? parsed.data : null,
      errors: parsed.success
        ? []
        : parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
    };
  });
}

/* ------------------------------------------------------------ BOM import */

export interface BomLineForImport {
  id: string;
  item: string;
  spec: string | null;
  qty_buffered: number;
  unit: string;
  unit_cost: number | null;
}

export interface EstimateLineDraft {
  line_type: EstimateRateType;
  description: string;
  qty: number;
  uom: string;
  unit_rate: number;
  amount: number;
  source_bom_line_id: string;
  sort_order: number;
}

/** Map released BOM lines into estimate lines, preserving traceability. */
export function bomLinesToEstimateLines(lines: readonly BomLineForImport[]): EstimateLineDraft[] {
  return lines.map((l, i) => {
    const qty = Number(l.qty_buffered) || 0;
    const unitRate = Number(l.unit_cost ?? 0) || 0;
    return {
      line_type: "material" as const,
      description: l.spec ? `${l.item} — ${l.spec}` : l.item,
      qty,
      uom: l.unit,
      unit_rate: unitRate,
      amount: lineAmount(qty, unitRate),
      source_bom_line_id: l.id,
      sort_order: i,
    };
  });
}
