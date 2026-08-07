// GC-09 — Portfolio Costing saved views: versioned, allowlisted configuration.
//
// A saved view stores *filter state only*. It never stores computed balances,
// so a stale view degrades to the default filters instead of showing stale money.
import { z } from "zod";

export const SAVED_VIEW_CONFIG_VERSION = 1;

export const SAVED_VIEW_COLUMNS = [
  "budget_current",
  "committed",
  "actual",
  "accruals",
  "etc",
  "eac",
  "vac",
  "available",
  "paid",
  "consumed",
] as const;
export type SavedViewColumn = (typeof SAVED_VIEW_COLUMNS)[number];

export const SAVED_VIEW_SORTS = ["code", "eac", "vac", "variance", "close"] as const;

/**
 * Strict schema: unknown keys are rejected rather than round-tripped, so a
 * tampered or future config can never smuggle extra instructions into loaders.
 */
export const savedViewConfigSchema = z
  .object({
    version: z.literal(SAVED_VIEW_CONFIG_VERSION).default(SAVED_VIEW_CONFIG_VERSION),
    /** Which dashboard the view belongs to; older rows default to cost & close. */
    scope: z.enum(["costing", "revenue_wip"]).default("costing"),
    period: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/)
      .nullable()
      .default(null),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    basis: z.enum(["period_end", "latest"]).default("period_end"),
    mode: z.enum(["official", "indicative"]).default("official"),
    project_ids: z.array(z.string().uuid()).max(200).default([]),
    close_states: z
      .array(z.enum(["open", "soft_locked", "hard_closed"]))
      .max(3)
      .default([]),
    materiality_pct: z.number().min(0).max(1).nullable().default(null),
    materiality_abs: z.number().min(0).nullable().default(null),
    sort: z.enum(SAVED_VIEW_SORTS).default("code"),
    columns: z.array(z.enum(SAVED_VIEW_COLUMNS)).max(SAVED_VIEW_COLUMNS.length).default([]),
    // --- Revenue & WIP filters (labels only; never computed balances) --------
    rec_status: z.string().max(24).nullable().default(null),
    rec_method: z.string().max(48).nullable().default(null),
    rec_customer: z.string().max(200).nullable().default(null),
    rec_project: z.string().max(200).nullable().default(null),
  })
  .strict();


export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>;

export const DEFAULT_SAVED_VIEW_CONFIG: SavedViewConfig = savedViewConfigSchema.parse({});

/** Parse a persisted config, degrading safely to defaults when it is invalid. */
export function parseSavedViewConfig(raw: unknown): SavedViewConfig {
  const result = savedViewConfigSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_SAVED_VIEW_CONFIG;
}

export const savedViewNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((s) => s.replace(/\s+/g, " "));

export const savedViewCreateSchema = z
  .object({
    name: savedViewNameSchema,
    description: z.string().trim().max(280).nullable().default(null),
    config: savedViewConfigSchema,
    is_shared: z.boolean().default(false),
    is_default: z.boolean().default(false),
  })
  .strict();

export const savedViewUpdateSchema = z
  .object({
    id: z.string().uuid(),
    name: savedViewNameSchema.optional(),
    description: z.string().trim().max(280).nullable().optional(),
    config: savedViewConfigSchema.optional(),
    is_shared: z.boolean().optional(),
    is_default: z.boolean().optional(),
  })
  .strict();

export const savedViewIdSchema = z.object({ id: z.string().uuid() }).strict();

export const savedViewDuplicateSchema = z
  .object({ id: z.string().uuid(), name: savedViewNameSchema })
  .strict();

export type SavedViewCreateInput = z.infer<typeof savedViewCreateSchema>;
export type SavedViewUpdateInput = z.infer<typeof savedViewUpdateSchema>;

export interface SavedView {
  id: string;
  name: string;
  description: string | null;
  config: SavedViewConfig;
  config_version: number;
  is_shared: boolean;
  is_default: boolean;
  owner_id: string;
  owner_name: string | null;
  /** True when the signed-in user owns the view and may mutate it. */
  is_owner: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// URL <-> config
// ---------------------------------------------------------------------------
export interface PortfolioCostingSearch {
  period?: string;
  currency?: string;
  basis?: "period_end" | "latest";
  view?: string;
}

/** Only URL-addressable filters are shareable; private ids stay out of links. */
export function configToSearch(config: SavedViewConfig): PortfolioCostingSearch {
  const out: PortfolioCostingSearch = {};
  if (config.period) out.period = config.period;
  if (config.currency) out.currency = config.currency;
  if (config.basis !== "period_end") out.basis = config.basis;
  return out;
}

export function searchToConfig(
  search: PortfolioCostingSearch,
  base: SavedViewConfig = DEFAULT_SAVED_VIEW_CONFIG,
): SavedViewConfig {
  return savedViewConfigSchema.parse({
    ...base,
    period: search.period ?? base.period,
    currency: search.currency ?? base.currency,
    basis: search.basis ?? base.basis,
  });
}

/**
 * Explicit URL parameters always win over the user's default view, so a shared
 * link opens the same numbers for everyone regardless of personal defaults.
 */
export function resolveEntrySearch(
  urlSearch: PortfolioCostingSearch,
  defaultView: SavedView | null,
): PortfolioCostingSearch {
  if (!defaultView) return urlSearch;
  const fromView = configToSearch(defaultView.config);
  return {
    period: urlSearch.period ?? fromView.period,
    currency: urlSearch.currency ?? fromView.currency,
    basis: urlSearch.basis ?? fromView.basis,
  };
}

/** Shared views may be copied but never mutated by a non-owner. */
export function canMutateView(view: SavedView, userId: string): boolean {
  return view.owner_id === userId;
}
