// P-173 — Pure event-model helpers for the SCADA log of record.
// No React / Supabase imports: safe for unit tests and both runtimes.
import { z } from "zod";

export const SCADA_EVENT_TYPES = [
  "event",
  "warning",
  "trip",
  "comm_failure",
  "status_change",
  "operator_action",
  "setpoint_change",
  "maintenance",
  "protection",
] as const;

export type ScadaEventType = (typeof SCADA_EVENT_TYPES)[number];

export const SCADA_EVENT_SEVERITIES = ["info", "warning", "major", "critical"] as const;
export type ScadaEventSeverity = (typeof SCADA_EVENT_SEVERITIES)[number];

/** Max events accepted per guarded ingestion payload. */
export const MAX_EVENTS_PER_REQUEST = 200;
/** Stored payload cap — larger objects are truncated and flagged. */
export const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;

export const hookEventSchema = z.object({
  asset_key: z.string().trim().min(1).max(128),
  ts: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ts must be ISO 8601"),
  event_type: z.enum(SCADA_EVENT_TYPES),
  severity: z.enum(SCADA_EVENT_SEVERITIES).optional(),
  code: z.string().trim().max(64).optional(),
  message: z.string().trim().min(1).max(2000),
  dedupe_key: z.string().trim().min(1).max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type HookEvent = z.infer<typeof hookEventSchema>;

export const hookEventsSchema = z.array(hookEventSchema).max(MAX_EVENTS_PER_REQUEST);

export const operatorEventSchema = z.object({
  projectId: z.string().uuid(),
  assetNodeId: z.string().uuid().nullable().optional(),
  scadaAssetId: z.string().uuid().nullable().optional(),
  eventType: z.enum(SCADA_EVENT_TYPES),
  severity: z.enum(SCADA_EVENT_SEVERITIES).default("info"),
  code: z.string().trim().max(64).nullable().optional(),
  message: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type OperatorEventInput = z.infer<typeof operatorEventSchema>;

export interface TruncatedPayload {
  payload: Record<string, unknown>;
  truncated: boolean;
}

/**
 * Cap a stored jsonb payload at MAX_EVENT_PAYLOAD_BYTES. Oversized payloads are
 * replaced with a truncated marker carrying the original byte size so callers
 * can still see that data was dropped.
 */
export function capEventPayload(
  payload: Record<string, unknown> | null | undefined,
  maxBytes: number = MAX_EVENT_PAYLOAD_BYTES,
): TruncatedPayload {
  const value = payload ?? {};
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { payload: { truncated: true, reason: "unserializable" }, truncated: true };
  }
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes <= maxBytes) return { payload: value, truncated: false };
  return {
    payload: {
      truncated: true,
      original_bytes: bytes,
      preview: serialized.slice(0, 512),
    },
    truncated: true,
  };
}

export interface EventAssetLookup {
  scada_asset_id: string;
  project_id: string;
  asset_node_id: string | null;
}

export interface EventRow {
  company_id: string;
  project_id: string;
  asset_node_id: string | null;
  scada_asset_id: string;
  event_type: ScadaEventType;
  severity: ScadaEventSeverity;
  code: string | null;
  message: string;
  payload: Record<string, unknown>;
  source: string;
  occurred_at: string;
  dedupe_key: string | null;
}

export interface EventBuildResult {
  rows: EventRow[];
  rejected: Array<{ index: number; asset_key: string; reason: string }>;
}

/**
 * Resolve hook events against the caller's company asset map. Unknown or
 * cross-company asset_keys are rejected — never written.
 */
export function buildEventRows(
  companyId: string,
  events: HookEvent[],
  assetMap: ReadonlyMap<string, EventAssetLookup>,
): EventBuildResult {
  const rows: EventRow[] = [];
  const rejected: EventBuildResult["rejected"] = [];
  events.forEach((e, index) => {
    const hit = assetMap.get(e.asset_key);
    if (!hit) {
      rejected.push({ index, asset_key: e.asset_key, reason: "unknown_asset_or_cross_company" });
      return;
    }
    const capped = capEventPayload(e.payload);
    rows.push({
      company_id: companyId,
      project_id: hit.project_id,
      asset_node_id: hit.asset_node_id,
      scada_asset_id: hit.scada_asset_id,
      event_type: e.event_type,
      severity: e.severity ?? "info",
      code: e.code ?? null,
      message: e.message,
      payload: capped.payload,
      source: "scada",
      occurred_at: new Date(e.ts).toISOString(),
      dedupe_key: e.dedupe_key ?? null,
    });
  });
  return { rows, rejected };
}
