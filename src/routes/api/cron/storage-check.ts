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
  reason:
    | "missing_bucket"
    | "bucket_is_public"
    | "missing_storage_policies"
    | "query_failed";
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
        const failures: Failure[] = [];

        // 1. Bucket existence + non-public.
        const buckets = await admin
          .schema("storage" as never)
          .from("buckets")
          .select("id, name, public")
          .in("id", REQUIRED_BUCKETS as unknown as string[]);

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
            if (row.public) {
              failures.push({ bucket: name, reason: "bucket_is_public" });
            }
          }
        }

        // 2. Storage RLS policies on storage.objects. We assert that ALL four
        //    required policies exist; they gate every bucket via a common
        //    company-scoped predicate, so their presence covers each bucket.
        // Types regenerate after this migration lands; cast to bypass the
        // stale RPC name until then.
        const policies = await (
          admin.rpc as unknown as (
            name: string,
          ) => Promise<{ data: unknown; error: { message: string } | null }>
        )("list_storage_object_policies");
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
          policyNames = ((policies.data ?? []) as PolicyRow[]).map(
            (r) => r.policyname,
          );
          const missing = REQUIRED_POLICIES.filter(
            (p) => !policyNames.includes(p),
          );
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
        const anyCompanyId = await admin
          .from("companies")
          .select("id")
          .limit(1)
          .maybeSingle();

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
      },
    },
  },
});
