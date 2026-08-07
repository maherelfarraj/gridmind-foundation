// FX-01 — Frankfurter adapter. Server-only: never imported by client code.
//
// The provider is open-source, key-less, and sources official/central-bank
// rates. Only the allowlisted host below may be called; the base URL is
// configurable for staging mirrors but the host is validated at construction.
import {
  FX_IMPORT_SOURCE,
  FxProviderError,
  frankfurterCurrenciesSchema,
  parseFrankfurterLatest,
  type FxProviderObservation,
  type FxRateProvider,
} from "@/lib/fx/provider";

export const FRANKFURTER_ALLOWED_HOST = "api.frankfurter.dev";
/** v2 is not published yet; v1 is the live, documented surface. */
export const FRANKFURTER_DEFAULT_BASE_URL = "https://api.frankfurter.dev/v1";

export interface FrankfurterOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function assertAllowedFxUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new FxProviderError("invalid_response", `Invalid FX provider URL: ${baseUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new FxProviderError("invalid_response", "FX provider URL must use HTTPS");
  }
  if (url.hostname !== FRANKFURTER_ALLOWED_HOST) {
    throw new FxProviderError(
      "invalid_response",
      `FX provider host not allowlisted: ${url.hostname}`,
    );
  }
  return url;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FrankfurterProvider implements FxRateProvider {
  readonly name = FX_IMPORT_SOURCE;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: FrankfurterOptions = {}) {
    const base = opts.baseUrl ?? FRANKFURTER_DEFAULT_BASE_URL;
    assertAllowedFxUrl(base);
    this.baseUrl = base.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.maxAttempts = Math.min(Math.max(opts.maxAttempts ?? 3, 1), 5);
    this.backoffMs = opts.backoffMs ?? 400;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async getJson(path: string): Promise<unknown> {
    let lastError: FxProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) {
          lastError = new FxProviderError("http", `Provider responded ${res.status}`, {
            status: res.status,
          });
          // 4xx (other than 429) will not succeed on retry.
          if (res.status < 500 && res.status !== 429) throw lastError;
        } else {
          return (await res.json()) as unknown;
        }
      } catch (err) {
        if (err instanceof FxProviderError) {
          if (err.code === "http" && (err.detail as { status?: number })?.status !== undefined) {
            const status = (err.detail as { status: number }).status;
            if (status < 500 && status !== 429) throw err;
          }
          lastError = err;
        } else if ((err as { name?: string })?.name === "AbortError") {
          lastError = new FxProviderError("timeout", `Provider timed out after ${this.timeoutMs}ms`);
        } else {
          lastError = new FxProviderError(
            "network",
            (err as Error)?.message ?? "Provider request failed",
          );
        }
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.maxAttempts) await this.sleep(this.backoffMs * 2 ** (attempt - 1));
    }
    throw lastError ?? new FxProviderError("network", "Provider request failed");
  }

  async supportedCurrencies(): Promise<string[]> {
    const json = await this.getJson("/currencies");
    const parsed = frankfurterCurrenciesSchema.safeParse(json);
    if (!parsed.success) {
      throw new FxProviderError("invalid_response", "Provider currency list failed validation");
    }
    return Object.keys(parsed.data).map((c) => c.toUpperCase()).sort();
  }

  async latest(anchor: string, symbols: string[]): Promise<FxProviderObservation> {
    const a = anchor.toUpperCase();
    const list = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter((s) => s !== a);
    if (list.length === 0) {
      // Nothing to fetch; still ask for the anchor's own date via a cheap call.
      const json = await this.getJson(`/latest?base=${a}`);
      return parseFrankfurterLatest(json, this.name);
    }
    const json = await this.getJson(`/latest?base=${a}&symbols=${list.join(",")}`);
    return parseFrankfurterLatest(json, this.name);
  }
}
