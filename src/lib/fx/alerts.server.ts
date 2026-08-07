// FX-02 — Feed health evaluation + de-duplicated alert delivery.
//
// The FX feed itself is global (one provider, one authoritative ledger), but
// thresholds, recipients and notification state are per organization. Alerts
// fire only on a health *transition*, so cron retries and page loads never
// re-notify. Recovery to Healthy emits exactly one notice.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideFxAlert,
  evaluateFxHealth,
  type FxAlertKind,
  type FxHealthAssessment,
  type FxHealthStatus,
} from "@/lib/fx/health";

type Admin = SupabaseClient<any, any, any>;

export interface FxAlertSettings {
  company_id: string;
  enabled: boolean;
  notify_role: string;
  failure_threshold: number;
  stale_business_days: number;
  alert_missing_currency: boolean;
  large_move_pct: number | null;
}

export const FX_ALERT_DEFAULTS: Omit<FxAlertSettings, "company_id"> = {
  enabled: true,
  notify_role: "finance_admin",
  failure_threshold: 1,
  stale_business_days: 3,
  alert_missing_currency: true,
  large_move_pct: null,
};

export function withAlertDefaults(
  companyId: string,
  row: Partial<FxAlertSettings> | null | undefined,
): FxAlertSettings {
  return {
    company_id: companyId,
    enabled: row?.enabled ?? FX_ALERT_DEFAULTS.enabled,
    notify_role: row?.notify_role ?? FX_ALERT_DEFAULTS.notify_role,
    failure_threshold: row?.failure_threshold ?? FX_ALERT_DEFAULTS.failure_threshold,
    stale_business_days: row?.stale_business_days ?? FX_ALERT_DEFAULTS.stale_business_days,
    alert_missing_currency: row?.alert_missing_currency ?? FX_ALERT_DEFAULTS.alert_missing_currency,
    large_move_pct: row?.large_move_pct ?? FX_ALERT_DEFAULTS.large_move_pct,
  };
}

/** `YYYY-MM-DD` for `now` in an IANA timezone (falls back to UTC). */
export function localIsoDate(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Current UTC offset in minutes for an IANA timezone. */
export function timezoneOffsetMinutes(timeZone: string, now: Date = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(now).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts["year"]),
      Number(parts["month"]) - 1,
      Number(parts["day"]),
      Number(parts["hour"]) % 24,
      Number(parts["minute"]),
      Number(parts["second"]),
    );
    return Math.round((asUtc - now.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

export interface FxFeedFacts {
  lastObservationDate: string | null;
  lastAttemptStatus: "running" | "success" | "failed" | "skipped" | null;
  consecutiveFailures: number;
  missingCurrencies: string[];
  lastRunId: string | null;
}

/** Read the global feed facts health is derived from. */
export async function loadFxFeedFacts(admin: Admin): Promise<FxFeedFacts> {
  const { data } = await admin
    .from("fx_import_runs")
    .select("id, status, observation_date, missing_codes, started_at")
    .order("started_at", { ascending: false })
    .limit(50);

  const runs = (data ?? []) as Array<{
    id: string;
    status: FxFeedFacts["lastAttemptStatus"];
    observation_date: string | null;
    missing_codes: string[] | null;
  }>;
  const attempts = runs.filter((r) => r.status === "success" || r.status === "failed");
  const lastSuccess = runs.find((r) => r.status === "success") ?? null;

  let consecutiveFailures = 0;
  for (const r of attempts) {
    if (r.status === "failed") consecutiveFailures += 1;
    else break;
  }

  return {
    lastObservationDate: lastSuccess?.observation_date ?? null,
    lastAttemptStatus: attempts[0]?.status ?? null,
    consecutiveFailures,
    missingCurrencies: Array.from(new Set(lastSuccess?.missing_codes ?? [])).sort(),
    lastRunId: runs[0]?.id ?? null,
  };
}

export interface FxAlertNotice {
  companyId: string;
  kind: FxAlertKind;
  status: FxHealthStatus;
  recipients: number;
}

const TITLES: Record<FxAlertKind, string> = {
  failed: "Exchange-rate feed failed",
  degraded: "Exchange-rate feed degraded",
  recovered: "Exchange-rate feed recovered",
};

function bodyFor(kind: FxAlertKind, health: FxHealthAssessment): string {
  if (kind === "recovered") return "The exchange-rate feed is healthy again.";
  const reasons = health.reasons.map((r) => r.replace(/_/g, " ")).join(", ") || "unknown reason";
  const missing = health.missingCurrencies.length
    ? ` Missing: ${health.missingCurrencies.join(", ")}.`
    : "";
  return `Feed status is ${kind}. Reason: ${reasons}.${missing}`;
}

/**
 * Evaluate health for one organization and emit a notification only when the
 * status transitions. Returns the notice when one was sent.
 */
export async function evaluateAndAlertCompany(
  admin: Admin,
  companyId: string,
  facts: FxFeedFacts,
  settings: FxAlertSettings,
  opts: { today: string },
): Promise<{ health: FxHealthAssessment; notice: FxAlertNotice | null }> {
  const health = evaluateFxHealth({
    lastObservationDate: facts.lastObservationDate,
    lastAttemptStatus: facts.lastAttemptStatus,
    consecutiveFailures: facts.consecutiveFailures,
    missingCurrencies: facts.missingCurrencies,
    today: opts.today,
    stalenessBusinessDays: settings.stale_business_days,
    failureThreshold: settings.failure_threshold,
    alertMissingCurrency: settings.alert_missing_currency,
  });

  const { data: stateRow } = await admin
    .from("fx_health_state")
    .select("last_notified_status")
    .eq("company_id", companyId)
    .maybeSingle();

  const lastNotifiedStatus = ((stateRow as { last_notified_status?: FxHealthStatus | null } | null)
    ?.last_notified_status ?? null) as FxHealthStatus | null;

  const decision = decideFxAlert({
    status: health.status,
    lastNotifiedStatus,
    alertsEnabled: settings.enabled,
  });

  let notice: FxAlertNotice | null = null;

  if (decision.notify && decision.kind) {
    const { data: holders } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("role", settings.notify_role);
    const userIds = Array.from(
      new Set(((holders ?? []) as Array<{ user_id: string }>).map((h) => h.user_id)),
    );
    if (userIds.length > 0) {
      await admin.from("notifications").insert(
        userIds.map((uid) => ({
          company_id: companyId,
          user_id: uid,
          type: `fx.feed.${decision.kind}`,
          title: TITLES[decision.kind!],
          body: bodyFor(decision.kind!, health),
          link: "/settings/fx-rates",
          metadata: {
            status: health.status,
            reasons: health.reasons,
            missing_currencies: health.missingCurrencies,
            run_id: facts.lastRunId,
          },
        })) as never,
      );
    }
    notice = {
      companyId,
      kind: decision.kind,
      status: health.status,
      recipients: userIds.length,
    };
  }

  await admin.from("fx_health_state").upsert(
    {
      company_id: companyId,
      status: health.status,
      consecutive_failures: facts.consecutiveFailures,
      last_run_id: facts.lastRunId,
      details: { reasons: health.reasons, missing_currencies: health.missingCurrencies },
      ...(decision.notify
        ? { last_notified_status: health.status, last_notified_at: new Date().toISOString() }
        : {}),
    } as never,
    { onConflict: "company_id" },
  );

  return { health, notice };
}

/** Evaluate + alert every organization. Used by the daily import cron. */
export async function evaluateAndAlertAll(
  admin: Admin,
  opts: { today: string },
): Promise<FxAlertNotice[]> {
  const facts = await loadFxFeedFacts(admin);
  const { data: companies } = await admin.from("companies").select("id").limit(1000);
  const { data: settingsRows } = await admin.from("fx_alert_settings").select("*").limit(1000);
  const byCompany = new Map<string, Partial<FxAlertSettings>>();
  for (const r of (settingsRows ?? []) as FxAlertSettings[]) byCompany.set(r.company_id, r);

  const notices: FxAlertNotice[] = [];
  for (const c of ((companies ?? []) as Array<{ id: string }>).map((c) => c.id)) {
    try {
      const { notice } = await evaluateAndAlertCompany(
        admin,
        c,
        facts,
        withAlertDefaults(c, byCompany.get(c)),
        opts,
      );
      if (notice) notices.push(notice);
    } catch (err) {
      console.warn(
        JSON.stringify({
          scope: "fx.alerts",
          company_id: c,
          error: (err as Error)?.message ?? "unknown",
        }),
      );
    }
  }
  return notices;
}
