// FX-01 — Server-only loaders + guards for the FX Rate Management page.
import { z } from "zod";

import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { assessFreshness, type FxFreshness } from "@/lib/fx/provider";
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
}

export async function loadFxAdminData(ctx: AuthContext): Promise<FxAdminData> {
  const sb = ctx.supabase as never as {
    from: (t: string) => any;
  };

  const [settingsRes, runsRes, ratesRes, currenciesRes] = await Promise.all([
    sb.from("fx_provider_settings").select("*").eq("id", true).maybeSingle(),
    sb.from("fx_import_runs").select("*").order("started_at", { ascending: false }).limit(25),
    sb
      .from("fx_rates")
      .select(
        "id, base_code, quote_code, rate, as_of, source, provider, provider_observed_on, imported_at",
      )
      .order("as_of", { ascending: false })
      .limit(500),
    sb.from("currencies").select("code, name, minor_unit").order("code"),
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
  }));
  const lastSuccess = runs.find((r) => r.status === "success") ?? null;
  const lastFailure = runs.find((r) => r.status === "failed") ?? null;

  const rates: FxRateRow[] = ((ratesRes.data ?? []) as FxRateRow[]).map((r) => ({
    ...r,
    rate: Number(r.rate),
    is_manual: r.source === "manual",
  }));

  const today = new Date().toISOString().slice(0, 10);
  const lastObservationDate = lastSuccess?.observation_date ?? null;

  return {
    canManage: await hasFxAdminRole(ctx),
    settings,
    freshness: {
      ...assessFreshness(lastObservationDate, today, settings.staleness_business_days),
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
