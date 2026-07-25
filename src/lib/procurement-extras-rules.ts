// P-070 — Pure rules & zod schemas for material price alerts and spare parts.
import { z } from "zod";

export const MATERIAL_CATEGORIES = [
  "module",
  "inverter",
  "tracker",
  "battery_cell",
  "transformer",
  "cable_copper",
  "cable_alu",
  "steel",
  "concrete",
  "other",
] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  module: "PV Module",
  inverter: "Inverter",
  tracker: "Tracker",
  battery_cell: "Battery Cell",
  transformer: "Transformer",
  cable_copper: "Cable (Cu)",
  cable_alu: "Cable (Al)",
  steel: "Steel",
  concrete: "Concrete",
  other: "Other",
};

/** Percentage change from prev → next; null when prev is missing/zero. */
export function computeChangePct(
  previous: number | null | undefined,
  next: number | null | undefined,
): number | null {
  if (previous == null || next == null) return null;
  if (previous === 0) return null;
  const pct = ((next - previous) / previous) * 100;
  return Math.round(pct * 100) / 100;
}

export function shouldTrigger(changePct: number | null, thresholdPct: number): boolean {
  if (changePct == null) return false;
  if (thresholdPct <= 0) return false;
  return Math.abs(changePct) >= thresholdPct;
}

export function isLowStock(qtyOnHand: number, reorderPoint: number): boolean {
  return qtyOnHand <= reorderPoint;
}

/** Apply a signed delta; result is floored at zero. */
export function applyStockDelta(qty: number, delta: number): number {
  const next = qty + delta;
  return next < 0 ? 0 : next;
}

// ---------------------------------------------------------------------------
// zod
// ---------------------------------------------------------------------------
export const materialCategoryEnum = z.enum(MATERIAL_CATEGORIES);

export const alertSubscriptionSchema = z.object({
  id: z.string().uuid().optional(),
  category: materialCategoryEnum,
  region: z.string().trim().min(1).max(64).default("global"),
  unit: z.string().trim().min(1).max(32),
  currency_code: z.string().trim().length(3).toUpperCase(),
  alert_threshold_pct: z.coerce.number().gt(0).max(100),
  source: z.string().trim().max(120).optional().nullable(),
});
export type AlertSubscriptionInput = z.infer<typeof alertSubscriptionSchema>;

export const priceObservationSchema = z.object({
  id: z.string().uuid(),
  index_price: z.coerce.number().nonnegative(),
  source: z.string().trim().max(120).optional().nullable(),
  observed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type PriceObservationInput = z.infer<typeof priceObservationSchema>;

export const sparePartSchema = z.object({
  id: z.string().uuid().optional(),
  part_number: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  category: materialCategoryEnum.default("other"),
  compatible_equipment: z.string().trim().max(200).optional().nullable(),
  uom: z.string().trim().min(1).max(16).default("ea"),
  unit_cost: z.coerce.number().nonnegative().nullable().optional(),
  currency_code: z.string().trim().length(3).toUpperCase().nullable().optional(),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  reorder_point: z.coerce.number().int().nonnegative().default(0),
  safety_stock: z.coerce.number().int().nonnegative().default(0),
  lead_time_days: z.coerce.number().int().nonnegative().nullable().optional(),
  qty_on_hand: z.coerce.number().int().nonnegative().default(0),
  location: z.string().trim().max(120).optional().nullable(),
});
export type SparePartInput = z.infer<typeof sparePartSchema>;

export const stockAdjustSchema = z.object({
  id: z.string().uuid(),
  delta: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, "delta must be non-zero"),
  reason: z.string().trim().min(3, "reason is required").max(240),
});
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;
