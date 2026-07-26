// P-150 — PV equipment library schemas (client-safe; shared by forms + server fns).
import { z } from "zod";

export const PV_CATEGORIES = [
  "module",
  "inverter",
  "optimizer",
  "tracker",
  "structure",
  "transformer",
  "cable",
  "combiner_box",
  "switchgear",
  "bess",
] as const;
export type PvCategory = (typeof PV_CATEGORIES)[number];

export const PV_CATEGORY_LABELS: Record<PvCategory, string> = {
  module: "Modules",
  inverter: "Inverters",
  optimizer: "Optimizers",
  tracker: "Trackers",
  structure: "Structures",
  transformer: "Transformers",
  cable: "Cables",
  combiner_box: "Combiner boxes",
  switchgear: "Switchgear",
  bess: "BESS",
};

const num = z.number().finite();
const optNum = num.nullable().optional();
const posNum = num.positive("Must be greater than zero").nullable().optional();

export const efficiencySchema = num
  .min(80, "Efficiency must be at least 80%")
  .max(99.5, "Efficiency must be at most 99.5%")
  .nullable()
  .optional();

export const electricalSchema = z.object({
  // module
  pmax_w: posNum,
  voc_v: posNum,
  isc_a: posNum,
  vmp_v: posNum,
  imp_a: posNum,
  cells: posNum,
  bifaciality_pct: optNum,
  // inverter
  ac_kw: posNum,
  mppt_count: posNum,
  mppt_v_min: posNum,
  mppt_v_max: posNum,
  max_dc_v: posNum,
  max_dc_a: posNum,
  euro_efficiency_pct: efficiencySchema,
  // generic
  efficiency_pct: efficiencySchema,
  rated_kva: posNum,
  rated_voltage_v: posNum,
  rated_current_a: posNum,
  energy_kwh: posNum,
});

export const tempCoefficientsSchema = z.object({
  pmax_pct_per_c: optNum,
  voc_pct_per_c: optNum,
  isc_pct_per_c: optNum,
  noct_c: optNum,
});

export const degradationSchema = z.object({
  year_one_pct: optNum,
  annual_pct: optNum,
});

export const dimensionsSchema = z.object({
  length_mm: posNum,
  width_mm: posNum,
  depth_mm: posNum,
  weight_kg: posNum,
});

export const limitsSchema = z.object({
  max_system_voltage_v: posNum,
  max_series_fuse_a: posNum,
  operating_temp_min_c: optNum,
  operating_temp_max_c: optNum,
});

export const certificationSchema = z.object({
  standard: z.string().trim().min(1, "Standard is required").max(120),
  certificate_no: z.string().trim().max(120).nullable().optional(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional(),
});
export type PvCertification = z.infer<typeof certificationSchema>;

export const performanceTermSchema = z.object({
  year: num.int().positive(),
  min_output_pct: num.min(0).max(100),
});

export const warrantiesSchema = z.object({
  product_years: posNum,
  performance_years: posNum,
  performance_terms: z.array(performanceTermSchema).max(20).optional(),
});

export const pvDocSchema = z.object({
  name: z.string(),
  path: z.string(),
  uploaded_at: z.string(),
});
export type PvDoc = z.infer<typeof pvDocSchema>;

export const pvEquipmentBaseSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  category: z.enum(PV_CATEGORIES),
  manufacturer: z.string().trim().min(2, "Manufacturer is required").max(160),
  model: z.string().trim().min(1, "Model is required").max(160),
  is_active: z.boolean().default(true),
  electrical: electricalSchema.default({}),
  temp_coefficients: tempCoefficientsSchema.default({}),
  degradation: degradationSchema.default({}),
  dimensions: dimensionsSchema.default({}),
  limits: limitsSchema.default({}),
  warranties: warrantiesSchema.default({}),
  certifications: z.array(certificationSchema).max(30).default([]),
});

/** Cross-field electrical rules shared by the form and the server. */
export function refinePvEquipment(
  value: z.infer<typeof pvEquipmentBaseSchema>,
  ctx: z.RefinementCtx,
) {
  const e = value.electrical ?? {};
  const l = value.limits ?? {};

  if (
    e.voc_v != null &&
    l.max_system_voltage_v != null &&
    e.voc_v >= l.max_system_voltage_v
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["electrical", "voc_v"],
      message: "Voc must be below the maximum system voltage",
    });
  }

  if (e.mppt_v_min != null && e.mppt_v_max != null && e.mppt_v_min >= e.mppt_v_max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["electrical", "mppt_v_min"],
      message: "MPPT minimum voltage must be below the maximum",
    });
  }

  if (e.vmp_v != null && e.voc_v != null && e.vmp_v > e.voc_v) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["electrical", "vmp_v"],
      message: "Vmp cannot exceed Voc",
    });
  }
}

export const pvEquipmentSchema = pvEquipmentBaseSchema.superRefine(refinePvEquipment);
export type PvEquipmentInput = z.infer<typeof pvEquipmentSchema>;

export interface PvEquipmentRow {
  id: string;
  company_id: string;
  category: PvCategory;
  manufacturer: string;
  model: string;
  datasheet_path: string | null;
  certifications: PvCertification[];
  warranties: Record<string, unknown>;
  degradation: Record<string, unknown>;
  electrical: Record<string, number | null>;
  temp_coefficients: Record<string, number | null>;
  dimensions: Record<string, number | null>;
  limits: Record<string, number | null>;
  docs: PvDoc[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function isCertificationExpired(validUntil?: string | null, now = new Date()): boolean {
  if (!validUntil) return false;
  const d = new Date(`${validUntil}T23:59:59Z`);
  return Number.isFinite(d.getTime()) && d.getTime() < now.getTime();
}
