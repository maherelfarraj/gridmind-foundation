/**
 * P-135 — Storage bucket versioning/backup check (quiet cron).
 *
 * Asserts the four GridMind buckets exist, are non-public, and are covered
 * by at least the four expected storage RLS policies (company_files_select,
 * company_files_insert, company_files_update, company_files_delete).
 *
 * Silent on full success. On any failure writes ONE audit_logs row with
 * action = 'ops.storage_check_failed' so it surfaces on /admin/health.
 *
 * pg_cron registration (daily 04:07 UTC):
 *   select cron.schedule(
 *     'cron-storage-check', '7 4 * * *',
 *     $$
 *     select net.http_post(
 *       url:='https://project--0671c0d2-16e7-4644-aade-de901a28fb95.lovable.app/api/cron/storage-check',
 *       headers:='{"Content-Type":"application/json","apikey":"<SUPABASE_PUBLISHABLE_KEY>"}'::jsonb,
 *       body:='{}'::jsonb
 *     );
 *     $$
 *   );
 */
import { createFileRoute } from "@tanstack/react-router";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";

const ROUTE = "cron:storage-check";
const REQUIRED_BUCKETS = ["drawings", "photos", "documents", "closeout"] as const;
const REQUIRED_POLICIES = [
  "company_files_select",
  "company_files_insert",
  "company_files_update",
  "company_files_delete",
] as const;

type BucketRow = { id: string; name: string; is_public: boolean };
type PolicyRow = { policyname: string };
type Failure = {
  bucket?: string;
  reason: "missing_bucket" | "bucket_is_public" | "missing_storage_policies" | "query_failed";
  details?: unknown;
};

type LooseRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const Route = createFileRoute("/api/cron/storage-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ROUTE,
          allowCron: true,
          rateCapacity: 4,
          rateRefillPerSec: 0.02,
        });
        if (!guard.ok) return guard.response;
        if (guard.caller.kind !== "cron") {
          return Response.json({ error: "cron_only" }, { status: 403 });
        }

        const admin = createServiceRoleClient();

        const __auditStartedAt = Date.now();
        const __scheduledAt = new Date().toISOString();
        await admin.from("audit_logs").insert({
          company_id: null,
          actor_id: null,
          action: "cron.storage_check.start",
          entity: "cron",
          entity_id: null,
          metadata: { scheduled_at: __scheduledAt, route: ROUTE },
        } as never);
        try {
          const __result = await (async () => {
        const failures: Failure[] = [];

        const rpc: LooseRpc = (name, args) =>
          (admin.rpc as unknown as LooseRpc).call(admin, name, args);

        // 1. Bucket existence + non-public (via SECURITY DEFINER helper — the
        //    Supabase JS client blocks non-standard schemas by default).
        const buckets = await rpc("list_storage_buckets_status", {
          _ids: REQUIRED_BUCKETS as unknown as string[],
        });
        if (buckets.error) {
          failures.push({
            reason: "query_failed",
            details: { scope: "buckets", message: buckets.error.message },
          });
        } else {
          const rows = (buckets.data ?? []) as BucketRow[];
          const byId = new Map(rows.map((r) => [r.id, r]));
          for (const name of REQUIRED_BUCKETS) {
            const row = byId.get(name);
            if (!row) {
              failures.push({ bucket: name, reason: "missing_bucket" });
              continue;
            }
            if (row.is_public) {
              failures.push({ bucket: name, reason: "bucket_is_public" });
            }
          }
        }

        // 2. Storage RLS policies on storage.objects. We assert that ALL four
        //    required policies exist; they gate every bucket via a common
        //    company-scoped predicate, so their presence covers each bucket.
        const policies = await rpc("list_storage_object_policies");
        let policyNames: string[] = [];
        if (policies.error) {
          // Fallback path: helper RPC may not exist in older environments.
          // Treat as a soft failure so the cron surfaces the gap for repair.
          failures.push({
            reason: "query_failed",
            details: {
              scope: "storage_policies",
              message: policies.error.message,
            },
          });
        } else {
          policyNames = ((policies.data ?? []) as PolicyRow[]).map((r) => r.policyname);
          const missing = REQUIRED_POLICIES.filter((p) => !policyNames.includes(p));
          if (missing.length > 0) {
            failures.push({
              reason: "missing_storage_policies",
              details: { missing },
            });
          }
        }

        if (failures.length === 0) {
          // Quiet success — no audit row, no chatter.
          return Response.json({ ok: true });
        }

        // Failure path: single audit row (best-effort; do not throw if the
        // audit insert itself fails, just surface it in the response).
        const anyCompanyId = await admin.from("companies").select("id").limit(1).maybeSingle();

        const insertRes = await admin.from("audit_logs").insert({
          company_id: anyCompanyId.data?.id ?? null,
          actor_id: null,
          action: "ops.storage_check_failed",
          entity: "ops",
          entity_id: null,
          metadata: {
            route: ROUTE,
            failures,
            checked_buckets: REQUIRED_BUCKETS,
            required_policies: REQUIRED_POLICIES,
          },
        } as never);

        return Response.json(
          {
            ok: false,
            failures,
            audit_written: !insertRes.error,
            audit_error: insertRes.error?.message ?? null,
          },
          { status: 200 },
        );
      
          })();
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.storage_check.success",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              result_summary: { status: __result.status },
            },
          } as never);
          return __result;
        } catch (__err) {
          await admin.from("audit_logs").insert({
            company_id: null,
            actor_id: null,
            action: "cron.storage_check.failure",
            entity: "cron",
            entity_id: null,
            metadata: {
              duration_ms: Date.now() - __auditStartedAt,
              error_message: __err instanceof Error ? __err.message : String(__err),
            },
          } as never);
          throw __err;
        }
},
    },
  },
});
