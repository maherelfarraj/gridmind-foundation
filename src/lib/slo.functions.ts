// SLO/SLI dashboard — computes live snapshots from operational tables
// (cron freshness, SCADA ingestion freshness, public hook 401 rate, finance
// alert triage time) and persists them to ops_slo_snapshots for history.
// Super-admin only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { Database } from "@/integrations/supabase/types";

export type SloStatus = Database["public"]["Enums"]["slo_status"];

export type SloSnapshot = {
  slo_name: string;
  target: string;
  observed_value: number | null;
  status: SloStatus;
  measurement_window: string;
  created_at: string;
};

async function requireSuperAdmin(context: {
  user: { id: string };
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
}) {
  const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
    p_user_id: context.user.id,
    p_role: "super_admin",
  });
  if (roleErr) throw roleErr as Error;
  if (isSuper !== true) {
    throw Object.assign(new Error("forbidden"), {
      statusCode: 403,
      body: JSON.stringify({ error: "forbidden" }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

function minutesAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / 60000;
}

export const getSloDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<SloSnapshot[]> => {
    requireSupabaseAuth(context);
    await requireSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const snapshots: SloSnapshot[] = [];

    // 1. Cron probe freshness
    const { data: cronRow, error: cronErr } = await supabaseAdmin
      .from("cron_probe")
      .select("fired_at")
      .order("fired_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cronErr) throw cronErr;
    const cronAgeMin = minutesAgo(cronRow?.fired_at ?? null, now);
    snapshots.push({
      slo_name: "Cron probe freshness",
      target: "< 15 min since last fire",
      observed_value: cronAgeMin,
      status: cronAgeMin === null ? "breach" : cronAgeMin <= 15 ? "ok" : cronAgeMin <= 60 ? "warn" : "breach",
      measurement_window: "point-in-time",
      created_at: now.toISOString(),
    });

    // 2. SCADA ingestion freshness
    const { data: scadaRow, error: scadaErr } = await supabaseAdmin
      .from("scada_telemetry")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scadaErr) throw scadaErr;
    const scadaAgeMin = minutesAgo(scadaRow?.created_at ?? null, now);
    snapshots.push({
      slo_name: "SCADA ingestion freshness",
      target: "< 30 min since last reading",
      observed_value: scadaAgeMin,
      status:
        scadaAgeMin === null ? "breach" : scadaAgeMin <= 30 ? "ok" : scadaAgeMin <= 120 ? "warn" : "breach",
      measurement_window: "point-in-time",
      created_at: now.toISOString(),
    });

    // 3. Public hook 401 rate (last 1h)
    const { data: hookRows, error: hookErr } = await supabaseAdmin
      .from("audit_logs")
      .select("action, metadata, created_at")
      .in("action", ["public_hook.block", "public_hook.warn", "public_hook.success"])
      .gte("created_at", hourAgo.toISOString())
      .limit(20000);
    if (hookErr) throw hookErr;
    const hookAudits = hookRows ?? [];
    const total = hookAudits.length;
    const unauthorized401 = hookAudits.filter((r) => {
      const reason = String((r.metadata as Record<string, unknown> | null)?.reason ?? "");
      return (
        r.action === "public_hook.block" &&
        ["missing_bearer", "invalid_key", "scope_missing", "signature_missing", "signature_mismatch", "signature_expired", "secret_not_configured"].includes(
          reason,
        )
      );
    }).length;
    const rate401 = total > 0 ? (unauthorized401 / total) * 100 : 0;
    snapshots.push({
      slo_name: "Public hook 401 rate",
      target: "< 5% of requests",
      observed_value: total > 0 ? Number(rate401.toFixed(2)) : 0,
      status: total === 0 ? "ok" : rate401 <= 5 ? "ok" : rate401 <= 15 ? "warn" : "breach",
      measurement_window: "last 1h",
      created_at: now.toISOString(),
    });

    // 4. Finance alert triage time (avg minutes created_at -> acknowledged_at, last 30d)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { data: alertRows, error: alertErr } = await supabaseAdmin
      .from("finance_alerts")
      .select("created_at, acknowledged_at")
      .not("acknowledged_at", "is", null)
      .gte("created_at", thirtyDaysAgo.toISOString())
      .limit(5000);
    if (alertErr) throw alertErr;
    const acked = alertRows ?? [];
    const triageMinutes = acked.map(
      (r) => (new Date(r.acknowledged_at as string).getTime() - new Date(r.created_at).getTime()) / 60000,
    );
    const avgTriage =
      triageMinutes.length > 0 ? triageMinutes.reduce((a, b) => a + b, 0) / triageMinutes.length : null;
    snapshots.push({
      slo_name: "Finance alert triage time",
      target: "< 240 min average",
      observed_value: avgTriage === null ? null : Number(avgTriage.toFixed(1)),
      status: avgTriage === null ? "ok" : avgTriage <= 240 ? "ok" : avgTriage <= 480 ? "warn" : "breach",
      measurement_window: "last 30d",
      created_at: now.toISOString(),
    });

    // Persist snapshots for history (best-effort, non-blocking on failure).
    const insertRows = snapshots.map((s) => ({
      slo_name: s.slo_name,
      slo_target: { description: s.target },
      observed_value: s.observed_value,
      status: s.status,
      measurement_window: s.measurement_window,
    }));
    await supabaseAdmin.from("ops_slo_snapshots").insert(insertRows);

    return snapshots;
  });
