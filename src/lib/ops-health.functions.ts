// P-134 — Ops health server function. Reads audit_logs across all tenants
// (super_admin only) and returns aggregated signal counters + 7-day series
// for the /admin/health dashboard. No mutations; no PII returned.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

export type SignalStatus = "ok" | "warn" | "crit";

export type Signal = {
  key: "rate_limit_fail_open" | "signature_failed" | "ip_denied" | "guard_401" | "guard_429";
  label: string;
  status: SignalStatus;
  value24h: number;
  peakPerHour: number;
  runbookHint: string;
};

export type CronStatus = {
  key: string;
  label: string;
  lastRunAt: string | null;
  status: SignalStatus;
};

export type SeriesPoint = { day: string; signature_failed: number; guard_429: number };

export type OpsHealth = {
  windowEnd: string;
  overall: SignalStatus;
  signals: Signal[];
  crons: CronStatus[];
  series: SeriesPoint[];
};

const CRON_ACTIONS: Array<{ key: string; label: string }> = [
  { key: "cron.approval_escalations", label: "Approval escalations" },
  { key: "cron.pm_work_orders", label: "PM work orders" },
  { key: "cron.scheduled_reports", label: "Scheduled reports" },
  { key: "cron.audit_retention", label: "Audit retention" },
  { key: "cron.webhook_dispatch", label: "Webhook dispatch" },
];

const SIG_FAIL_REASONS = new Set([
  "signature_missing",
  "signature_mismatch",
  "signature_expired",
  "secret_not_configured",
]);

const RUNBOOK = "/docs/api#operator-env-warn-block";

function statusFromRate(perHour: number, warn: number, crit: number): SignalStatus {
  if (perHour > crit) return "crit";
  if (perHour > warn) return "warn";
  return "ok";
}

function worstStatus(...items: SignalStatus[]): SignalStatus {
  if (items.some((s) => s === "crit")) return "crit";
  if (items.some((s) => s === "warn")) return "warn";
  return "ok";
}

type AuditRow = {
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export const getOpsHealth = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<OpsHealth> => {
    requireSupabaseAuth(context);

    // Verify super_admin server-side before any admin-scoped read.
    const { data: isSuper, error: roleErr } = await context.supabase.rpc("has_role", {
      p_user_id: context.user.id,
      p_role: "super_admin",
    });
    if (roleErr) throw roleErr;
    if (isSuper !== true) {
      throw Object.assign(new Error("forbidden"), {
        statusCode: 403,
        body: JSON.stringify({ error: "forbidden" }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Cross-tenant view requires bypassing RLS. Load admin client inside the
    // handler (never at module scope of a .functions.ts file).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Pull last 7d of relevant actions in one shot.
    const relevantActions = [
      "public_hook.rate_limit_fail_open",
      "public_hook.block",
      "public_hook.warn",
      ...CRON_ACTIONS.map((c) => c.key),
    ];
    const { data: rows, error: auditErr } = await supabaseAdmin
      .from("audit_logs")
      .select("action, metadata, created_at")
      .in("action", relevantActions)
      .gte("created_at", weekAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(10000);
    if (auditErr) throw auditErr;

    const audits = (rows ?? []) as AuditRow[];

    // Bucket per hour for last 24h, per day for last 7d.
    const in24h = audits.filter((r) => new Date(r.created_at) >= dayAgo);

    let failOpen = 0;
    let sigFailed = 0;
    let ipDenied = 0;
    let g401 = 0;
    let g429 = 0;

    const sigByHour = new Map<string, number>();
    const g429ByHour = new Map<string, number>();

    for (const r of in24h) {
      const reason = String((r.metadata ?? {}).reason ?? "");
      const hourKey = new Date(r.created_at).toISOString().slice(0, 13);
      if (r.action === "public_hook.rate_limit_fail_open") {
        failOpen += 1;
      } else if (r.action === "public_hook.block") {
        if (SIG_FAIL_REASONS.has(reason)) {
          sigFailed += 1;
          sigByHour.set(hourKey, (sigByHour.get(hourKey) ?? 0) + 1);
          g401 += 1;
        } else if (reason === "ip_not_allowed") {
          ipDenied += 1;
          g401 += 1;
        } else if (reason === "rate_limited") {
          g429 += 1;
          g429ByHour.set(hourKey, (g429ByHour.get(hourKey) ?? 0) + 1);
        } else if (
          reason === "missing_bearer" ||
          reason === "invalid_key" ||
          reason === "scope_missing"
        ) {
          g401 += 1;
        }
      } else if (r.action === "public_hook.warn") {
        if (SIG_FAIL_REASONS.has(reason)) sigFailed += 1;
        if (reason === "ip_not_allowed") ipDenied += 1;
      }
    }

    const sigPeak = Math.max(0, ...sigByHour.values());
    const g429Peak = Math.max(0, ...g429ByHour.values());

    const signals: Signal[] = [
      {
        key: "rate_limit_fail_open",
        label: "Rate limiter fail-open",
        status: failOpen > 0 ? "warn" : "ok",
        value24h: failOpen,
        peakPerHour: 0,
        runbookHint:
          "Rate limiter RPC unavailable — public hooks are passing through. Check consume_rate_limit RPC health.",
      },
      {
        key: "signature_failed",
        label: "Signature failures / hour",
        status: statusFromRate(sigPeak, 5, 20),
        value24h: sigFailed,
        peakPerHour: sigPeak,
        runbookHint:
          "Peaks > 20/h → CRIT: rotate the affected API key's HMAC secret and check clock skew. Peaks > 5/h → WARN: investigate the caller.",
      },
      {
        key: "ip_denied",
        label: "IP allowlist denials",
        status: ipDenied > 50 ? "warn" : "ok",
        value24h: ipDenied,
        peakPerHour: 0,
        runbookHint:
          "Confirm the caller's egress IP matches allowed_ips on the API key; add the correct CIDR before promoting warn → block.",
      },
      {
        key: "guard_401",
        label: "Guard 401 total",
        status: g401 > 200 ? "warn" : "ok",
        value24h: g401,
        peakPerHour: 0,
        runbookHint:
          "Missing/invalid bearers or bad signatures. Cross-check the integrator guide and re-share credentials via the API keys page.",
      },
      {
        key: "guard_429",
        label: "Guard 429 (rate limited)",
        status: statusFromRate(g429Peak, 10, 60),
        value24h: g429,
        peakPerHour: g429Peak,
        runbookHint:
          "Increase rateCapacity/refill for legitimate bursts, or coach the caller to back off. Sustained > 60/h → CRIT.",
      },
    ];

    // Latest run per cron action (from full 7d window).
    const cronLatest = new Map<string, string>();
    for (const r of audits) {
      if (r.action.startsWith("cron.")) {
        if (!cronLatest.has(r.action)) cronLatest.set(r.action, r.created_at);
      }
    }
    const crons: CronStatus[] = CRON_ACTIONS.map(({ key, label }) => {
      const lastRunAt = cronLatest.get(key) ?? null;
      let status: SignalStatus = "ok";
      if (!lastRunAt) status = "crit";
      else {
        const ageMs = now.getTime() - new Date(lastRunAt).getTime();
        if (ageMs > 26 * 60 * 60 * 1000) status = "crit";
        else if (ageMs > 3 * 60 * 60 * 1000) status = "warn";
      }
      return { key, label, lastRunAt, status };
    });

    // 7-day daily series for signature_failed + guard_429.
    const dayBuckets = new Map<string, { sig: number; r429: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      dayBuckets.set(d, { sig: 0, r429: 0 });
    }
    for (const r of audits) {
      const day = r.created_at.slice(0, 10);
      const bucket = dayBuckets.get(day);
      if (!bucket) continue;
      const reason = String((r.metadata ?? {}).reason ?? "");
      if (r.action === "public_hook.block" || r.action === "public_hook.warn") {
        if (SIG_FAIL_REASONS.has(reason)) bucket.sig += 1;
      }
      if (r.action === "public_hook.block" && reason === "rate_limited") {
        bucket.r429 += 1;
      }
    }
    const series: SeriesPoint[] = Array.from(dayBuckets.entries()).map(([day, v]) => ({
      day,
      signature_failed: v.sig,
      guard_429: v.r429,
    }));

    // Attach runbook link (semantic — the UI decides how to render).
    for (const s of signals) {
      s.runbookHint = `${s.runbookHint} — see ${RUNBOOK}`;
    }

    return {
      windowEnd: now.toISOString(),
      overall: worstStatus(...signals.map((s) => s.status), ...crons.map((c) => c.status)),
      signals,
      crons,
      series,
    };
  });
