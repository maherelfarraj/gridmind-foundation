// FX-01 — Import orchestration. Server-only.
//
// Reads the currencies GridMind actually transacts in, asks the provider for
// one observation, validates coverage, then commits idempotently into the
// authoritative fx_rates ledger. Never overwrites manual rows, never touches
// approval-locked forecast/accrual snapshots (those store their own rate).
import type { SupabaseClient } from "@supabase/supabase-js";

import { FrankfurterProvider } from "@/lib/fx/frankfurter.server";
import {
  FX_IMPORT_SOURCE,
  FxProviderError,
  buildImportPlan,
  decidePersistence,
  validateCoverage,
  type ExistingLedgerRow,
  type FxRateProvider,
} from "@/lib/fx/provider";

type Admin = SupabaseClient<any, any, any>;

export interface FxProviderSettings {
  provider: string;
  enabled: boolean;
  base_currency: string;
  treasury_currencies: string[];
  schedule_time: string;
  schedule_timezone: string;
  staleness_business_days: number;
}

export const FX_SETTINGS_FALLBACK: FxProviderSettings = {
  provider: FX_IMPORT_SOURCE,
  enabled: true,
  base_currency: "USD",
  treasury_currencies: [],
  schedule_time: "17:30",
  schedule_timezone: "Asia/Amman",
  staleness_business_days: 3,
};

export async function loadFxSettings(admin: Admin): Promise<FxProviderSettings> {
  const { data } = await admin
    .from("fx_provider_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  if (!data) return { ...FX_SETTINGS_FALLBACK };
  return {
    provider: data.provider ?? FX_SETTINGS_FALLBACK.provider,
    enabled: data.enabled ?? true,
    base_currency: (data.base_currency ?? "USD").toUpperCase(),
    treasury_currencies: (data.treasury_currencies ?? []).map((c: string) => c.toUpperCase()),
    schedule_time: data.schedule_time ?? FX_SETTINGS_FALLBACK.schedule_time,
    schedule_timezone: data.schedule_timezone ?? FX_SETTINGS_FALLBACK.schedule_timezone,
    staleness_business_days:
      data.staleness_business_days ?? FX_SETTINGS_FALLBACK.staleness_business_days,
  };
}

async function distinct(admin: Admin, table: string, column: string): Promise<string[]> {
  const { data, error } = await admin.from(table).select(column).limit(20_000);
  if (error) return [];
  const out = new Set<string>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const v = row[column];
    if (typeof v === "string" && /^[A-Za-z]{3}$/.test(v)) out.add(v.toUpperCase());
  }
  return Array.from(out);
}

export interface FxCurrencyScope {
  /** Reporting currencies rates must resolve into (fx_rates.quote_code). */
  quotes: string[];
  /** Transaction currencies in live use. */
  transactions: string[];
  /** Currencies known to the ledger (fx_rates FK target). */
  known: string[];
}

/** Currencies actually used across live financial documents + treasury list. */
export async function collectCurrencyScope(
  admin: Admin,
  settings: FxProviderSettings,
): Promise<FxCurrencyScope> {
  const [known, projectBases, forecasts, accruals, contracts, subcontracts, pos, invoices] =
    await Promise.all([
      distinct(admin, "currencies", "code"),
      distinct(admin, "project_financial_config", "currency_code"),
      distinct(admin, "cost_forecast_periods", "currency_code"),
      distinct(admin, "cost_accruals", "currency_code"),
      distinct(admin, "contracts", "currency_code"),
      distinct(admin, "subcontracts", "currency_code"),
      distinct(admin, "purchase_orders", "currency_code"),
      distinct(admin, "invoices", "currency_code"),
    ]);

  const knownSet = new Set(known);
  const quotes = new Set<string>([settings.base_currency, ...projectBases]);
  const transactions = new Set<string>([
    ...settings.treasury_currencies,
    ...forecasts,
    ...accruals,
    ...contracts,
    ...subcontracts,
    ...pos,
    ...invoices,
    ...quotes,
  ]);

  return {
    quotes: Array.from(quotes)
      .filter((c) => knownSet.has(c))
      .sort(),
    transactions: Array.from(transactions)
      .filter((c) => knownSet.has(c))
      .sort(),
    known,
  };
}

export interface FxImportResult {
  runId: string | null;
  status: "success" | "failed" | "skipped";
  observationDate: string | null;
  requested: number;
  imported: number;
  skipped: number;
  missing: string[];
  durationMs: number;
  error: string | null;
}

export interface RunFxImportOptions {
  trigger: "scheduled" | "manual";
  triggeredBy?: string | null;
  provider?: FxRateProvider;
}

export async function runFxImport(admin: Admin, opts: RunFxImportOptions): Promise<FxImportResult> {
  const startedAt = Date.now();
  const settings = await loadFxSettings(admin);
  const provider = opts.provider ?? new FrankfurterProvider();

  const { data: runRow } = await admin
    .from("fx_import_runs")
    .insert({
      provider: provider.name,
      trigger: opts.trigger,
      status: "running",
      triggered_by: opts.triggeredBy ?? null,
    })
    .select("id")
    .single();
  const runId = (runRow?.id as string | undefined) ?? null;

  const finish = async (
    result: Omit<FxImportResult, "runId" | "durationMs">,
  ): Promise<FxImportResult> => {
    const durationMs = Date.now() - startedAt;
    if (runId) {
      await admin
        .from("fx_import_runs")
        .update({
          status: result.status,
          observation_date: result.observationDate,
          requested_count: result.requested,
          imported_count: result.imported,
          skipped_count: result.skipped,
          missing_codes: result.missing,
          error_summary: result.error,
          duration_ms: durationMs,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    await admin.from("audit_logs").insert({
      company_id: null,
      actor_id: opts.triggeredBy ?? null,
      action: `fx.import.${result.status}`,
      entity: "fx_import_runs",
      entity_id: runId,
      metadata: { ...result, duration_ms: durationMs, provider: provider.name },
    } as never);
    return { ...result, runId, durationMs };
  };

  if (!settings.enabled && opts.trigger === "scheduled") {
    return finish({
      status: "skipped",
      observationDate: null,
      requested: 0,
      imported: 0,
      skipped: 0,
      missing: [],
      error: "provider_disabled",
    });
  }

  try {
    const scope = await collectCurrencyScope(admin, settings);
    const supported = await provider.supportedCurrencies();
    const anchor = supported.includes(settings.base_currency) ? settings.base_currency : "EUR";
    const observation = await provider.latest(anchor, scope.transactions);

    // Plan every (transaction -> reporting) pair before writing anything.
    const allPlanned: Array<{ base_code: string; quote_code: string; rate: number }> = [];
    const missing = new Set<string>();
    const unsupported = new Set<string>();
    let requested = 0;

    for (const quote of scope.quotes) {
      const plan = buildImportPlan(
        { quoteCurrency: quote, transactionCurrencies: scope.transactions, supported },
        observation,
      );
      const coverage = validateCoverage(plan);
      if (!coverage.ok) throw new FxProviderError("invalid_response", coverage.reason!);
      requested += plan.requested.length;
      plan.unsupported.forEach((c) => unsupported.add(c));
      plan.missing.forEach((c) => missing.add(c));
      allPlanned.push(...plan.planned);
    }

    const asOf = observation.observedOn;
    const bases = Array.from(new Set(allPlanned.map((p) => p.base_code)));
    const { data: existing } = await admin
      .from("fx_rates")
      .select("base_code, quote_code, as_of, source, rate")
      .eq("as_of", asOf)
      .in("base_code", bases.length > 0 ? bases : ["__none__"]);

    const decision = decidePersistence(
      allPlanned,
      asOf,
      (existing ?? []) as ExistingLedgerRow[],
      FX_IMPORT_SOURCE,
      provider.name,
    );

    if (decision.upserts.length > 0) {
      const nowIso = new Date().toISOString();
      const { error } = await admin.from("fx_rates").upsert(
        decision.upserts.map((u) => ({
          base_code: u.base_code,
          quote_code: u.quote_code,
          rate: u.rate,
          as_of: u.as_of,
          source: u.source,
          provider: u.provider,
          provider_observed_on: asOf,
          imported_at: nowIso,
        })),
        { onConflict: "base_code,quote_code,as_of,source" },
      );
      if (error) throw new Error(`ledger_write_failed: ${error.message}`);
    }

    return finish({
      status: "success",
      observationDate: asOf,
      requested,
      imported: decision.upserts.length,
      skipped: decision.skipped.length,
      missing: Array.from(unsupported).sort(),
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof FxProviderError
        ? `${err.code}: ${err.message}`
        : ((err as Error)?.message ?? "unknown_error");
    return finish({
      status: "failed",
      observationDate: null,
      requested: 0,
      imported: 0,
      skipped: 0,
      missing: [],
      error: message.slice(0, 500),
    });
  }
}
