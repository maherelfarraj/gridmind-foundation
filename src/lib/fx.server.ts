// FX-01 — Server-only loaders + guards for the FX Rate Management page.
import { z } from "zod";

import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  withAlertDefaults,
  localIsoDate,
  timezoneOffsetMinutes,
  type FxAlertSettings,
} from "@/lib/fx/alerts.server";
import { evaluateFxHealth, nextScheduledRun, type FxHealthStatus } from "@/lib/fx/health";
import { type FxFreshness } from "@/lib/fx/provider";
import { FX_SETTINGS_FALLBACK, type FxProviderSettings } from "@/lib/fx/import.server";

export const FX_ADMIN_ROLES = ["finance_admin", "company_admin"] as const;

export function fxHttpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function hasFxAdminRole(ctx: AuthContext): Promise<boolean> {
  const results = await Promise.all(
    FX_ADMIN_ROLES.map((r) => ctx.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => Boolean(r?.data));
}

export const manualRateSchema = z.object({
  base_code: z.string().trim().length(3),
  quote_code: z.string().trim().length(3),
  rate: z.number().positive().max(1_000_000),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(500),
});

export const fxAlertSettingsSchema = z.object({
  enabled: z.boolean(),
  notify_role: z.enum(["finance_admin", "company_admin", "billing_admin"]),
  failure_threshold: z.number().int().min(1).max(20),
  stale_business_days: z.number().int().min(1).max(30),
  alert_missing_currency: z.boolean(),
  large_move_pct: z.number().positive().max(100).nullable(),
});

export const fxSettingsSchema = z.object({
  enabled: z.boolean(),
  base_currency: z.string().trim().length(3),
  treasury_currencies: z.array(z.string().trim().length(3)).max(50),
  schedule_time: z.string().regex(/^\d{2}:\d{2}$/),
  schedule_timezone: z.string().trim().min(3).max(64),
  staleness_business_days: z.number().int().min(1).max(30),
});

export interface FxRateRow {
  id: string;
  base_code: string;
  quote_code: string;
  rate: number;
  as_of: string;
  source: string;
  provider: string | null;
  provider_observed_on: string | null;
  imported_at: string | null;
  is_manual: boolean;
}

export type FxDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number>
  | Array<Record<string, string | number>>;
export type FxDiagnostics = Record<string, FxDiagnosticValue>;

export interface FxRunRow {
  id: string;
  provider: string;
  trigger: string;
  status: string;
  observation_date: string | null;
  requested_count: number;
  imported_count: number;
  skipped_count: number;
  missing_codes: string[];
  error_summary: string | null;
  error_code: string | null;
  actor_kind: string;
  base_currency: string | null;
  requested_currencies: string[];
  failed_count: number;
  diagnostics: FxDiagnostics;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface FxAdminData {
  canManage: boolean;
  settings: FxProviderSettings;
  freshness: FxFreshness & { lastObservationDate: string | null };
  lastSuccess: FxRunRow | null;
  lastFailure: FxRunRow | null;
  runs: FxRunRow[];
  rates: FxRateRow[];
  currencies: Array<{ code: string; name: string; minor_unit: number }>;
  missingCurrencies: string[];
  health: {
    status: FxHealthStatus;
    reasons: string[];
    consecutiveFailures: number;
    lastAttemptAt: string | null;
    nextScheduledRun: string | null;
  };
  alertSettings: Omit<FxAlertSettings, "company_id">;
  companyId: string | null;
}

export async function loadFxAdminData(ctx: AuthContext): Promise<FxAdminData> {
  const sb = ctx.supabase as never as {
    from: (t: string) => any;
    rpc: (fn: string, args?: Record<string, unknown>) => any;
  };

  const userId = ctx.user?.id ?? null;
  const profileRes = userId
    ? await sb.from("profiles").select("company_id").eq("id", userId).maybeSingle()
    : { data: null };
  const companyId = (profileRes.data?.company_id as string | undefined) ?? null;

  const [settingsRes, runsRes, ratesRes, currenciesRes, alertRes] = await Promise.all([
    sb.from("fx_provider_settings").select("*").eq("id", true).maybeSingle(),
    // GC-06: the feed is global (cron runs carry company_id = NULL), while the
    // table policy is strictly company-scoped. This definer routine applies the
    // same finance/company-admin gate and returns global + own-company runs.
    sb.rpc("fx_import_runs_recent", { p_limit: 25 }),

    sb
      .from("fx_rates")
      .select(
        "id, base_code, quote_code, rate, as_of, source, provider, provider_observed_on, imported_at",
      )
      .order("as_of", { ascending: false })
      .limit(500),
    sb.from("currencies").select("code, name, minor_unit").order("code"),
    companyId
      ? sb.from("fx_alert_settings").select("*").eq("company_id", companyId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const s = settingsRes.data;
  const settings: FxProviderSettings = s
    ? {
        provider: s.provider ?? FX_SETTINGS_FALLBACK.provider,
        enabled: Boolean(s.enabled),
        base_currency: String(s.base_currency ?? "USD").toUpperCase(),
        treasury_currencies: (s.treasury_currencies ?? []).map((c: string) => c.toUpperCase()),
        schedule_time: s.schedule_time ?? FX_SETTINGS_FALLBACK.schedule_time,
        schedule_timezone: s.schedule_timezone ?? FX_SETTINGS_FALLBACK.schedule_timezone,
        staleness_business_days:
          s.staleness_business_days ?? FX_SETTINGS_FALLBACK.staleness_business_days,
      }
    : { ...FX_SETTINGS_FALLBACK };

  const runs = ((runsRes.data ?? []) as FxRunRow[]).map((r) => ({
    ...r,
    missing_codes: r.missing_codes ?? [],
    requested_currencies: r.requested_currencies ?? [],
    diagnostics: (r.diagnostics ?? {}) as FxDiagnostics,
    failed_count: r.failed_count ?? 0,
    actor_kind: r.actor_kind ?? "system",
  }));
  const lastSuccess = runs.find((r) => r.status === "success") ?? null;
  const lastFailure = runs.find((r) => r.status === "failed") ?? null;

  const rates: FxRateRow[] = ((ratesRes.data ?? []) as FxRateRow[]).map((r) => ({
    ...r,
    rate: Number(r.rate),
    is_manual: r.source === "manual",
  }));

  const alertSettings = withAlertDefaults(companyId ?? "", alertRes.data ?? null);
  const today = localIsoDate(settings.schedule_timezone);
  const lastObservationDate = lastSuccess?.observation_date ?? null;

  const attempts = runs.filter((r) => r.status === "success" || r.status === "failed");
  let consecutiveFailures = 0;
  for (const r of attempts) {
    if (r.status === "failed") consecutiveFailures += 1;
    else break;
  }

  const health = evaluateFxHealth({
    lastObservationDate,
    lastAttemptStatus: (attempts[0]?.status ?? null) as never,
    consecutiveFailures,
    missingCurrencies: lastSuccess?.missing_codes ?? [],
    today,
    stalenessBusinessDays: alertSettings.stale_business_days,
    failureThreshold: alertSettings.failure_threshold,
    alertMissingCurrency: alertSettings.alert_missing_currency,
  });

  return {
    canManage: await hasFxAdminRole(ctx),
    settings,
    companyId,
    alertSettings: {
      enabled: alertSettings.enabled,
      notify_role: alertSettings.notify_role,
      failure_threshold: alertSettings.failure_threshold,
      stale_business_days: alertSettings.stale_business_days,
      alert_missing_currency: alertSettings.alert_missing_currency,
      large_move_pct: alertSettings.large_move_pct,
    },
    health: {
      status: health.status,
      reasons: health.reasons,
      consecutiveFailures,
      lastAttemptAt: attempts[0]?.started_at ?? null,
      nextScheduledRun: nextScheduledRun(
        settings.schedule_time,
        timezoneOffsetMinutes(settings.schedule_timezone),
      ),
    },
    freshness: {
      ...health.freshness,
      lastObservationDate,
    },
    lastSuccess,
    lastFailure,
    runs,
    rates,
    currencies: (currenciesRes.data ?? []) as FxAdminData["currencies"],
    missingCurrencies: Array.from(new Set(runs.flatMap((r) => r.missing_codes ?? []))).sort(),
  };
}
