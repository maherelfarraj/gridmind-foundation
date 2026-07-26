/**
 * P-173 — Server helpers for the SCADA event log. Kept out of *.functions.ts
 * so the server-fn split transform cannot drop module-scope helpers.
 */
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { writeAuditLog } from "@/lib/civil.server";
import { evaluateEventsSafely } from "@/lib/scada-actions.server";
import { assertIngestionWriter, currentCompanyId, httpError } from "@/lib/scada-ingestion.server";
import {
  buildEventRows,
  capEventPayload,
  hookEventsSchema,
  type EventAssetLookup,
  type HookEvent,
  type OperatorEventInput,
} from "@/lib/scada/events";

const EVENT_CHUNK = 200;

/** Extract and validate an optional `events[]` array from a guarded hook body. */
export function parseHookEvents(json: unknown): HookEvent[] {
  const raw = (json as { events?: unknown } | null)?.events;
  if (!Array.isArray(raw)) return [];
  const parsed = hookEventsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Fire-and-forget persistence of ingested events. Replays are idempotent on
 * (project_id, dedupe_key); unknown asset keys are rejected before any write.
 */
export async function persistScadaEvents(
  admin: {
    from: (t: string) => any;
  },
  companyId: string,
  events: HookEvent[],
): Promise<{ accepted: number; rejected: number }> {
  if (events.length === 0) return { accepted: 0, rejected: 0 };

  const keys = Array.from(new Set(events.map((e) => e.asset_key)));
  const lookup = await admin
    .from("scada_assets")
    .select("id, asset_key, project_id")
    .eq("company_id", companyId)
    .in("asset_key", keys);
  if (lookup.error) return { accepted: 0, rejected: events.length };

  const assets = (lookup.data ?? []) as Array<{
    id: string;
    asset_key: string;
    project_id: string | null;
  }>;

  // The P-171 tree links back via asset_nodes.scada_asset_id — resolve the node
  // for each asset so events land on the hierarchy when one exists.
  const nodeByAsset = new Map<string, string>();
  if (assets.length > 0) {
    const nodes = await admin
      .from("asset_nodes")
      .select("id, scada_asset_id")
      .eq("company_id", companyId)
      .in(
        "scada_asset_id",
        assets.map((a) => a.id),
      );
    for (const n of (nodes?.data ?? []) as Array<{ id: string; scada_asset_id: string | null }>) {
      if (n.scada_asset_id) nodeByAsset.set(n.scada_asset_id, n.id);
    }
  }

  const map = new Map<string, EventAssetLookup>();
  for (const row of assets) {
    if (!row.project_id) continue;
    map.set(row.asset_key, {
      scada_asset_id: row.id,
      project_id: row.project_id,
      asset_node_id: nodeByAsset.get(row.id) ?? null,
    });
  }

  const { rows, rejected } = buildEventRows(companyId, events, map);
  let accepted = 0;
  for (let i = 0; i < rows.length; i += EVENT_CHUNK) {
    const batch = rows.slice(i, i + EVENT_CHUNK);
    const { error } = await admin
      .from("scada_events")
      .upsert(batch, { onConflict: "project_id,dedupe_key", ignoreDuplicates: true });
    if (!error) accepted += batch.length;
  }
  return { accepted, rejected: rejected.length };
}

/** Operator-originated event from the UI: role-gated, actor-stamped, audited. */
export async function logOperatorEvent(context: AuthContext, input: OperatorEventInput) {
  await assertIngestionWriter(context);
  const companyId = await currentCompanyId(context);
  const capped = capEventPayload(input.payload);

  const { data, error } = await context.supabase
    .from("scada_events")
    .insert({
      company_id: companyId,
      project_id: input.projectId,
      asset_node_id: input.assetNodeId ?? null,
      scada_asset_id: input.scadaAssetId ?? null,
      event_type: input.eventType,
      severity: input.severity,
      code: input.code ?? null,
      message: input.message,
      payload: capped.payload as never,
      source: "operator",
      actor_id: context.user!.id,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
    } as never)
    .select("id")
    .maybeSingle();
  if (error) httpError(400, "event_insert_failed", error.message);

  const id = (data as { id: string } | null)?.id ?? null;
  await writeAuditLog(context, "scada.event_log", "scada_events", id, {
    event_type: input.eventType,
    code: input.code ?? null,
  });
  return { id, truncated: capped.truncated };
}

export interface ScadaEventRow {
  id: string;
  project_id: string;
  event_type: string;
  severity: string;
  code: string | null;
  message: string;
  source: string;
  occurred_at: string;
  actor_id: string | null;
}

export async function listScadaEvents(
  context: AuthContext,
  projectId: string,
  limit = 200,
): Promise<ScadaEventRow[]> {
  const { data, error } = await context.supabase
    .from("scada_events")
    .select("id, project_id, event_type, severity, code, message, source, occurred_at, actor_id")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ScadaEventRow[];
}
