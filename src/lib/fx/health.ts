// FX-02 — Pure feed-health evaluation + alert de-duplication decisions.
//
// Isomorphic and side-effect free so both the server (cron/alerting) and the
// admin UI derive health from exactly the same rules. Staleness reuses the
// business-day helpers from the FX-01 provider module — weekends and
// provider non-publication days are never treated as failures.
import { assessFreshness, type FxFreshness } from "@/lib/fx/provider";

export type FxHealthStatus = "healthy" | "degraded" | "failed" | "never_synced";

/** Bounded cap for any free-text diagnostic we persist. */
export const FX_DIAGNOSTIC_MAX_CHARS = 500;
/** Bounded cap for a persisted list of codes (currencies, pairs, …). */
export const FX_DIAGNOSTIC_MAX_ITEMS = 50;

export interface FxHealthInput {
  /** ISO date of the newest successful provider observation, if any. */
  lastObservationDate: string | null;
  /** Status of the most recent attempt (any trigger), if any. */
  lastAttemptStatus: "running" | "success" | "failed" | "skipped" | null;
  /** Consecutive failed attempts since the last success. */
  consecutiveFailures: number;
  /** Currencies GridMind needs but the feed did not cover. */
  missingCurrencies: readonly string[];
  /** Today, ISO `YYYY-MM-DD`, in the schedule timezone. */
  today: string;
  /** Business-day staleness threshold. */
  stalenessBusinessDays: number;
  /** Consecutive failures required before the feed is declared Failed. */
  failureThreshold: number;
  /** Whether missing required currencies should degrade health. */
  alertMissingCurrency: boolean;
}

export interface FxHealthAssessment {
  status: FxHealthStatus;
  freshness: FxFreshness;
  /** Machine-readable reasons, sorted and de-duplicated. */
  reasons: string[];
  missingCurrencies: string[];
}

/**
 * Derive feed health from the latest successful run, the latest attempt,
 * required-currency coverage, and business-day staleness.
 */
export function evaluateFxHealth(input: FxHealthInput): FxHealthAssessment {
  const freshness = assessFreshness(
    input.lastObservationDate,
    input.today,
    input.stalenessBusinessDays,
  );
  const missingCurrencies = Array.from(new Set(input.missingCurrencies.map((c) => c.toUpperCase())))
    .sort()
    .slice(0, FX_DIAGNOSTIC_MAX_ITEMS);

  const reasons: string[] = [];

  if (!input.lastObservationDate) {
    if (input.consecutiveFailures >= Math.max(1, input.failureThreshold)) {
      return {
        status: "failed",
        freshness,
        reasons: ["consecutive_failures"],
        missingCurrencies,
      };
    }
    return { status: "never_synced", freshness, reasons: ["no_successful_run"], missingCurrencies };
  }

  if (input.consecutiveFailures >= Math.max(1, input.failureThreshold)) {
    return { status: "failed", freshness, reasons: ["consecutive_failures"], missingCurrencies };
  }

  if (input.lastAttemptStatus === "failed") reasons.push("last_attempt_failed");
  if (freshness.stale && !freshness.nonPublicationDay) reasons.push("stale_observation");
  if (input.alertMissingCurrency && missingCurrencies.length > 0) {
    reasons.push("missing_currencies");
  }

  return {
    status: reasons.length > 0 ? "degraded" : "healthy",
    freshness,
    reasons: Array.from(new Set(reasons)).sort(),
    missingCurrencies,
  };
}

export interface FxAlertDecisionInput {
  status: FxHealthStatus;
  /** Status the organization was last notified about, if any. */
  lastNotifiedStatus: FxHealthStatus | null;
  alertsEnabled: boolean;
}

export type FxAlertKind = "degraded" | "failed" | "recovered";

export interface FxAlertDecision {
  notify: boolean;
  kind: FxAlertKind | null;
  reason: "disabled" | "unchanged" | "transition" | "no_alertable_state";
}

/**
 * Notify only on a *transition*. Re-running the cron or reloading the admin
 * page while health is unchanged never emits another notification; a return
 * to Healthy from an alerted state emits exactly one recovery notice.
 */
export function decideFxAlert(input: FxAlertDecisionInput): FxAlertDecision {
  if (!input.alertsEnabled) return { notify: false, kind: null, reason: "disabled" };
  if (input.status === input.lastNotifiedStatus) {
    return { notify: false, kind: null, reason: "unchanged" };
  }

  if (input.status === "failed") return { notify: true, kind: "failed", reason: "transition" };
  if (input.status === "degraded") return { notify: true, kind: "degraded", reason: "transition" };

  // healthy / never_synced
  const wasAlerted =
    input.lastNotifiedStatus === "failed" || input.lastNotifiedStatus === "degraded";
  if (input.status === "healthy" && wasAlerted) {
    return { notify: true, kind: "recovered", reason: "transition" };
  }
  return { notify: false, kind: null, reason: "no_alertable_state" };
}

/** Percentage move between two rates; null when the previous rate is unusable. */
export function ratePctChange(previous: number, next: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous <= 0) return null;
  return Math.abs((next - previous) / previous) * 100;
}

export interface FxLargeMove {
  base_code: string;
  quote_code: string;
  previous: number;
  next: number;
  pct: number;
}

/** Pairs whose rate moved more than `thresholdPct` versus the prior value. */
export function detectLargeMoves(
  pairs: ReadonlyArray<{ base_code: string; quote_code: string; previous: number; next: number }>,
  thresholdPct: number | null,
): FxLargeMove[] {
  if (thresholdPct == null || !(thresholdPct > 0)) return [];
  const out: FxLargeMove[] = [];
  for (const p of pairs) {
    const pct = ratePctChange(p.previous, p.next);
    if (pct != null && pct > thresholdPct) {
      out.push({ ...p, pct: Math.round(pct * 1000) / 1000 });
    }
  }
  return out.sort((a, b) => b.pct - a.pct).slice(0, FX_DIAGNOSTIC_MAX_ITEMS);
}

/** Next scheduled run as an ISO instant, given `HH:MM` in a fixed-offset zone. */
export function nextScheduledRun(
  scheduleTime: string,
  utcOffsetMinutes: number,
  now: Date = new Date(),
): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(scheduleTime);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const nowMs = now.getTime();
  const dayMs = 86_400_000;
  // Midnight (UTC) of the local day that currently contains `now`.
  const localNow = nowMs + utcOffsetMinutes * 60_000;
  const localMidnight = Math.floor(localNow / dayMs) * dayMs;
  let target = localMidnight + hh * 3_600_000 + mm * 60_000 - utcOffsetMinutes * 60_000;
  if (target <= nowMs) target += dayMs;
  return new Date(target).toISOString();
}

/** Trim free text to a bounded, secret-free diagnostic string. */
export function boundedText(value: unknown, max = FX_DIAGNOSTIC_MAX_CHARS): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
