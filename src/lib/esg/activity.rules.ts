// P-216 — Pure rules for the ESG activity register. No I/O: safe to unit test.
import { z } from "zod";

export const ESG_CATEGORIES = [
  "fuel_diesel",
  "fuel_petrol",
  "fuel_lpg",
  "electricity_grid",
  "electricity_generator",
  "transport_road",
  "transport_air",
  "transport_sea",
  "materials_concrete",
  "materials_steel",
  "materials_cable",
  "waste_general",
  "waste_hazardous",
  "waste_recyclable",
  "other",
] as const;

export type EsgCategory = (typeof ESG_CATEGORIES)[number];

export const ESG_CATEGORY_LABEL: Record<EsgCategory, string> = {
  fuel_diesel: "Diesel",
  fuel_petrol: "Petrol",
  fuel_lpg: "LPG",
  electricity_grid: "Grid electricity",
  electricity_generator: "Generator electricity",
  transport_road: "Road transport",
  transport_air: "Air transport",
  transport_sea: "Sea freight",
  materials_concrete: "Concrete",
  materials_steel: "Steel",
  materials_cable: "Cable",
  waste_general: "General waste",
  waste_hazardous: "Hazardous waste",
  waste_recyclable: "Recyclable waste",
  other: "Other",
};

export const ESG_TABS = [
  "fuel",
  "electricity",
  "transport",
  "materials",
  "waste",
  "other",
] as const;
export type EsgTab = (typeof ESG_TABS)[number];

export const ESG_TAB_LABEL: Record<EsgTab, string> = {
  fuel: "Fuel",
  electricity: "Electricity",
  transport: "Transport",
  materials: "Materials",
  waste: "Waste",
  other: "Other",
};

export function tabOfCategory(category: EsgCategory): EsgTab {
  const prefix = category.split("_")[0] as EsgTab;
  return (ESG_TABS as readonly string[]).includes(prefix) ? prefix : "other";
}

export function categoriesForTab(tab: EsgTab): EsgCategory[] {
  return ESG_CATEGORIES.filter((c) => tabOfCategory(c) === tab);
}

export const ESG_SOURCES = ["manual", "equipment_fuel", "waste", "import"] as const;
export type EsgSource = (typeof ESG_SOURCES)[number];

export const ESG_SOURCE_LABEL: Record<EsgSource, string> = {
  manual: "Manual entry",
  equipment_fuel: "Imported from equipment records",
  waste: "Imported from waste log",
  import: "CSV import",
};

/* ------------------------------- month utils ------------------------------ */

/** Normalise any YYYY-MM or YYYY-MM-DD value to the first day of the month. */
export function firstOfMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (!match) throw new Error("invalid_month");
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("invalid_month");
  return `${match[1]}-${match[2]}-01`;
}

export function monthKey(value: string): string {
  return firstOfMonth(value).slice(0, 7);
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string): { from: string; to: string } {
  const from = firstOfMonth(month);
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from, to: d.toISOString().slice(0, 10) };
}

/* ------------------------------ fingerprints ------------------------------ */

export function equipmentFuelFingerprint(projectId: string, month: string): string {
  return `equipment_fuel:${projectId}:${monthKey(month)}:fuel_diesel`;
}

export function wasteFingerprint(wasteRowId: string): string {
  return `waste:${wasteRowId}`;
}

/** Small stable hash so identical CSV rows collide and different ones don't. */
export function rowHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function csvFingerprint(
  projectId: string,
  month: string,
  category: EsgCategory,
  hash: string,
): string {
  return `import:${projectId}:${monthKey(month)}:${category}:${hash}`;
}

export const WASTE_TYPE_TO_CATEGORY: Record<string, EsgCategory> = {
  general: "waste_general",
  hazardous: "waste_hazardous",
  recyclable: "waste_recyclable",
};

/* --------------------------------- schemas -------------------------------- */

const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM")
  .refine((v) => {
    const m = Number(v.slice(5, 7));
    return m >= 1 && m <= 12;
  }, "Use YYYY-MM");

export const activityListSchema = z.object({
  projectId: z.string().uuid(),
  month: monthSchema,
});

export const manualActivitySchema = z.object({
  projectId: z.string().uuid(),
  month: monthSchema,
  category: z.enum(ESG_CATEGORIES),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().trim().min(1, "Unit is required").max(24),
  notes: z.string().trim().max(1000).optional().nullable(),
  evidencePath: z.string().trim().max(512).optional().nullable(),
});

export const updateActivitySchema = z.object({
  id: z.string().uuid(),
  category: z.enum(ESG_CATEGORIES),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().trim().min(1).max(24),
  notes: z.string().trim().max(1000).optional().nullable(),
  evidencePath: z.string().trim().max(512).optional().nullable(),
});

export const csvRowSchema = z.object({
  category: z.enum(ESG_CATEGORIES),
  quantity: z.coerce.number().positive(),
  unit: z.string().trim().min(1).max(24),
  month: monthSchema,
});

export type CsvRowInput = z.infer<typeof csvRowSchema>;

export type CsvPreviewRow = {
  line: number;
  raw: string;
  ok: boolean;
  error?: string;
  value?: CsvRowInput & { hash: string };
};

/** Parse `category,quantity,unit,YYYY-MM` lines into a validated preview. */
export function parseActivityCsv(text: string): CsvPreviewRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((raw, index) => {
    const line = index + 1;
    if (/^category\s*,/i.test(raw)) {
      return { line, raw, ok: false, error: "Header row skipped" };
    }
    const parts = raw.split(",").map((p) => p.trim());
    if (parts.length !== 4) {
      return { line, raw, ok: false, error: "Expected 4 columns: category,quantity,unit,YYYY-MM" };
    }
    const parsed = csvRowSchema.safeParse({
      category: parts[0],
      quantity: parts[1],
      unit: parts[2],
      month: parts[3],
    });
    if (!parsed.success) {
      return { line, raw, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid row" };
    }
    return {
      line,
      raw,
      ok: true,
      value: { ...parsed.data, hash: rowHash(parts.join("|").toLowerCase()) },
    };
  });
}

/* ------------------------------ evidence rules ----------------------------- */

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

export function evidenceError(file: { size: number; type: string }): string | null {
  if (!(EVIDENCE_MIME as readonly string[]).includes(file.type)) {
    return "Evidence must be a PDF, JPG or PNG file";
  }
  if (file.size > EVIDENCE_MAX_BYTES) return "Evidence must be 10 MB or smaller";
  return null;
}

export function evidencePath(args: {
  companyId: string;
  projectId: string;
  activityId: string;
  fileName: string;
}): string {
  const safe = args.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  return `${args.companyId}/esg/evidence/${args.projectId}/${args.activityId}/${safe}`;
}

/* --------------------------------- factors -------------------------------- */

export type FactorRow = {
  id: string;
  company_id: string | null;
  category: EsgCategory;
  unit: string;
  kg_co2e_per_unit: number;
  factor_source: string;
};

export type ResolvedFactor = {
  category: EsgCategory;
  unit: string;
  kgCo2ePerUnit: number;
  factorSource: string;
  scope: "company" | "global";
};

/** Company override wins over the global default for the same category. */
export function resolveFactors(rows: FactorRow[]): Record<string, ResolvedFactor> {
  const out: Record<string, ResolvedFactor> = {};
  for (const row of rows) {
    const scope: ResolvedFactor["scope"] = row.company_id ? "company" : "global";
    const existing = out[row.category];
    if (existing && existing.scope === "company" && scope === "global") continue;
    out[row.category] = {
      category: row.category,
      unit: row.unit,
      kgCo2ePerUnit: Number(row.kg_co2e_per_unit),
      factorSource: row.factor_source,
      scope,
    };
  }
  return out;
}

export function formatQuantity(value: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
