// P-177 — Pure ingestion reliability helpers: retry backoff + dead-letter rule.
// No React / Supabase imports so the schedule can be unit-tested directly.

/** Backoff ladder applied on the Nth failed attempt (1-indexed). */
export const RETRY_BACKOFF_SECONDS = [60, 300, 1800, 7200, 86400] as const;

export const MAX_RETRY_ATTEMPTS = 5;
export const RETRY_BATCH_SIZE = 50;
export const RETRY_INSERT_CHUNK = 500;

export type IngestionPayloadKind = "telemetry" | "events";

/** Seconds to wait before the next attempt, given the new attempt count. */
export function backoffSeconds(attempts: number): number {
  if (attempts <= 0) return RETRY_BACKOFF_SECONDS[0];
  const idx = Math.min(attempts, RETRY_BACKOFF_SECONDS.length) - 1;
  return RETRY_BACKOFF_SECONDS[idx];
}

/** ISO timestamp for the next retry, from a base instant. */
export function nextRetryAt(attempts: number, from: Date = new Date()): string {
  return new Date(from.getTime() + backoffSeconds(attempts) * 1000).toISOString();
}

/** A row is dead once its attempts reach its own max_attempts. */
export function shouldDeadLetter(attempts: number, maxAttempts: number): boolean {
  return attempts >= Math.max(1, maxAttempts);
}

export interface RetryOutcome {
  /** New attempt counter after this failure. */
  attempts: number;
  dead: boolean;
  /** Only set when the row stays in the queue. */
  next_retry_at: string | null;
}

/** Deterministic decision for a failed retry attempt. */
export function planRetryFailure(
  currentAttempts: number,
  maxAttempts: number,
  now: Date = new Date(),
): RetryOutcome {
  const attempts = currentAttempts + 1;
  const dead = shouldDeadLetter(attempts, maxAttempts);
  return { attempts, dead, next_retry_at: dead ? null : nextRetryAt(attempts, now) };
}

/** Postgres "undefined table" — the reliability migration is not applied yet. */
export function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

export function chunkRows<T>(rows: readonly T[], size = RETRY_INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size) as T[]);
  return out;
}
