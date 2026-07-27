// P-125 — Outbound webhook emission helper (server-only).
//
// INTEGRATION POINT
//   Feature mutations that want to fan out a change as an outbound webhook
//   call `emitWebhookEvent(companyId, tableName, event, row)` after the
//   write succeeds. This function is a no-op when:
//     - the tenant has no active webhook_endpoints subscribed to `event`
//     - the table is not present in webhook_export_allowlist (or disabled)
//
//   Callers MUST dynamic-import this module from inside a server function
//   handler body (or a server route handler body), never at module scope of
//   a `.functions.ts` file — it depends on the service-role client, which
//   is server-only.
//
//     const { emitWebhookEvent } = await import("@/lib/webhooks/emit.server");
//     await emitWebhookEvent(companyId, "projects", "project.updated", row);
//
// Emission itself is fire-and-forget: we insert `webhook_deliveries` rows
// with status='pending' and rely on the cron dispatcher
// (`/api/public/cron/webhook-dispatch`) to sign, POST, and retry.
import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { isExportableTable } from "@/lib/public-api/export-allowlist";

export interface EmitOptions {
  /** Skip the export-allowlist check. Use for internal system events
   *  (e.g. "webhook.test") that are not tied to a table row. */
  bypassAllowlist?: boolean;
}

export async function emitWebhookEvent(
  companyId: string,
  tableName: string | null,
  event: string,
  row: unknown,
  opts: EmitOptions = {},
): Promise<{ enqueued: number; skipped_reason?: string }> {
  const admin = createServiceRoleClient();

  // Allowlist gate (skipped for system events with no table).
  if (!opts.bypassAllowlist && tableName) {
    if (!isExportableTable(tableName)) {
      return { enqueued: 0, skipped_reason: "table_not_exportable" };
    }
    const allow = await admin
      .from("webhook_export_allowlist")
      .select("is_enabled")
      .eq("company_id", companyId)
      .eq("table_name", tableName)
      .maybeSingle();
    // Fail-safe: if the allowlist table is missing, treat as opt-out.
    if (allow.error && (allow.error as { code?: string }).code === "42P01") {
      return { enqueued: 0, skipped_reason: "allowlist_missing" };
    }
    if (!allow.data || (allow.data as { is_enabled: boolean }).is_enabled !== true) {
      return { enqueued: 0, skipped_reason: "table_not_allowlisted" };
    }
  }

  // Find active endpoints subscribed to this event for the tenant.
  const endpoints = await admin
    .from("webhook_endpoints")
    .select("id, events")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (endpoints.error) {
    return { enqueued: 0, skipped_reason: "endpoint_query_failed" };
  }
  const targets = ((endpoints.data ?? []) as Array<{ id: string; events: string[] }>).filter(
    (e) => (e.events ?? []).includes(event) || (e.events ?? []).includes("*"),
  );
  if (targets.length === 0) return { enqueued: 0, skipped_reason: "no_subscribers" };

  const payload = {
    event,
    table: tableName,
    company_id: companyId,
    emitted_at: new Date().toISOString(),
    data: row,
  };

  const rows = targets.map((t) => ({
    endpoint_id: t.id,
    company_id: companyId,
    event,
    payload,
    status: "pending" as const,
    attempts: 0,
    next_retry_at: new Date().toISOString(),
  }));

  const ins = await admin.from("webhook_deliveries").insert(rows as never);
  if (ins.error) return { enqueued: 0, skipped_reason: "insert_failed" };
  return { enqueued: rows.length };
}
