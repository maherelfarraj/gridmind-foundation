// P-102 — Pure rules for SCADA connectors (schemas + KPI reducer).
// Kept out of *.functions.ts so tests can import without server-fn transforms.
import { z } from "zod";

import {
  modbusProtocolSchema,
  mqttProtocolSchema,
  opcuaProtocolSchema,
  scheduleSchema,
} from "@/lib/scada/connector-config";

// Env-var NAME shape. Uppercase letters/digits/underscores, starts with a
// letter, 3–64 chars. Prevents leaking a real token in place of a name.
export const CREDENTIALS_REF_REGEX = /^[A-Z][A-Z0-9_]{2,63}$/;

// Extra token-shaped rejections. These are safe to run before the regex —
// they produce clearer error messages for common paste-mistakes.
const TOKEN_SHAPES: readonly RegExp[] = [
  /^sk_/i,
  /^pk_/i,
  /^Bearer\s/i,
  /^eyJ[A-Za-z0-9_-]+\./, // JWT-ish
  /^ghp_/i,
  /^xox[baprs]-/i,
];

export function looksLikeSecret(value: string): boolean {
  if (/\s/.test(value)) return true;
  if (value.length > 64) return true;
  return TOKEN_SHAPES.some((r) => r.test(value));
}

export const credentialsRefSchema = z
  .string()
  .trim()
  .min(3, "Enter a variable name (min 3 chars)")
  .max(64, "Variable name too long")
  .refine(
    (v) => !looksLikeSecret(v),
    "Enter the variable NAME (e.g. SCADA_VENDOR_TOKEN) — never a real token",
  )
  .refine(
    (v) => CREDENTIALS_REF_REGEX.test(v),
    "Use UPPER_SNAKE_CASE (letters, digits, underscores)",
  );

export const CONNECTOR_TYPES = [
  "modbus_tcp",
  "iec61850",
  "sunspec",
  "mqtt",
  "vendor_api",
  "csv_import",
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const ASSET_TYPES = [
  "inverter",
  "meter",
  "weather_station",
  "plant_controller",
  "bess",
  "combiner",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const EQUIPMENT_TYPES = [
  "inverter",
  "module_string",
  "tracker",
  "transformer",
  "meter",
  "weather_station",
  "bess_container",
  "battery_rack",
  "pcs",
  "switchgear",
  "other",
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

// Per-type config validators. `.strict()` drops unknown keys so nothing
// masquerading as a credential slips through.
const baseCfg = z.object({
  credentials_ref: credentialsRefSchema.optional(),
  // P-172 — additive per-protocol mapping + scheduled-pull blocks. Stored in
  // scada_connectors.config jsonb; never contains credential values.
  mqtt: mqttProtocolSchema.optional(),
  opcua: opcuaProtocolSchema.optional(),
  modbus: modbusProtocolSchema.optional(),
  schedule: scheduleSchema.optional(),
});

const modbusCfg = baseCfg
  .extend({
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    unit_ids: z.array(z.coerce.number().int().min(0).max(255)).min(1),
    poll_interval_s: z.coerce.number().int().min(1).max(3600).default(5),
  })
  .strict();

const iecCfg = baseCfg
  .extend({
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    poll_interval_s: z.coerce.number().int().min(1).max(3600).default(5),
  })
  .strict();

const sunspecCfg = modbusCfg;

const mqttCfg = baseCfg
  .extend({
    broker_url: z.string().url(),
    topic: z.string().min(1),
    poll_interval_s: z.coerce.number().int().min(1).max(3600).optional(),
  })
  .strict();

const vendorApiCfg = baseCfg
  .extend({
    base_url: z.string().url(),
    poll_interval_s: z.coerce.number().int().min(5).max(3600).default(60),
  })
  .strict();

const csvCfg = baseCfg
  .extend({
    source_label: z.string().min(1),
  })
  .strict();

export function connectorConfigSchema(type: ConnectorType) {
  switch (type) {
    case "modbus_tcp":
      return modbusCfg;
    case "iec61850":
      return iecCfg;
    case "sunspec":
      return sunspecCfg;
    case "mqtt":
      return mqttCfg;
    case "vendor_api":
      return vendorApiCfg;
    case "csv_import":
      return csvCfg;
  }
}

export const createConnectorSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  connector_type: z.enum(CONNECTOR_TYPES),
  asset_kind: z.enum(ASSET_TYPES),
  config: z.record(z.string(), z.unknown()),
});

export const toggleConnectorSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export const updateConnectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const upsertAssetsSchema = z.object({
  connector_id: z.string().uuid(),
  assets: z
    .array(
      z.object({
        asset_key: z.string().trim().min(1).max(128),
        asset_type: z.enum(ASSET_TYPES),
        name: z.string().trim().min(1).max(120),
        site_label: z.string().trim().max(80).optional(),
        equipment: z.object({
          tag: z.string().trim().min(1).max(80),
          equipment_type: z.enum(EQUIPMENT_TYPES),
          manufacturer: z.string().trim().max(80).optional(),
          model: z.string().trim().max(80).optional(),
        }),
      }),
    )
    .min(1)
    .max(500),
});

// -- KPI reducer -------------------------------------------------------------
export interface ConnectorKpiInput {
  status: string;
  enabled: boolean;
  last_seen_at: string | null;
  assets_count: number;
}
export interface ConnectorKpis {
  activeCount: number;
  totalCount: number;
  assetsMapped: number;
  lastTelemetryAt: string | null;
}
export function computeConnectorKpis(rows: readonly ConnectorKpiInput[]): ConnectorKpis {
  let active = 0;
  let assets = 0;
  let lastMs = -Infinity;
  for (const r of rows) {
    if (r.enabled && r.status === "active") active += 1;
    assets += r.assets_count;
    if (r.last_seen_at) {
      const t = Date.parse(r.last_seen_at);
      if (!Number.isNaN(t) && t > lastMs) lastMs = t;
    }
  }
  return {
    activeCount: active,
    totalCount: rows.length,
    assetsMapped: assets,
    lastTelemetryAt: lastMs === -Infinity ? null : new Date(lastMs).toISOString(),
  };
}
