// P-177 — Ingestion reliability: retry-queue producer, cron processor,
// dead-letter replay and queue health. Server-only (service-role or the
// caller's RLS client); never import from client bundles.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  MAX_RETRY_ATTEMPTS,
  RETRY_BATCH_SIZE,
  RETRY_INSERT_CHUNK,
  chunkRows,
  isMissingTable,
  planRetryFailure,
  type IngestionPayloadKind,
} from "@/lib/scada/retry";

const RETRY_TABLE = "ingestion_retry_queue";
const DLQ_TABLE = "ingestion_dead_letter";

type AnyClient = SupabaseClient<never, never, never>;
// The reliability tables are not in the generated Database type yet.
const t = (client: unknown, table: string) =>
  (client as { from: (n: string) => never }).from(table) as never as ReturnType<AnyClient["from"]>;

export interface RetryPayload {
  /** Fully resolved rows, ready to be replayed without re-resolution. */
  rows: Record<string, unknown>[];
}

export interface EnqueueRetryArgs {
  company_id: string;
  project_id?: string | null;
  connector_id?: string | null;
  payload_kind?: IngestionPayloadKind;
  rows: Record<string, unknown>[];
  error: string;
}

/**
 * Producer — push a failed ingestion batch onto the retry queue.
 * Best-effort by contract: never throws into the ingestion path.
 */
export async function enqueueIngestionRetry(
  client: unknown,
  args: EnqueueRetryArgs,
): Promise<boolean> {
  if (args.rows.length === 0) return false;
  try {
    const { error } = await t(client, RETRY_TABLE).insert({
      company_id: args.company_id,
      project_id: args.project_id ?? null,
      connector_id: args.connector_id ?? null,
      payload_kind: args.payload_kind ?? "telemetry",
      payload: { rows: args.rows } satisfies RetryPayload,
      error: args.error.slice(0, 2000),
      attempts: 0,
      max_attempts: MAX_RETRY_ATTEMPTS,
      status: "pending",
      next_retry_at: new Date().toISOString(),
    } as never);
    return !error;
  } catch {
    return false;
  }
}

interface QueueRow {
  id: string;
  company_id: string;
  project_id: string | null;
  connector_id: string | null;
  payload: RetryPayload;
  payload_kind: IngestionPayloadKind;
  error: string;
  attempts: number;
  max_attempts: number;
}

async function replayRows(
  client: unknown,
  kind: IngestionPayloadKind,
  rows: Record<string, unknown>[],
): Promise<string | null> {
  if (rows.length === 0) return null;
  const table = kind === "events" ? "scada_events" : "scada_telemetry";
  for (const batch of chunkRows(rows, RETRY_INSERT_CHUNK)) {
    const query =
      kind === "events"
        ? t(client, table).insert(batch as never)
        : t(client, table).upsert(batch as never, {
            onConflict: "scada_asset_id,metric,ts",
            ignoreDuplicates: true,
          });
    const { error } = await query;
    if (error) return error.message;
  }
  return null;
}

export interface RetryRunSummary {
  processed: number;
  succeeded: number;
  requeued: number;
  dead_lettered: number;
  companies: string[];
  queue_missing?: boolean;
}

/**
 * Cron processor — claim due rows, replay them, apply backoff on failure and
 * dead-letter once max_attempts is reached. Writes exactly one summary audit
 * row per company per run (done by the caller with `perCompany`).
 */
export async function processIngestionRetries(
  admin: unknown,
  now: Date = new Date(),
): Promise<RetryRunSummary & { perCompany: Map<string, RetryRunSummary> }> {
  const empty = {
    processed: 0,
    succeeded: 0,
    requeued: 0,
    dead_lettered: 0,
    companies: [] as string[],
    perCompany: new Map<string, RetryRunSummary>(),
  };

  const { data, error } = await t(admin, RETRY_TABLE)
    .select(
      "id, company_id, project_id, connector_id, payload, payload_kind, error, attempts, max_attempts",
    )
    .eq("status", "pending")
    .lte("next_retry_at", now.toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(RETRY_BATCH_SIZE);

  if (error) {
    return { ...empty, queue_missing: isMissingTable(error) };
  }

  const rows = (data ?? []) as unknown as QueueRow[];
  const perCompany = new Map<string, RetryRunSummary>();
  const bump = (companyId: string, key: keyof RetryRunSummary) => {
    const acc = perCompany.get(companyId) ?? {
      processed: 0,
      succeeded: 0,
      requeued: 0,
      dead_lettered: 0,
      companies: [companyId],
    };
    (acc[key] as number) += 1;
    perCompany.set(companyId, acc);
  };

  let succeeded = 0;
  let requeued = 0;
  let dead = 0;

  for (const row of rows) {
    bump(row.company_id, "processed");
    // Claim so a concurrent run cannot double-process the same batch.
    const claim = await t(admin, RETRY_TABLE)
      .update({ status: "processing", updated_at: new Date().toISOString() } as never)
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (claim.error || ((claim.data ?? []) as unknown[]).length === 0) continue;

    const failure = await replayRows(admin, row.payload_kind, row.payload?.rows ?? []);
    if (!failure) {
      await t(admin, RETRY_TABLE)
        .update({ status: "succeeded", updated_at: new Date().toISOString() } as never)
        .eq("id", row.id);
      succeeded += 1;
      bump(row.company_id, "succeeded");
      continue;
    }

    const plan = planRetryFailure(row.attempts, row.max_attempts, now);
    if (plan.dead) {
      await t(admin, DLQ_TABLE).insert({
        company_id: row.company_id,
        project_id: row.project_id,
        connector_id: row.connector_id,
        payload: row.payload,
        payload_kind: row.payload_kind,
        first_error: row.error,
        final_error: failure.slice(0, 2000),
        attempts: plan.attempts,
      } as never);
      await t(admin, RETRY_TABLE)
        .update({
          status: "dead",
          attempts: plan.attempts,
          error: failure.slice(0, 2000),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", row.id);
      dead += 1;
      bump(row.company_id, "dead_lettered");
      continue;
    }

    await t(admin, RETRY_TABLE)
      .update({
        status: "pending",
        attempts: plan.attempts,
        next_retry_at: plan.next_retry_at,
        error: failure.slice(0, 2000),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
    requeued += 1;
    bump(row.company_id, "requeued");
  }

  return {
    processed: rows.length,
    succeeded,
    requeued,
    dead_lettered: dead,
    companies: Array.from(perCompany.keys()),
    perCompany,
  };
}

// ------------------------------------------------------------- health + UI --

export interface IngestionQueueHealth {
  available: boolean;
  pending: number;
  processing: number;
  dead: number;
  succeeded: number;
  oldestPendingAt: string | null;
  deadLetters: Array<{
    id: string;
    connector_id: string | null;
    payload_kind: string;
    attempts: number;
    final_error: string;
    failed_at: string;
    replayed_at: string | null;
    rows: number;
  }>;
}

export async function getIngestionQueueHealth(
  context: AuthContext,
  companyId: string,
): Promise<IngestionQueueHealth> {
  const base: IngestionQueueHealth = {
    available: true,
    pending: 0,
    processing: 0,
    dead: 0,
    succeeded: 0,
    oldestPendingAt: null,
    deadLetters: [],
  };

  const [queue, dlq] = await Promise.all([
    t(context.supabase, RETRY_TABLE)
      .select("status, next_retry_at")
      .eq("company_id", companyId)
      .limit(5000),
    t(context.supabase, DLQ_TABLE)
      .select(
        "id, connector_id, payload, payload_kind, attempts, final_error, failed_at, replayed_at",
      )
      .eq("company_id", companyId)
      .order("failed_at", { ascending: false })
      .limit(50),
  ]);

  if (queue.error) {
    return { ...base, available: !isMissingTable(queue.error) };
  }

  for (const row of (queue.data ?? []) as unknown as {
    status: string;
    next_retry_at: string;
  }[]) {
    if (row.status === "pending") {
      base.pending += 1;
      if (!base.oldestPendingAt || row.next_retry_at < base.oldestPendingAt) {
        base.oldestPendingAt = row.next_retry_at;
      }
    } else if (row.status === "processing") base.processing += 1;
    else if (row.status === "dead") base.dead += 1;
    else if (row.status === "succeeded") base.succeeded += 1;
  }

  if (!dlq.error) {
    base.deadLetters = ((dlq.data ?? []) as unknown as Record<string, unknown>[]).map((d) => ({
      id: d.id as string,
      connector_id: (d.connector_id as string | null) ?? null,
      payload_kind: (d.payload_kind as string) ?? "telemetry",
      attempts: Number(d.attempts ?? 0),
      final_error: (d.final_error as string) ?? "",
      failed_at: d.failed_at as string,
      replayed_at: (d.replayed_at as string | null) ?? null,
      rows: Array.isArray((d.payload as RetryPayload | null)?.rows)
        ? (d.payload as RetryPayload).rows.length
        : 0,
    }));
  }

  return base;
}

/**
 * Operator action — push dead letters back onto the retry queue with a fresh
 * attempt budget. Uses the caller's RLS client so cross-tenant replay is
 * impossible.
 */
export async function replayDeadLetters(
  context: AuthContext,
  companyId: string,
  ids: string[],
): Promise<{ replayed: number }> {
  const query = t(context.supabase, DLQ_TABLE)
    .select("id, project_id, connector_id, payload, payload_kind, final_error")
    .eq("company_id", companyId)
    .is("replayed_at", null);
  const { data, error } = ids.length > 0 ? await query.in("id", ids) : await query.limit(100);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    project_id: string | null;
    connector_id: string | null;
    payload: RetryPayload;
    payload_kind: IngestionPayloadKind;
    final_error: string;
  }>;
  if (rows.length === 0) return { replayed: 0 };

  const { error: insErr } = await t(context.supabase, RETRY_TABLE).insert(
    rows.map((r) => ({
      company_id: companyId,
      project_id: r.project_id,
      connector_id: r.connector_id,
      payload: r.payload,
      payload_kind: r.payload_kind,
      error: `replayed_from_dlq: ${r.final_error}`.slice(0, 2000),
      attempts: 0,
      max_attempts: MAX_RETRY_ATTEMPTS,
      status: "pending",
      next_retry_at: new Date().toISOString(),
    })) as never,
  );
  if (insErr) throw insErr;

  const now = new Date().toISOString();
  await t(context.supabase, DLQ_TABLE)
    .update({ replayed_at: now, replayed_by: context.user!.id } as never)
    .in(
      "id",
      rows.map((r) => r.id),
    );

  await context.supabase.from("audit_logs").insert({
    company_id: companyId,
    actor_id: context.user!.id,
    action: "scada.dead_letter_replay",
    entity: "ingestion_dead_letter",
    entity_id: null,
    metadata: { count: rows.length, ids: rows.map((r) => r.id).slice(0, 50) },
  } as never);

  return { replayed: rows.length };
}
