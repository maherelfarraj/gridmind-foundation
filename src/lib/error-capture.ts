// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// h3's HTTPError serializes to {"status":500,"unhandled":true,"message":"HTTPError"} —
// no stack, no cause — so a plain console.error(error) reaches the log pipeline with
// the failure detail stripped. Expand Error-like args into a string that keeps the
// message, stack, and the full cause chain.
const CAUSE_DEPTH_LIMIT = 5;
const DESCRIPTION_LENGTH_LIMIT = 8_000;

export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT && current != null; depth++) {
    if (!(current instanceof Error)) {
      parts.push(typeof current === "string" ? current : safeStringify(current));
      break;
    }
    const label = depth === 0 ? "" : "caused by: ";
    const status = describeStatus(current);
    parts.push(`${label}${current.stack ?? `${current.name}: ${current.message}`}${status}`);
    current = current.cause;
  }
  return parts.join("\n").slice(0, DESCRIPTION_LENGTH_LIMIT);
}

function describeStatus(error: Error): string {
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = status ?? statusCode;
  return typeof value === "number" ? ` (status ${value})` : "";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isErrorLike(value: unknown): value is Error {
  return value instanceof Error;
}

// Wrap console.error so errors logged by any layer — including h3's internal
// unhandled-error logging, which this file cannot hook directly — are both
// recorded for consumeLastCapturedError and expanded before serialization.
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const expanded = args.map((arg) => {
    if (!isErrorLike(arg)) return arg;
    record(arg);
    return describeError(arg);
  });
  originalConsoleError(...expanded);
};

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

export type CapturedError = {
  message: string;
  stack?: string;
  statusCode?: number;
  cause?: string;
  route?: string;
  path?: string;
  requestId?: string;
  userHash?: string | null;
};

export type CaptureContext = {
  /** Request URL pathname — logged as `route`. */
  path?: string;
  route?: string;
  /** Inbound x-request-id, or minted here when absent. */
  requestId?: string;
  /** Authenticated user id — never logged raw; hashed to a 12-char digest. */
  userId?: string | null;
};

function generateErrorRef(): string {
  try {
    const uuid = crypto.randomUUID().replace(/-/g, "");
    return `err_${uuid.slice(0, 8)}`;
  } catch {
    return `err_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function mintRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
}

/** sha256(userId).slice(0,12) — one-way, non-reversible tag safe to log. */
async function hashUserId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const enc = new TextEncoder().encode(userId);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): {
  message: string;
  stack?: string;
  statusCode?: number;
  cause?: string;
} {
  if (error instanceof Error) {
    const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
    const code =
      typeof statusCode === "number" ? statusCode : typeof status === "number" ? status : undefined;
    const causeStr = error.cause != null ? describeError(error.cause) : undefined;
    return {
      message: error.message || error.name || "Error",
      stack: error.stack,
      statusCode: code,
      cause: causeStr,
    };
  }
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const obj = error as { message?: unknown; statusCode?: unknown; status?: unknown };
    const message = typeof obj.message === "string" ? obj.message : safeStringify(error);
    const code =
      typeof obj.statusCode === "number"
        ? obj.statusCode
        : typeof obj.status === "number"
          ? obj.status
          : undefined;
    return { message, statusCode: code };
  }
  return { message: String(error ?? "Unknown error") };
}

function sanitizeRoute(path?: string): string | undefined {
  if (!path) return path;
  // Never log the raw invite token; strip query entirely on the accept-invite route.
  if (path.startsWith("/accept-invite")) {
    return "/accept-invite";
  }
  return path;
}

export type CaptureResult = { errorRef: string; requestId: string; captured: CapturedError };

export function captureError(error: unknown, context: CaptureContext = {}): CaptureResult {
  const errorRef = generateErrorRef();
  const requestId = context.requestId ?? mintRequestId();
  const normalized = normalizeError(error);
  const route = sanitizeRoute(context.route ?? context.path);

  // Async hash — do not block error response; log the enriched line when ready.
  const hashPromise = hashUserId(context.userId ?? null);

  const captured: CapturedError = {
    message: normalized.message,
    stack: normalized.stack,
    statusCode: normalized.statusCode,
    cause: normalized.cause,
    route,
    requestId,
  };

  hashPromise.then((userHash) => {
    captured.userHash = userHash;
    originalConsoleError(
      JSON.stringify({
        level: "error",
        errorRef,
        requestId,
        route,
        userHash,
        statusCode: captured.statusCode,
        message: captured.message,
      }),
    );
  });

  return { errorRef, requestId, captured };
}
