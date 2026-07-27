// Day 4 close-out — shared extraction of typed server-function error messages.
// Server guards (hold points, GPS geofence, period locks) throw typed errors
// with operator-facing messages; the UI must surface those, never a generic
// "something failed" toast.

/** Extracts the server's typed message, falling back to a caller-supplied default. */
export function typedErrorMessage(error: unknown, fallback: string): string {
  const message = rawMessage(error);
  if (!message) return fallback;
  const trimmed = message.trim();
  if (!trimmed || trimmed === "[object Object]" || trimmed === "[object Response]") {
    return fallback;
  }
  return trimmed;
}

function rawMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; body?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.error === "string") return candidate.error;
    if (candidate.body && typeof candidate.body === "object") {
      const body = candidate.body as { message?: unknown };
      if (typeof body.message === "string") return body.message;
    }
  }
  return null;
}
