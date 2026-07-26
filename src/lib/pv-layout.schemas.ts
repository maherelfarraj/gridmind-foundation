// P-152 — Zod schemas and row types for PV layouts and layout blocks.
import { z } from "zod";

export const PV_LAYOUT_BLOCK_TYPES = [
  "array_table",
  "setback",
  "access_road",
  "internal_road",
  "equipment_pad",
  "inverter_station",
  "transformer_station",
  "substation_zone",
  "drainage_corridor",
  "cable_corridor",
] as const;
export type PvLayoutBlockType = (typeof PV_LAYOUT_BLOCK_TYPES)[number];

export const PV_LAYOUT_BLOCK_LABELS: Record<PvLayoutBlockType, string> = {
  array_table: "Array table",
  setback: "Setback",
  access_road: "Access road",
  internal_road: "Internal road",
  equipment_pad: "Equipment pad",
  inverter_station: "Inverter station",
  transformer_station: "Transformer station",
  substation_zone: "Substation zone",
  drainage_corridor: "Drainage corridor",
  cable_corridor: "Cable corridor",
};

export const PV_LAYOUT_STATUSES = ["draft", "under_review", "approved", "superseded"] as const;
export type PvLayoutStatus = (typeof PV_LAYOUT_STATUSES)[number];

/** Statuses this batch may set directly; approvals arrive with P-153. */
export const PV_LAYOUT_EDITABLE_STATUSES = ["draft", "under_review"] as const;

export const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const blockGeometrySchema = z.object({
  polygon: z.array(pointSchema).min(3, "A block needs at least 3 vertices"),
  rotation_deg: z.number().finite().default(0),
});
export type PvBlockGeometry = z.infer<typeof blockGeometrySchema>;

export const layoutBlockSchema = z.object({
  block_type: z.enum(PV_LAYOUT_BLOCK_TYPES),
  label: z.string().max(64).nullable().default(null),
  geometry: blockGeometrySchema,
  equipment_id: z.string().uuid().nullable().default(null),
  module_rows: z.number().int().positive().nullable().default(null),
  modules_per_row: z.number().int().positive().nullable().default(null),
  module_count: z.number().int().min(0).default(0),
  dc_kwp: z.number().min(0).default(0),
  sort_order: z.number().int().min(0).default(0),
});
export type PvLayoutBlockInput = z.infer<typeof layoutBlockSchema>;

export const layoutParamsSchema = z.object({
  module_id: z.string().uuid().nullable().default(null),
  structure_id: z.string().uuid().nullable().default(null),
  tracker_id: z.string().uuid().nullable().default(null),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  modules_across: z.number().int().positive().max(200).default(28),
  modules_up: z.number().int().positive().max(12).default(2),
  tilt_deg: z.number().min(0).max(89).default(25),
  azimuth_deg: z.number().min(0).max(360).default(180),
  pitch_m: z.number().positive().max(200).default(6),
  row_spacing_m: z.number().min(0).max(200).default(3),
  gcr: z.number().gt(0).max(1).default(0.4),
  setback_m: z.number().min(0).max(500).default(10),
  road_width_m: z.number().min(0).max(50).default(6),
  corridor_width_m: z.number().min(0).max(50).default(4),
  module_wp: z.number().min(0).max(2000).default(0),
});
export type PvLayoutParams = z.infer<typeof layoutParamsSchema>;

export const layoutTotalsSchema = z.object({
  module_count: z.number().int().min(0).default(0),
  table_count: z.number().int().min(0).default(0),
  block_count: z.number().int().min(0).default(0),
  dc_kwp: z.number().min(0).default(0),
  used_area_m2: z.number().min(0).default(0),
  boundary_area_m2: z.number().min(0).default(0),
  compliance: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});
export type PvLayoutTotals = z.infer<typeof layoutTotalsSchema>;

export const createPvLayoutSchema = z.object({
  projectId: z.string().uuid(),
  siteConfigId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1, "Name is required").max(120),
  params: layoutParamsSchema,
  totals: layoutTotalsSchema,
  blocks: z.array(layoutBlockSchema).max(20000),
});
export type CreatePvLayoutInput = z.infer<typeof createPvLayoutSchema>;

export const saveLayoutBlocksSchema = z.object({
  layoutId: z.string().uuid(),
  blocks: z.array(layoutBlockSchema).max(20000),
  totals: layoutTotalsSchema.nullable().default(null),
});
export type SaveLayoutBlocksInput = z.infer<typeof saveLayoutBlocksSchema>;

export const setLayoutStatusSchema = z.object({
  layoutId: z.string().uuid(),
  status: z.enum(PV_LAYOUT_EDITABLE_STATUSES),
});

export interface PvLayoutRow {
  id: string;
  company_id: string;
  project_id: string;
  site_config_id: string | null;
  name: string;
  version: number;
  layout_number: string | null;
  status: PvLayoutStatus;
  params: PvLayoutParams;
  totals: PvLayoutTotals;
  approval_instance_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PvLayoutBlockRow {
  id: string;
  company_id: string;
  layout_id: string;
  block_type: PvLayoutBlockType;
  label: string | null;
  geometry: PvBlockGeometry;
  equipment_id: string | null;
  module_rows: number | null;
  modules_per_row: number | null;
  module_count: number;
  dc_kwp: number;
  sort_order: number;
}

export function defaultLayoutParams(): PvLayoutParams {
  return layoutParamsSchema.parse({});
}

export function defaultLayoutTotals(): PvLayoutTotals {
  return layoutTotalsSchema.parse({});
}
