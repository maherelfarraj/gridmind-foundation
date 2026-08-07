// FX-02 — Durable FX import audit trail.
//
// Every attempt — scheduled or manual, successful or not — gets a
// `fx_import_runs` row created *before* the provider is contacted, so a
// provider or database failure still leaves a useful failed-run record.
// Nothing here mutates `fx_rates`: the ledger stays authoritative.
//
// Security: diagnostics are allow-listed and bounded. Signing secrets, auth
// headers, bearer tokens and raw provider payloads are never persisted.
import type { SupabaseClient } from "@supabase/supabase-js";

import { FX_DIAGNOSTIC_MAX_ITEMS, boundedText } from "@/lib/fx/health";

type Admin = SupabaseClient<any, any, any>;

export type FxRunStatus = "running" | "success" | "failed" | "skipped";
export type FxRunTrigger = "scheduled" | "manual";
export type FxActorKind = "user" | "cron" | "system";

/** Keys allowed into `fx_import_runs.diagnostics`. Anything else is dropped. */
export const FX_DIAGNOSTIC_ALLOWED_KEYS = [
  "anchor",
  "supported_count",
  "unsupported_codes",
  "quote_currencies",
  "skipped_reasons",
  "large_moves",
  "attempted_pairs",
  "provider_status",
] as const;

const SECRET_HINT = /(secret|token|authorization|apikey|api_key|signature|password|bearer)/i;

/** Drop secrets, cap size, and keep only allow-listed diagnostic keys. */
export function sanitizeDiagnostics(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const key of FX_DIAGNOSTIC_ALLOWED_KEYS) {
    if (!(key in (input as Record<string, unknown>))) continue;
    if (SECRET_HINT.test(key)) continue;
    const value = (input as Record<string, unknown>)[key];
    if (value == null) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = boundedText(value);
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, FX_DIAGNOSTIC_MAX_ITEMS).map((v) =>
        typeof v === "object" && v !== null
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>)
                .filter(([k]) => !SECRET_HINT.test(k))
                .slice(0, 8)
                .map(([k, val]) => [k, typeof val === "string" ? boundedText(val) : val]),
            )
          : typeof v === "string"
            ? boundedText(v, 64)
            : v,
      );
    }
  }
  return out;
}

/** Normalize any thrown value into a bounded `{ code, message }` pair. */
export function toStructuredError(err: unknown): { code: string; message: string } {
  const e = err as { code?: unknown; message?: unknown };
  const rawCode = typeof e?.code === "string" && e.code.length <= 64 ? e.code : "unknown_error";
  const message = boundedText(e?.message ?? "Unexpected error") ?? "Unexpected error";
  return { code: rawCode.replace(SECRET_HINT, "redacted"), message };
}

export interface FxRunOpenInput {
  companyId: string | null;
  provider: string;
  trigger: FxRunTrigger;
  actorKind: FxActorKind;
  triggeredBy: string | null;
  baseCurrency: string | null;
  requestedCurrencies?: readonly string[];
}

export interface FxRunCompleteInput {
  status: Exclude<FxRunStatus, "running">;
  observationDate?: string | null;
  baseCurrency?: string | null;
  requestedCurrencies?: readonly string[];
  requestedCount?: number;
  importedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  missingCodes?: readonly string[];
  errorCode?: string | null;
  errorMessage?: string | null;
  diagnostics?: unknown;
  durationMs: number;
}

/** Insert the `running` row. Returns null when the log itself is unavailable. */
export async function openFxRun(admin: Admin, input: FxRunOpenInput): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("fx_import_runs")
      .insert({
        company_id: input.companyId,
        provider: input.provider,
        trigger: input.trigger,
        status: "running",
        started_at: new Date().toISOString(),
        actor_kind: input.actorKind,
        triggered_by: input.triggeredBy,
        base_currency: input.baseCurrency,
        requested_currencies: (input.requestedCurrencies ?? []).slice(0, 500),
      } as never)
      .select("id")
      .single();
    if (error) {
      console.warn(
        JSON.stringify({ scope: "fx.audit", event: "open_failed", error: error.message }),
      );
      return null;
    }
    return ((data as { id?: string } | null)?.id as string | undefined) ?? null;
  } catch (err) {
    console.warn(
      JSON.stringify({ scope: "fx.audit", event: "open_threw", ...toStructuredError(err) }),
    );
    return null;
  }
}

/**
 * Complete a run. Never throws: a failure to record must not mask the
 * underlying import outcome. When the opening insert failed we still attempt a
 * standalone terminal row so the attempt is not lost.
 */
export async function completeFxRun(
  admin: Admin,
  runId: string | null,
  open: FxRunOpenInput,
  input: FxRunCompleteInput,
): Promise<string | null> {
  const patch = {
    status: input.status,
    observation_date: input.observationDate ?? null,
    base_currency: input.baseCurrency ?? open.baseCurrency ?? null,
    requested_currencies: (input.requestedCurrencies ?? open.requestedCurrencies ?? []).slice(
      0,
      500,
    ),
    requested_count: input.requestedCount ?? 0,
    imported_count: input.importedCount ?? 0,
    skipped_count: input.skippedCount ?? 0,
    failed_count: input.failedCount ?? 0,
    missing_codes: (input.missingCodes ?? []).slice(0, FX_DIAGNOSTIC_MAX_ITEMS),
    error_code: input.errorCode ?? null,
    error_summary: boundedText(input.errorMessage),
    diagnostics: sanitizeDiagnostics(input.diagnostics),
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    finished_at: new Date().toISOString(),
  };

  try {
    if (runId) {
      const { error } = await admin
        .from("fx_import_runs")
        .update(patch as never)
        .eq("id", runId);
      if (!error) return runId;
      console.warn(
        JSON.stringify({ scope: "fx.audit", event: "complete_failed", error: error.message }),
      );
    }
    const { data } = await admin
      .from("fx_import_runs")
      .insert({
        company_id: open.companyId,
        provider: open.provider,
        trigger: open.trigger,
        actor_kind: open.actorKind,
        triggered_by: open.triggeredBy,
        started_at: new Date(Date.now() - Math.max(0, input.durationMs)).toISOString(),
        ...patch,
      } as never)
      .select("id")
      .single();
    return ((data as { id?: string } | null)?.id as string | undefined) ?? null;
  } catch (err) {
    console.warn(
      JSON.stringify({ scope: "fx.audit", event: "complete_threw", ...toStructuredError(err) }),
    );
    return runId;
  }
}
