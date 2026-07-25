// P-121 signature helpers — thin, testable wrappers around the guard's
// HMAC primitives. Used by outbound webhook signers (P-125) and unit tests.
import { hmacSha256Hex, timingSafeEqual } from './guard';

export const REPLAY_WINDOW_SECONDS = 300;

/** Produce the canonical `sha256=<hex>` signature header value. */
export async function signPayload(
  secret: string,
  timestamp: string | number,
  rawBody: string,
): Promise<string> {
  const hex = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return `sha256=${hex}`;
}

export type VerifyReason =
  | 'signature_expired'
  | 'signature_invalid'
  | 'signature_malformed';

export interface VerifyArgs {
  secret: string;
  timestamp: string | number;
  rawBody: string;
  header: string | null | undefined;
  /** Override "now" (seconds since epoch). Defaults to Date.now(). */
  nowSec?: number;
  /** Replay window in seconds. Default 300. Inclusive on both sides. */
  windowSec?: number;
}

export async function verifySignature(
  args: VerifyArgs,
): Promise<{ ok: true } | { ok: false; reason: VerifyReason }> {
  const window = args.windowSec ?? REPLAY_WINDOW_SECONDS;
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'signature_malformed' };
  if (Math.abs(now - ts) > window) return { ok: false, reason: 'signature_expired' };

  const raw = (args.header ?? '').trim();
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(raw);
  if (!match) return { ok: false, reason: 'signature_malformed' };
  const provided = match[1].toLowerCase();

  const expected = await hmacSha256Hex(args.secret, `${args.timestamp}.${args.rawBody}`);
  // Differing-length must not throw and must compare unequal.
  if (provided.length !== expected.length) return { ok: false, reason: 'signature_invalid' };
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'signature_invalid' };
  return { ok: true };
}
