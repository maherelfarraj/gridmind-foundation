/**
 * P-172 — SCADA ingestion expansion: protocol mappings, historian CSV parsing
 * and ingestion-health scoring.
 *
 * Pure functions only: no React, no Supabase, no server imports.
 */
import { z } from "zod";

export const TAG_PROTOCOLS = ["mqtt", "opcua", "modbus", "historian_csv", "vendor_api"] as const;
export type TagProtocol = (typeof TAG_PROTOCOLS)[number];

export const PROTOCOL_LABELS: Record<TagProtocol, string> = {
  mqtt: "MQTT",
  opcua: "OPC UA",
  modbus: "Modbus",
  historian_csv: "Historian CSV",
  vendor_api: "Vendor API",
};

export const MAPPING_DATA_TYPES = [
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
  "bool",
  "string",
] as const;
export type MappingDataType = (typeof MAPPING_DATA_TYPES)[number];

export const BYTE_ORDERS = ["big_endian", "little_endian", "word_swapped"] as const;
export type ByteOrder = (typeof BYTE_ORDERS)[number];

// ---------------------------------------------------------------- addresses --

/** MQTT topic: slash-separated levels, `+` single-level and trailing `#`. */
export function isValidMqttTopic(topic: string): boolean {
  if (topic.length === 0 || topic.length > 512) return false;
  const levels = topic.split("/");
  return levels.every((level, i) => {
    if (level === "#") return i === levels.length - 1;
    if (level === "+") return true;
    return !level.includes("#") && !level.includes("+");
  });
}

/** Match a concrete topic against a subscription filter with `+` / `#`. */
export function matchMqttTopic(filter: string, topic: string): boolean {
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === "#") return true;
    if (i >= t.length) return false;
    if (f[i] === "+") continue;
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** OPC UA NodeId: `ns=<int>;i|s|g|b=<identifier>`. */
export const OPCUA_NODE_ID_REGEX = /^ns=\d+;(i=\d+|s=.+|g=[0-9a-fA-F-]{36}|b=[A-Za-z0-9+/=]+)$/;
export function isValidOpcUaNodeId(nodeId: string): boolean {
  return nodeId.length <= 512 && OPCUA_NODE_ID_REGEX.test(nodeId);
}

export interface ModbusAddress {
  unitId: number;
  register: number;
  count: number;
  area: "holding" | "input" | "coil" | "discrete";
}

const MODBUS_AREAS: Record<string, ModbusAddress["area"]> = {
  hr: "holding",
  ir: "input",
  co: "coil",
  di: "discrete",
};

/**
 * Modbus address syntax: `<unit>:<area>:<register>[:<count>]`
 * e.g. `1:hr:40071:2` — unit 1, holding register 40071, 2 words.
 */
export function parseModbusAddress(address: string): ModbusAddress | null {
  const parts = address.trim().split(":");
  if (parts.length < 3 || parts.length > 4) return null;
  const unitId = Number(parts[0]);
  const area = MODBUS_AREAS[parts[1]?.toLowerCase() ?? ""];
  const register = Number(parts[2]);
  const count = parts[3] === undefined ? 1 : Number(parts[3]);
  if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) return null;
  if (!area) return null;
  if (!Number.isInteger(register) || register < 0 || register > 65535) return null;
  if (!Number.isInteger(count) || count < 1 || count > 8) return null;
  return { unitId, register, count, area };
}

/** Validate an address for a protocol; returns an error string or null. */
export function validateSourceAddress(protocol: TagProtocol, address: string): string | null {
  const value = address.trim();
  if (value.length === 0) return "Source address is required";
  switch (protocol) {
    case "mqtt":
      return isValidMqttTopic(value) ? null : "Invalid MQTT topic filter";
    case "opcua":
      return isValidOpcUaNodeId(value) ? null : "Expected an OPC UA NodeId (ns=2;s=Plant.P1)";
    case "modbus":
      return parseModbusAddress(value) ? null : "Expected <unit>:<hr|ir|co|di>:<register>[:count]";
    case "historian_csv":
      return value.length <= 256 ? null : "Column name too long";
    case "vendor_api":
      return value.length <= 512 ? null : "Path too long";
  }
}

// ------------------------------------------------------------------ schemas --

export const tagMappingInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    project_id: z.string().uuid(),
    connector_id: z.string().uuid().nullable().optional(),
    tag_dictionary_id: z.string().uuid(),
    protocol: z.enum(TAG_PROTOCOLS),
    source_address: z.string().trim().min(1).max(512),
    data_type: z.enum(MAPPING_DATA_TYPES).default("float32"),
    byte_order: z.enum(BYTE_ORDERS).default("big_endian"),
    scaling_factor: z.coerce.number().finite().default(1),
    scaling_offset: z.coerce.number().finite().default(0),
    poll_interval_s: z.coerce.number().int().min(1).max(86400).default(60),
    enabled: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    const err = validateSourceAddress(val.protocol, val.source_address);
    if (err) ctx.addIssue({ code: "custom", path: ["source_address"], message: err });
  });
export type TagMappingInput = z.infer<typeof tagMappingInputSchema>;

/** Apply mapping-level scaling to a raw source value. */
export function applyMappingScaling(
  raw: number,
  mapping: { scaling_factor: number; scaling_offset: number },
): number {
  return raw * mapping.scaling_factor + mapping.scaling_offset;
}

// ------------------------------------------------------------- historian CSV --

export interface HistorianReading {
  source_column: string;
  ts: string;
  value: number;
}

export interface HistorianParseResult {
  readings: HistorianReading[];
  rowsReceived: number;
  errors: { line: number; reason: string }[];
}

export const MAX_HISTORIAN_ROWS = 20_000;

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
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/**
 * Parse a wide historian export: first column is the timestamp, every other
 * column is a tag. Blank cells are skipped, bad cells are reported.
 */
export function parseHistorianCsv(text: string): HistorianParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: HistorianParseResult["errors"] = [];
  if (lines.length < 2) {
    return { readings: [], rowsReceived: 0, errors: [{ line: 1, reason: "no_data_rows" }] };
  }
  const header = splitCsvLine(lines[0]);
  if (header.length < 2) {
    return { readings: [], rowsReceived: 0, errors: [{ line: 1, reason: "no_tag_columns" }] };
  }
  const readings: HistorianReading[] = [];
  let rowsReceived = 0;

  for (let i = 1; i < lines.length && rowsReceived < MAX_HISTORIAN_ROWS; i += 1) {
    const cells = splitCsvLine(lines[i]);
    rowsReceived += 1;
    const tsRaw = cells[0];
    const ts = Date.parse(tsRaw ?? "");
    if (Number.isNaN(ts)) {
      errors.push({ line: i + 1, reason: "invalid_timestamp" });
      continue;
    }
    const iso = new Date(ts).toISOString();
    for (let c = 1; c < header.length; c += 1) {
      const cell = cells[c];
      if (cell === undefined || cell === "") continue;
      const value = Number(cell);
      if (!Number.isFinite(value)) {
        errors.push({ line: i + 1, reason: `invalid_value:${header[c]}` });
        continue;
      }
      readings.push({ source_column: header[c], ts: iso, value });
    }
  }

  return { readings, rowsReceived, errors };
}

// ------------------------------------------------------------ health scoring --

export type IngestionHealth = "healthy" | "degraded" | "stale" | "down" | "idle";

export interface ConnectorHealthInput {
  connector_id: string;
  name: string;
  connector_type: string;
  enabled: boolean;
  last_seen_at: string | null;
  expected_interval_s: number;
  mappings_count: number;
  lastRun?: {
    status: string;
    rows_received: number;
    rows_accepted: number;
    rows_rejected: number;
    finished_at: string | null;
  } | null;
}

export interface ConnectorHealth extends ConnectorHealthInput {
  health: IngestionHealth;
  ageSeconds: number | null;
  acceptRate: number | null;
  reason: string;
}

/**
 * Freshness first, then last-run outcome:
 * down    → enabled but never seen, or last run failed
 * stale   → older than 5× expected interval
 * degraded→ older than 2× interval, or accept rate < 95%
 */
export function classifyConnectorHealth(
  input: ConnectorHealthInput,
  now: Date = new Date(),
): ConnectorHealth {
  const ageSeconds = input.last_seen_at
    ? Math.max(0, Math.round((now.getTime() - Date.parse(input.last_seen_at)) / 1000))
    : null;
  const received = input.lastRun?.rows_received ?? 0;
  const acceptRate =
    input.lastRun && received > 0 ? (input.lastRun.rows_accepted ?? 0) / received : null;

  const base = { ...input, ageSeconds, acceptRate };

  if (!input.enabled) return { ...base, health: "idle", reason: "Connector disabled" };
  if (input.lastRun?.status === "failed")
    return { ...base, health: "down", reason: "Last ingestion run failed" };
  if (ageSeconds === null) return { ...base, health: "down", reason: "No telemetry received yet" };

  const interval = Math.max(1, input.expected_interval_s);
  if (ageSeconds > interval * 5)
    return { ...base, health: "stale", reason: `No data for ${ageSeconds}s` };
  if (ageSeconds > interval * 2)
    return { ...base, health: "degraded", reason: `Data lagging by ${ageSeconds}s` };
  if (acceptRate !== null && acceptRate < 0.95)
    return {
      ...base,
      health: "degraded",
      reason: `Accept rate ${(acceptRate * 100).toFixed(1)}%`,
    };
  if (input.mappings_count === 0)
    return { ...base, health: "degraded", reason: "No tag mappings configured" };

  return { ...base, health: "healthy", reason: "Streaming normally" };
}

export interface IngestionHealthKpis {
  connectors: number;
  healthy: number;
  degraded: number;
  down: number;
  mappings: number;
  rowsLast24h: number;
  acceptRate: number | null;
}

export function summarizeIngestionHealth(
  rows: readonly ConnectorHealth[],
  runs: readonly { rows_received: number; rows_accepted: number; started_at: string }[],
  now: Date = new Date(),
): IngestionHealthKpis {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  let received = 0;
  let accepted = 0;
  for (const r of runs) {
    if (Date.parse(r.started_at) < cutoff) continue;
    received += r.rows_received;
    accepted += r.rows_accepted;
  }
  return {
    connectors: rows.length,
    healthy: rows.filter((r) => r.health === "healthy").length,
    degraded: rows.filter((r) => r.health === "degraded" || r.health === "stale").length,
    down: rows.filter((r) => r.health === "down").length,
    mappings: rows.reduce((a, r) => a + r.mappings_count, 0),
    rowsLast24h: received,
    acceptRate: received > 0 ? accepted / received : null,
  };
}
