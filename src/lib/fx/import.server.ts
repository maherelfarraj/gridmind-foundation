// FX-01 — Import orchestration. Server-only.
//
// Reads the currencies GridMind actually transacts in, asks the provider for
// one observation, validates coverage, then commits idempotently into the
// authoritative fx_rates ledger. Never overwrites manual rows, never touches
// approval-locked forecast/accrual snapshots (those store their own rate).
import type { SupabaseClient } from "@supabase/supabase-js";

import { evaluateAndAlertAll, localIsoDate } from "@/lib/fx/alerts.server";
import {
  completeFxRun,
  openFxRun,
  toStructuredError,
  type FxActorKind,
} from "@/lib/fx/audit.server";
import { FrankfurterProvider } from "@/lib/fx/frankfurter.server";
import { detectLargeMoves, type FxLargeMove } from "@/lib/fx/health";
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
  failed: number;
  missing: string[];
  durationMs: number;
  errorCode: string | null;
  error: string | null;
  largeMoves: FxLargeMove[];
}

export interface RunFxImportOptions {
  trigger: "scheduled" | "manual";
  triggeredBy?: string | null;
  /** Organization scope for the audit row (manual syncs). */
  companyId?: string | null;
  actorKind?: FxActorKind;
  provider?: FxRateProvider;
  /** Evaluate feed health and emit alerts after the run. Default: true. */
  evaluateHealth?: boolean;
}

export async function runFxImport(admin: Admin, opts: RunFxImportOptions): Promise<FxImportResult> {
  const startedAt = Date.now();
  const settings = await loadFxSettings(admin);
  const provider = opts.provider ?? new FrankfurterProvider();
  const actorKind: FxActorKind = opts.actorKind ?? (opts.trigger === "manual" ? "user" : "cron");

  const open = {
    companyId: opts.companyId ?? null,
    provider: provider.name,
    trigger: opts.trigger,
    actorKind,
    triggeredBy: opts.triggeredBy ?? null,
    baseCurrency: settings.base_currency,
    requestedCurrencies: [] as string[],
  };

  // Opened BEFORE the provider is contacted so a provider or database failure
  // still leaves a useful failed-run record.
  const runId = await openFxRun(admin, open);

  const finish = async (
    result: Omit<FxImportResult, "runId" | "durationMs">,
    extra: { requestedCurrencies?: string[]; diagnostics?: unknown } = {},
  ): Promise<FxImportResult> => {
    const durationMs = Date.now() - startedAt;
    const finalRunId = await completeFxRun(admin, runId, open, {
      status: result.status,
      observationDate: result.observationDate,
      baseCurrency: settings.base_currency,
      requestedCurrencies: extra.requestedCurrencies ?? open.requestedCurrencies,
      requestedCount: result.requested,
      importedCount: result.imported,
      skippedCount: result.skipped,
      failedCount: result.failed,
      missingCodes: result.missing,
      errorCode: result.errorCode,
      errorMessage: result.error,
      diagnostics: extra.diagnostics,
      durationMs,
    });

    try {
      await admin.from("audit_logs").insert({
        company_id: opts.companyId ?? null,
        actor_id: opts.triggeredBy ?? null,
        action: `fx.import.${result.status}`,
        entity: "fx_import_runs",
        entity_id: finalRunId,
        metadata: {
          status: result.status,
          trigger: opts.trigger,
          actor_kind: actorKind,
          provider: provider.name,
          observation_date: result.observationDate,
          requested: result.requested,
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          missing: result.missing,
          error_code: result.errorCode,
          duration_ms: durationMs,
        },
      } as never);
    } catch {
      /* audit_logs must never mask the import outcome */
    }

    if (opts.evaluateHealth !== false) {
      try {
        await evaluateAndAlertAll(admin, {
          today: localIsoDate(settings.schedule_timezone),
        });
      } catch (err) {
        console.warn(
          JSON.stringify({
            scope: "fx.import",
            event: "health_eval_failed",
            ...toStructuredError(err),
          }),
        );
      }
    }

    return { ...result, runId: finalRunId, durationMs };
  };

  if (!settings.enabled && opts.trigger === "scheduled") {
    return finish({
      status: "skipped",
      observationDate: null,
      requested: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      missing: [],
      errorCode: "provider_disabled",
      error: "provider_disabled",
      largeMoves: [],
    });
  }

  let requestedCurrencies: string[] = [];

  try {
    const scope = await collectCurrencyScope(admin, settings);
    requestedCurrencies = scope.transactions;
    open.requestedCurrencies = requestedCurrencies;

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

    // Large-move detection compares against the most recent prior imported
    // value for the same pair (never against a manual override).
    const largeMoves = await detectMovesAgainstPrior(
      admin,
      decision.upserts,
      asOf,
      await loadLargeMoveThreshold(admin),
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
      if (error) throw Object.assign(new Error(error.message), { code: "ledger_write_failed" });
    }

    return finish(
      {
        status: "success",
        observationDate: asOf,
        requested,
        imported: decision.upserts.length,
        skipped: decision.skipped.length,
        failed: 0,
        missing: Array.from(unsupported).sort(),
        errorCode: null,
        error: null,
        largeMoves,
      },
      {
        requestedCurrencies,
        diagnostics: {
          anchor: observation.anchor,
          supported_count: supported.length,
          unsupported_codes: Array.from(unsupported).sort(),
          quote_currencies: scope.quotes,
          attempted_pairs: allPlanned.length,
          skipped_reasons: Array.from(new Set(decision.skipped.map((s) => s.reason))).sort(),
          large_moves: largeMoves,
        },
      },
    );
  } catch (err) {
    const structured =
      err instanceof FxProviderError
        ? { code: err.code, message: err.message }
        : toStructuredError(err);
    return finish(
      {
        status: "failed",
        observationDate: null,
        requested: 0,
        imported: 0,
        skipped: 0,
        failed: 1,
        missing: [],
        errorCode: structured.code,
        error: structured.message,
        largeMoves: [],
      },
      { requestedCurrencies, diagnostics: { provider_status: structured.code } },
    );
  }
}

/** Compare each planned rate against the newest prior imported value. */
async function detectMovesAgainstPrior(
  admin: Admin,
  planned: ReadonlyArray<{ base_code: string; quote_code: string; rate: number }>,
  asOf: string,
  thresholdPct: number | null,
): Promise<FxLargeMove[]> {
  if (thresholdPct == null || planned.length === 0) return [];
  try {
    const { data } = await admin
      .from("fx_rates")
      .select("base_code, quote_code, rate, as_of")
      .eq("source", FX_IMPORT_SOURCE)
      .lt("as_of", asOf)
      .order("as_of", { ascending: false })
      .limit(2000);
    const prior = new Map<string, number>();
    for (const r of (data ?? []) as Array<{
      base_code: string;
      quote_code: string;
      rate: number;
    }>) {
      const k = `${r.base_code}|${r.quote_code}`;
      if (!prior.has(k)) prior.set(k, Number(r.rate));
    }
    const pairs = planned
      .map((p) => ({
        base_code: p.base_code,
        quote_code: p.quote_code,
        previous: prior.get(`${p.base_code}|${p.quote_code}`) ?? NaN,
        next: p.rate,
      }))
      .filter((p) => Number.isFinite(p.previous));
    return detectLargeMoves(pairs, thresholdPct);
  } catch {
    return [];
  }
}

/** Tightest configured large-move threshold across organizations, if any. */
async function loadLargeMoveThreshold(admin: Admin): Promise<number | null> {
  try {
    const { data } = await admin
      .from("fx_alert_settings")
      .select("large_move_pct")
      .not("large_move_pct", "is", null)
      .limit(1000);
    const values = ((data ?? []) as Array<{ large_move_pct: number | null }>)
      .map((r) => Number(r.large_move_pct))
      .filter((n) => Number.isFinite(n) && n > 0);
    return values.length > 0 ? Math.min(...values) : null;
  } catch {
    return null;
  }
}
