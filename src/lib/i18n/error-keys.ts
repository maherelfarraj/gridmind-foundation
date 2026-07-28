// P-241 — typed server error codes → translation keys. The server returns a
// stable machine code; the client renders the localized message with an English
// fallback when the code is unknown.
export const ERROR_KEY_MAP: Record<string, string> = {
  period_closed: "financeMod.errors.period_closed",
  finance_period_closed: "financeMod.errors.finance_period_closed",
  payment_release_blocked: "financeMod.errors.payment_release_blocked",
  gps_outside_geofence: "financeMod.errors.gps_outside_geofence",
  approval_instance_open: "financeMod.errors.approval_instance_open",
};

export const UNKNOWN_ERROR_KEY = "financeMod.errors.unknown";

/** Maps a typed error code to its catalog key, or the unknown-error key. */
export function errorKeyFor(code: string | null | undefined): string {
  if (!code) return UNKNOWN_ERROR_KEY;
  return ERROR_KEY_MAP[code] ?? UNKNOWN_ERROR_KEY;
}

/**
 * Resolves a typed error to a localized message.
 * Falls back to the raw server message (English) when the code is unmapped.
 */
export function translateError(
  t: (key: string) => string,
  code: string | null | undefined,
  fallbackMessage?: string | null,
): string {
  if (code && ERROR_KEY_MAP[code]) return t(ERROR_KEY_MAP[code]);
  return fallbackMessage?.trim() || t(UNKNOWN_ERROR_KEY);
}

/** Pulls a typed code out of an unknown thrown value. */
export function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { code?: unknown; message?: unknown };
  if (typeof anyErr.code === "string") return anyErr.code;
  if (typeof anyErr.message === "string" && ERROR_KEY_MAP[anyErr.message]) return anyErr.message;
  return null;
}
