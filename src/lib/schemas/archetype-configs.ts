// P-039 — Zod registry for project archetype configuration tables.
// Mirrors migration 0013 columns; reused by both client forms and the server
// upsert RPC so validation is identical on both sides.
import { z } from "zod";

import type { ProjectArchetype } from "@/lib/wizard-draft";

// Helpers ---------------------------------------------------------------

const emptyToUndef = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const optNum = (opts?: { min?: number; max?: number }) =>
  z.preprocess(
    emptyToUndef,
    z
      .coerce
      .number()
      .refine((n) => !Number.isNaN(n), "Must be a number")
      .refine((n) => opts?.min === undefined || n >= opts.min, {
        message: `Must be ≥ ${opts?.min}`,
      })
      .refine((n) => opts?.max === undefined || n <= opts.max, {
        message: `Must be ≤ ${opts?.max}`,
      })
      .optional(),
  ) as z.ZodType<number | undefined>;

const optInt = (opts?: { min?: number; max?: number }) =>
  z.preprocess(
    emptyToUndef,
    z
      .coerce
      .number()
      .int("Must be a whole number")
      .refine((n) => opts?.min === undefined || n >= opts.min, {
        message: `Must be ≥ ${opts?.min}`,
      })
      .refine((n) => opts?.max === undefined || n <= opts.max, {
        message: `Must be ≤ ${opts?.max}`,
      })
      .optional(),
  ) as z.ZodType<number | undefined>;

const optStr = (max = 240) =>
  z.preprocess(
    emptyToUndef,
    z.string().trim().max(max).optional(),
  ) as z.ZodType<string | undefined>;

const kvPair = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().min(0).max(240),
});
export type KeyValuePair = z.infer<typeof kvPair>;
const kvArray = z.array(kvPair).default([]);

// Schemas ---------------------------------------------------------------

export const pvConfigSchema = z.object({
  module_type: optStr(120),
  tracker_type: z.enum(["fixed", "single_axis", "dual_axis"]),
  tilt_deg: optNum({ min: 0, max: 90 }),
  gcr: optNum({ min: 0, max: 1 }),
  dc_ac_ratio: optNum({ min: 0.5, max: 2 }),
  dc_capacity_mwp: optNum({ min: 0 }),
  inverter_count: optInt({ min: 0 }),
});

export const bessConfigSchema = z.object({
  chemistry: z.enum(["lfp", "nmc", "flow", "other"]),
  power_mw: optNum({ min: 0 }),
  energy_mwh: optNum({ min: 0 }),
  duration_hours: optNum({ min: 0, max: 24 }),
  pcs_count: optInt({ min: 0 }),
  container_count: optInt({ min: 0 }),
  cycles_per_day: optNum({ min: 0, max: 10 }),
  augmentation_strategy: optStr(1000),
});

export const substationConfigSchema = z.object({
  voltage_kv: optNum({ min: 0 }),
  transformer_count: optInt({ min: 0 }),
  transformer_mva: optNum({ min: 0 }),
  bay_count: optInt({ min: 0 }),
  busbar_scheme: optStr(120),
  grid_code: optStr(120),
});

export const sldConfigSchema = z.object({
  hv_voltage_kv: optNum({ min: 0 }),
  mv_voltage_kv: optNum({ min: 0 }),
  lv_voltage_kv: optNum({ min: 0 }),
  voltage_levels: kvArray,
});

export const scadaConfigSchema = z.object({
  protocol: z.enum(["modbus_tcp", "iec61850", "dnp3", "opc_ua"]),
  polling_interval_sec: optInt({ min: 1, max: 3600 }),
  points_count: optInt({ min: 0 }),
  historian_retention_days: optInt({ min: 1, max: 3650 }),
});

export const yieldConfigSchema = z.object({
  p50_mwh: optNum({ min: 0 }),
  p90_mwh: optNum({ min: 0 }),
  ghi_kwh_m2: optNum({ min: 0 }),
  losses_pct: optNum({ min: 0, max: 100 }),
  degradation_pct: optNum({ min: 0, max: 10 }),
  availability_pct: optNum({ min: 0, max: 100 }),
});

export const pvsystConfigSchema = z.object({
  pvsyst_version: optStr(40),
  meteo_source: optStr(120),
  sim_report_url: optStr(500),
  near_shading_pct: optNum({ min: 0, max: 100 }),
  albedo: optNum({ min: 0, max: 1 }),
  bifacial: z.boolean().default(false),
});

export const financialConfigSchema = z.object({
  currency_code: z.string().trim().length(3).default("USD"),
  capex_total: optNum({ min: 0 }),
  contingency_pct: optNum({ min: 0, max: 100 }),
  debt_ratio_pct: optNum({ min: 0, max: 100 }),
  discount_rate_pct: optNum({ min: 0, max: 100 }),
  ppa_price: optNum({ min: 0 }),
  contract_years: optInt({ min: 0, max: 60 }),
});

export const cybersecurityConfigSchema = z.object({
  standard: z.enum(["iec62443", "nerc_cip", "iso27019"]),
  zones_conduits: kvArray,
  remote_access_policy: optStr(2000),
  soc_monitoring: z.boolean().default(false),
});

// Registry --------------------------------------------------------------

export const configSchemas = {
  pv: pvConfigSchema,
  bess: bessConfigSchema,
  substation: substationConfigSchema,
  sld: sldConfigSchema,
  scada: scadaConfigSchema,
  yield: yieldConfigSchema,
  pvsyst: pvsystConfigSchema,
  financial: financialConfigSchema,
  cybersecurity: cybersecurityConfigSchema,
} as const;

export type ArchetypeConfigKey = keyof typeof configSchemas;

export const ARCHETYPE_CONFIG_KEYS = [
  "pv",
  "bess",
  "substation",
  "sld",
  "scada",
  "yield",
  "pvsyst",
  "financial",
  "cybersecurity",
] as const satisfies readonly ArchetypeConfigKey[];

export const CONFIG_LABELS: Record<ArchetypeConfigKey, string> = {
  pv: "PV",
  bess: "BESS",
  substation: "Substation",
  sld: "SLD",
  scada: "SCADA",
  yield: "Yield",
  pvsyst: "PVsyst",
  financial: "Financial",
  cybersecurity: "Cybersecurity",
};

export const CONFIG_TABLE_MAP: Record<ArchetypeConfigKey, string> = {
  pv: "project_pv_config",
  bess: "project_bess_config",
  substation: "project_substation_config",
  sld: "project_sld_config",
  scada: "project_scada_config",
  yield: "project_yield_config",
  pvsyst: "project_pvsyst_config",
  financial: "project_financial_config",
  cybersecurity: "project_cybersecurity_config",
};

export const ARCHETYPE_CONFIG_MAP: Record<ProjectArchetype, ArchetypeConfigKey[]> = {
  utility_pv: ["pv", "sld", "scada", "yield", "pvsyst", "financial", "cybersecurity"],
  hybrid_pv_bess: [
    "pv",
    "bess",
    "sld",
    "scada",
    "yield",
    "pvsyst",
    "financial",
    "cybersecurity",
  ],
  standalone_bess: ["bess", "sld", "scada", "financial", "cybersecurity"],
  c_and_i_rooftop: ["pv", "yield", "financial", "cybersecurity"],
  onshore_wind: ["yield", "sld", "scada", "financial", "cybersecurity"],
  green_hydrogen: ["yield", "scada", "financial", "cybersecurity"],
  transmission_substation: [
    "substation",
    "sld",
    "scada",
    "financial",
    "cybersecurity",
  ],
};

// Server-safe defaults (used when no row exists yet) --------------------

export const CONFIG_DEFAULTS: {
  [K in ArchetypeConfigKey]: z.infer<(typeof configSchemas)[K]>;
} = {
  pv: { tracker_type: "fixed" } as z.infer<typeof pvConfigSchema>,
  bess: { chemistry: "lfp" } as z.infer<typeof bessConfigSchema>,
  substation: {} as z.infer<typeof substationConfigSchema>,
  sld: { voltage_levels: [] } as z.infer<typeof sldConfigSchema>,
  scada: {
    protocol: "modbus_tcp",
    polling_interval_sec: 5,
    historian_retention_days: 400,
  } as z.infer<typeof scadaConfigSchema>,
  yield: {} as z.infer<typeof yieldConfigSchema>,
  pvsyst: { bifacial: false } as z.infer<typeof pvsystConfigSchema>,
  financial: { currency_code: "USD" } as z.infer<typeof financialConfigSchema>,
  cybersecurity: {
    standard: "iec62443",
    zones_conduits: [],
    soc_monitoring: false,
  } as z.infer<typeof cybersecurityConfigSchema>,
};

/**
 * Which roles may edit a given config section. Used both server-side (auth
 * check) and client-side (to render the "read only" hint).
 */
export const CONFIG_EDIT_ROLES: Record<ArchetypeConfigKey, readonly string[]> = {
  pv: ["company_admin", "project_admin", "engineering_admin"],
  bess: ["company_admin", "project_admin", "engineering_admin"],
  substation: ["company_admin", "project_admin", "engineering_admin"],
  sld: ["company_admin", "project_admin", "engineering_admin"],
  scada: ["company_admin", "project_admin", "engineering_admin"],
  yield: ["company_admin", "project_admin", "engineering_admin"],
  pvsyst: ["company_admin", "project_admin", "engineering_admin"],
  financial: [
    "company_admin",
    "project_admin",
    "engineering_admin",
    "finance_admin",
  ],
  cybersecurity: ["company_admin", "project_admin", "engineering_admin"],
};
