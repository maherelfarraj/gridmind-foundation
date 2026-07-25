// P-103 — SCADA telemetry ingestion hook. First machine-to-machine POST.
//
// TODO(B13/P-121): replace with guardPublicHook(request, {
//   requireSignature: true,
//   scopes: ['scada:telemetry:write'],
// }) — adds cf-connecting-ip allowlist, timestamped HMAC (300s replay
// window), and consume_rate_limit with warn/block modes.
//
// Until then this is the minimal API-key + scope gate. Failures always
// return `401 { error: 'unauthorized' }` (JSON) so callers get a stable
// contract even before the full guard lands.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  INSERT_CHUNK_SIZE,
  MAX_ERROR_DETAILS,
  MAX_READINGS_PER_REQUEST,
  chunk,
  filterReadingsByAsset,
  ingestBodySchema,
  type AssetLookup,
  type RejectedReading,
} from "@/lib/telemetry-ingest";

const REQUIRED_SCOPE = "scada:telemetry:write";

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export const Route = createFileRoute("/api/public/hooks/scada/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---- 1. minimal API-key + scope check --------------------------------
        const authHeader = request.headers.get("authorization") ?? "";
        const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
        const rawKey = match?.[1]?.trim();
        if (!rawKey) return unauthorized();

        const { createServiceRoleClient } = await import(
          "@/integrations/supabase/server"
        );
        const admin = createServiceRoleClient();

        const { data: verifyRows, error: verifyErr } = await admin.rpc(
          "verify_api_key",
          { p_raw_key: rawKey },
        );
        if (verifyErr) return unauthorized();
        const keyRow = Array.isArray(verifyRows) ? verifyRows[0] : verifyRows;
        if (!keyRow) return unauthorized();

        const scopes: string[] = Array.isArray((keyRow as { scopes?: unknown }).scopes)
          ? ((keyRow as { scopes: unknown[] }).scopes as string[])
          : [];
        if (!scopes.includes(REQUIRED_SCOPE)) return unauthorized();

        const companyId = (keyRow as { company_id: string }).company_id;
        if (!companyId) return unauthorized();

        // ---- 2. body validation ---------------------------------------------
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return Response.json({ error: "bad_json" }, { status: 400 });
        }

        // Fast-reject oversized batches with the correct 413.
        if (
          json &&
          typeof json === "object" &&
          Array.isArray((json as { readings?: unknown }).readings) &&
          (json as { readings: unknown[] }).readings.length > MAX_READINGS_PER_REQUEST
        ) {
          return Response.json(
            { error: "too_many_readings", max: MAX_READINGS_PER_REQUEST },
            { status: 413 },
          );
        }

        const parsed = ingestBodySchema.safeParse(json);
        if (!parsed.success) {
          const flat = parsed.error.flatten();
          return Response.json(
            { error: "invalid_body", details: flat },
            { status: 400 },
          );
        }
        const { readings } = parsed.data;

        // ---- 3. resolve asset_key -> id, scoped to caller's company ---------
        const uniqueKeys = Array.from(new Set(readings.map((r) => r.asset_key)));
        const { data: assetRows, error: assetErr } = await admin
          .from("scada_assets")
          .select("id, asset_key, project_id, company_id")
          .eq("company_id", companyId)
          .in("asset_key", uniqueKeys);
        if (assetErr) {
          return Response.json({ error: "asset_lookup_failed" }, { status: 500 });
        }

        const assetMap = new Map<string, AssetLookup>();
        for (const row of assetRows ?? []) {
          const r = row as {
            id: string;
            asset_key: string;
            project_id: string | null;
          };
          if (!r.project_id) continue; // assets without a project can't be written
          assetMap.set(r.asset_key, {
            scada_asset_id: r.id,
            project_id: r.project_id,
          });
        }

        const { accepted, rejected: rejectedFromFilter } = filterReadingsByAsset(
          readings,
          assetMap,
        );

        // ---- 4. batch upsert (idempotent) -----------------------------------
        const errors: RejectedReading[] = [...rejectedFromFilter];
        let acceptedCount = 0;

        const insertRows = accepted.map((r) => ({
          company_id: companyId,
          project_id: r.project_id,
          scada_asset_id: r.scada_asset_id,
          ts: new Date(r.ts).toISOString(),
          metric: r.metric,
          value: r.value,
          quality: r.quality ?? "good",
        }));

        for (const batch of chunk(insertRows, INSERT_CHUNK_SIZE)) {
          const { error } = await admin
            .from("scada_telemetry")
            .upsert(batch as never, {
              onConflict: "scada_asset_id,metric,ts",
              ignoreDuplicates: true,
            });
          if (error) {
            // Whole batch failed — mark the batch as rejected with the DB reason.
            for (const row of batch) {
              if (errors.length < MAX_ERROR_DETAILS) {
                errors.push({
                  index: -1,
                  asset_key: row.scada_asset_id,
                  reason: `db_insert_failed: ${error.message}`,
                });
              }
            }
            continue;
          }
          acceptedCount += batch.length;
        }

        const rejectedCount = readings.length - acceptedCount;

        // ---- 5. audit ------------------------------------------------------
        // writeAuditLog() reads auth.uid() and looks up a profile — this hook
        // has no session, so insert directly with actor_id=null. Service-role
        // bypasses the SQL helper's authentication precondition.
        await admin.from("audit_logs").insert({
          company_id: companyId,
          actor_id: null,
          action: "scada.telemetry_ingest",
          entity: "scada_telemetry",
          entity_id: null,
          metadata: {
            accepted: acceptedCount,
            rejected: rejectedCount,
            company_id: companyId,
          },
        } as never);

        // ---- 6. downstream alarms (fire-and-forget) ------------------------
        // TODO(P-105): swap for a strongly-typed call once alarms.functions lands.
        try {
          const mod: Record<string, unknown> = await import(
            /* @vite-ignore */ "@/lib/alarms.functions" as string
          ).catch(() => ({}));
          const fn = mod?.evaluateAlarmRules;
          if (typeof fn === "function") {
            void (fn as (a: unknown) => unknown)({
              data: {
                company_id: companyId,
                asset_ids: Array.from(
                  new Set(accepted.map((r) => r.scada_asset_id)),
                ),
              },
            });
          }
        } catch {
          // alarms module not landed yet — safe to ignore.
        }

        // Only allow all-invalid to surface as 400 (matches "no rows accepted").
        if (acceptedCount === 0 && readings.length > 0) {
          return Response.json(
            {
              accepted: 0,
              rejected: readings.length,
              errors: errors.slice(0, MAX_ERROR_DETAILS),
            },
            { status: 400 },
          );
        }

        return Response.json({
          accepted: acceptedCount,
          rejected: rejectedCount,
          errors: errors.slice(0, MAX_ERROR_DETAILS),
        });
      },
    },
  },
});

// Keep zod referenced for downstream imports if the route is treeshaken oddly.
void z;
