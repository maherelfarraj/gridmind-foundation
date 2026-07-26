/**
 * P-172 — Per-protocol ingestion mapping configs stored in
 * `scada_connectors.config` (jsonb). No schema change, no plaintext secrets:
 * credentials are referenced by env-var NAME on the connector itself.
 *
 * Pure module: zod + plain functions only (no React, no Supabase).
 */
import { z } from "zod";

export const PROTOCOL_EDITORS = ["mqtt", "opcua", "modbus"] as const;
export type ProtocolEditor = (typeof PROTOCOL_EDITORS)[number];

export const PROTOCOL_EDITOR_LABELS: Record<ProtocolEditor, string> = {
  mqtt: "MQTT",
  opcua: "OPC UA",
  modbus: "Modbus TCP",
};

/** Which mapping editor a connector type uses (null = no mapping editor). */
export function protocolEditorFor(connectorType: string): ProtocolEditor | null {
  switch (connectorType) {
    case "mqtt":
      return "mqtt";
    case "iec61850":
      return "opcua";
    case "modbus_tcp":
    case "sunspec":
      return "modbus";
    default:
      return null;
  }
}

// ------------------------------------------------------------ secret guard --

const SECRET_SHAPES: readonly RegExp[] = [
  /^sk_/i,
  /^pk_/i,
  /^bearer\s/i,
  /^eyJ[A-Za-z0-9_-]+\./,
  /^ghp_/i,
  /^xox[baprs]-/i,
  /(password|passwd|secret|token|api[_-]?key)\s*[:=]/i,
];

/** True when a config value looks like a pasted credential rather than a name. */
export function looksLikePlaintextSecret(value: string): boolean {
  return SECRET_SHAPES.some((r) => r.test(value.trim()));
}

const safeText = (max: number, min = 0, minMsg?: string) =>
  z
    .string()
    .trim()
    .min(min, minMsg)
    .max(max)
    .refine(
      (v) => !looksLikePlaintextSecret(v),
      "Never store credentials here — reference an environment variable name on the connector",
    );

// ------------------------------------------------------------------ shared --

export const scheduleSchema = z
  .object({
    enabled: z.boolean().default(false),
    interval_minutes: z.coerce.number().int().min(1).max(1440).default(15),
    // TODO(B20/P-177): swept by the ingestion cron — config only for now.
    pull_url: z.string().url().max(512).optional().or(z.literal("")),
    last_pull_at: z.string().optional().nullable(),
  })
  .strict();
export type ConnectorSchedule = z.infer<typeof scheduleSchema>;

const tagRef = safeText(120, 1, "Tag is required");
const metricRef = safeText(80, 1, "Metric is required");

// -------------------------------------------------------------------- MQTT --

export const mqttMappingRowSchema = z
  .object({
    tag: tagRef,
    json_path: safeText(256, 1, "JSON path is required"),
    metric: metricRef,
  })
  .strict();
export type MqttMappingRow = z.infer<typeof mqttMappingRowSchema>;

export const mqttProtocolSchema = z
  .object({
    broker_host: safeText(255, 1, "Broker host is required"),
    broker_port: z.coerce.number().int().min(1).max(65535).default(8883),
    topic_template: safeText(512, 1, "Topic template is required"),
    qos: z.coerce.number().int().min(0).max(2).default(1),
    payload_mappings: z.array(mqttMappingRowSchema).max(500).default([]),
  })
  .strict();

// ------------------------------------------------------------------ OPC UA --

export const opcuaMappingRowSchema = z
  .object({
    tag: tagRef,
    node_id: safeText(512, 1, "NodeId is required"),
    metric: metricRef,
  })
  .strict();
export type OpcuaMappingRow = z.infer<typeof opcuaMappingRowSchema>;

export const opcuaProtocolSchema = z
  .object({
    endpoint_url: safeText(512, 1, "Endpoint URL is required"),
    namespace: z.coerce.number().int().min(0).max(65535).default(2),
    node_mappings: z.array(opcuaMappingRowSchema).max(500).default([]),
  })
  .strict();

// ------------------------------------------------------------------ Modbus --

export const MODBUS_REGISTER_TYPES = ["holding", "input"] as const;
export const MODBUS_DATA_TYPES = ["uint16", "int16", "uint32", "float32"] as const;

export const modbusMappingRowSchema = z
  .object({
    tag: tagRef,
    unit_id: z.coerce.number().int().min(0).max(255).default(1),
    register: z.coerce.number().int().min(0).max(65535),
    register_type: z.enum(MODBUS_REGISTER_TYPES).default("holding"),
    data_type: z.enum(MODBUS_DATA_TYPES).default("float32"),
    scaling_factor: z.coerce.number().finite().default(1),
    scaling_offset: z.coerce.number().finite().default(0),
  })
  .strict();
export type ModbusMappingRow = z.infer<typeof modbusMappingRowSchema>;

export const modbusProtocolSchema = z
  .object({
    register_mappings: z.array(modbusMappingRowSchema).max(500).default([]),
  })
  .strict();

// ------------------------------------------------------------- composition --

/** The additive block every connector config may carry. */
export const protocolBlockSchema = z
  .object({
    mqtt: mqttProtocolSchema.optional(),
    opcua: opcuaProtocolSchema.optional(),
    modbus: modbusProtocolSchema.optional(),
    schedule: scheduleSchema.optional(),
  })
  .strict();
export type ProtocolBlock = z.infer<typeof protocolBlockSchema>;

export function protocolSchemaFor(editor: ProtocolEditor) {
  switch (editor) {
    case "mqtt":
      return mqttProtocolSchema;
    case "opcua":
      return opcuaProtocolSchema;
    case "modbus":
      return modbusProtocolSchema;
  }
}

export function emptyProtocolConfig(editor: ProtocolEditor): Record<string, unknown> {
  switch (editor) {
    case "mqtt":
      return {
        broker_host: "",
        broker_port: 8883,
        topic_template: "plants/{asset_key}/{tag}",
        qos: 1,
        payload_mappings: [],
      };
    case "opcua":
      return { endpoint_url: "", namespace: 2, node_mappings: [] };
    case "modbus":
      return { register_mappings: [] };
  }
}

/** Resolve `{asset_key}` / `{tag}` placeholders in an MQTT topic template. */
export function resolveTopicTemplate(
  template: string,
  vars: { asset_key: string; tag: string },
): string {
  return template.replace(/\{asset_key\}/g, vars.asset_key).replace(/\{tag\}/g, vars.tag);
}

/** Count mapping rows configured on a connector config object. */
export function countMappingRows(config: unknown): number {
  const parsed = protocolBlockSchema.safeParse(config ?? {});
  if (!parsed.success) return 0;
  const c: ProtocolBlock = parsed.data;
  return (
    (c.mqtt?.payload_mappings?.length ?? 0) +
    (c.opcua?.node_mappings?.length ?? 0) +
    (c.modbus?.register_mappings?.length ?? 0)
  );
}
