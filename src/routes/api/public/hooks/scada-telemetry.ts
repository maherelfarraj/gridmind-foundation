// P-122 — SCADA telemetry ingestion hook, fully guarded.
//
// The P-103 minimal API-key check is retired: guardPublicHook now enforces
// Bearer + scope + cf-connecting-ip allowlist + timestamped HMAC (300s replay
// window) + token-bucket rate limit. The guard reads the body once and
// exposes it as `guard.rawBody` — the handler MUST reuse that string; a
// second `request.text()` would empty the stream and break HMAC on retries
// downstream of caching proxies.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { createServiceRoleClient } from "@/integrations/supabase/admin";
import { guardPublicHook } from "@/lib/public-api/guard";
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

const ENDPOINT = "hooks:scada-telemetry";

export const Route = createFileRoute("/api/public/hooks/scada-telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardPublicHook(request, {
          route: ENDPOINT,
          scope: "scada:telemetry:write",
          requireSignature: true,
          rateCapacity: 120,
          rateRefillPerSec: 2,
        });
        if (!guard.ok) return guard.response;

        const admin = createServiceRoleClient();
        // Scope guard rejected cron callers upstream; api_key callers always carry a companyId.
        const companyId = guard.caller.companyId!;

        // ---- Body parse (single read via guard.rawBody) --------------------
        let json: unknown;
        try {
          json = JSON.parse(guard.rawBody);
        } catch {
          return Response.json({ error: "invalid_payload", reason: "bad_json" }, { status: 400 });
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
          return Response.json(
            { error: "invalid_payload", details: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { readings } = parsed.data;

        // ---- Resolve asset_key → id, scoped to guard.caller.companyId -------
        // Foreign-company keys never resolve → those readings are rejected.
        const uniqueKeys = Array.from(new Set(readings.map((r) => r.asset_key)));
        const assetLookup = await admin
          .from("scada_assets")
          .select("id, asset_key, project_id, company_id")
          .eq("company_id", companyId)
          .in("asset_key", uniqueKeys);

        // 42P01 = undefined_table → schema not yet migrated; return graceful 503.
        if (assetLookup.error && (assetLookup.error as { code?: string }).code === "42P01") {
          return Response.json(
            { error: "scada_disabled", reason: "scada_assets table not present" },
            { status: 503 },
          );
        }
        if (assetLookup.error) {
          return Response.json({ error: "asset_lookup_failed" }, { status: 500 });
        }

        const assetMap = new Map<string, AssetLookup>();
        for (const row of assetLookup.data ?? []) {
          const r = row as { id: string; asset_key: string; project_id: string | null };
          if (!r.project_id) continue;
          assetMap.set(r.asset_key, { scada_asset_id: r.id, project_id: r.project_id });
        }

        const { accepted, rejected: rejectedFromFilter } = filterReadingsByAsset(
          readings,
          assetMap,
        );

        // ---- Chunked upsert -------------------------------------------------
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
          const { error } = await admin.from("scada_telemetry").upsert(batch as never, {
            onConflict: "scada_asset_id,metric,ts",
            ignoreDuplicates: true,
          });
          if (error) {
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

        // ---- Audit successful ingest ---------------------------------------
        await admin.from("audit_logs").insert({
          company_id: companyId,
          actor_id: null,
          action: "scada.telemetry_ingest",
          entity: "scada_telemetry",
          entity_id: null,
          metadata: {
            endpoint: ENDPOINT,
            key_id: guard.keyId,
            accepted: acceptedCount,
            rejected: rejectedCount,
          },
        } as never);

        // ---- P-173 event log (fire-and-forget) -----------------------------
        try {
          const { parseHookEvents, persistScadaEvents } = await import("@/lib/scada-events.server");
          const events = parseHookEvents(json);
          if (events.length > 0) {
            await persistScadaEvents(admin as never, companyId, events);
          }
        } catch {
          /* best-effort: events never fail telemetry ingest */
        }

        // ---- P-105 downstream alarms (fire-and-forget) ---------------------
        try {
          const { evaluateAlarmRules } = await import("@/lib/alarms.server");
          await evaluateAlarmRules(
            admin,
            companyId,
            accepted.map((r) => ({
              scada_asset_id: r.scada_asset_id,
              project_id: r.project_id,
              metric: r.metric,
              value: r.value,
              ts: new Date(r.ts).toISOString(),
            })),
          );
        } catch {
          /* best-effort */
        }

        if (acceptedCount === 0 && readings.length > 0) {
          return Response.json(
            { accepted: 0, rejected: readings.length, errors: errors.slice(0, MAX_ERROR_DETAILS) },
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

void z;
