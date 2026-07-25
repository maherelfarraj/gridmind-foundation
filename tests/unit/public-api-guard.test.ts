// P-130 — Public-API pure helpers: HMAC signPayload / verifySignature and
// IP source / allowlist. Fully offline, no Supabase, no network.
import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature, REPLAY_WINDOW_SECONDS } from '@/lib/public-api/signature';
import { sourceIpFromRequest, isIpAllowed } from '@/lib/public-api/ip';

const SECRET = 'shhh-do-not-tell';
const BODY = '{"telemetry":[{"asset":"INV-01","p_kw":1234}]}';

describe('signPayload', () => {
  it('produces sha256=<hex> of `${timestamp}.${rawBody}`', async () => {
    const sig = await signPayload(SECRET, 1_700_000_000, BODY);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('is deterministic for identical (secret, ts, body)', async () => {
    const a = await signPayload(SECRET, '1700000000', BODY);
    const b = await signPayload(SECRET, '1700000000', BODY);
    expect(a).toBe(b);
  });

  it('changes when body changes', async () => {
    const a = await signPayload(SECRET, 1_700_000_000, BODY);
    const b = await signPayload(SECRET, 1_700_000_000, BODY + ' ');
    expect(a).not.toBe(b);
  });
});

describe('verifySignature', () => {
  const nowSec = 1_700_000_000;

  async function makeHeader(ts: number | string, body = BODY, secret = SECRET) {
    return signPayload(secret, ts, body);
  }

  it('accepts a correct signature', async () => {
    const header = await makeHeader(nowSec);
    const res = await verifySignature({ secret: SECRET, timestamp: nowSec, rawBody: BODY, header, nowSec });
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered body (signature_invalid)', async () => {
    const header = await makeHeader(nowSec);
    const res = await verifySignature({
      secret: SECRET, timestamp: nowSec, rawBody: BODY + 'x', header, nowSec,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });

  it('rejects the wrong secret (signature_invalid)', async () => {
    const header = await makeHeader(nowSec, BODY, 'other-secret');
    const res = await verifySignature({
      secret: SECRET, timestamp: nowSec, rawBody: BODY, header, nowSec,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });

  it('rejects a malformed header (signature_malformed)', async () => {
    for (const bad of ['', 'not-a-sig', 'md5=abc', 'sha256=', 'sha256=ZZZ']) {
      const res = await verifySignature({
        secret: SECRET, timestamp: nowSec, rawBody: BODY, header: bad, nowSec,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('signature_malformed');
    }
  });

  it('differing-length hex compares unequal WITHOUT throwing (signature_invalid)', async () => {
    // 32 hex chars (16 bytes) instead of the 64 hex chars sha256 produces.
    const shortHeader = 'sha256=' + 'ab'.repeat(16);
    const res = await verifySignature({
      secret: SECRET, timestamp: nowSec, rawBody: BODY, header: shortHeader, nowSec,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });

  it('accepts EXACTLY ±300s at the boundary (both sides inclusive)', async () => {
    for (const delta of [-REPLAY_WINDOW_SECONDS, REPLAY_WINDOW_SECONDS]) {
      const ts = nowSec + delta;
      const header = await makeHeader(ts);
      const res = await verifySignature({
        secret: SECRET, timestamp: ts, rawBody: BODY, header, nowSec,
      });
      expect(res.ok, `delta=${delta} should be accepted`).toBe(true);
    }
  });

  it('rejects 301s beyond the window on BOTH sides (signature_expired)', async () => {
    for (const delta of [-(REPLAY_WINDOW_SECONDS + 1), REPLAY_WINDOW_SECONDS + 1]) {
      const ts = nowSec + delta;
      const header = await makeHeader(ts);
      const res = await verifySignature({
        secret: SECRET, timestamp: ts, rawBody: BODY, header, nowSec,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe('signature_expired');
    }
  });

  it('rejects a non-numeric timestamp (signature_malformed)', async () => {
    const header = await signPayload(SECRET, 'not-a-number', BODY);
    const res = await verifySignature({
      secret: SECRET, timestamp: 'not-a-number', rawBody: BODY, header, nowSec,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_malformed');
  });
});

describe('sourceIpFromRequest', () => {
  it('reads ONLY cf-connecting-ip', () => {
    const req = new Request('https://x.test/', {
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(sourceIpFromRequest(req)).toBe('203.0.113.9');
  });

  it('IGNORES client-supplied x-forwarded-for even when cf-connecting-ip is absent', () => {
    const req = new Request('https://x.test/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(sourceIpFromRequest(req)).toBeNull();
  });

  it('IGNORES x-forwarded-for even when cf-connecting-ip disagrees', () => {
    const req = new Request('https://x.test/', {
      headers: {
        'cf-connecting-ip': '203.0.113.9',
        'x-forwarded-for': '9.9.9.9',
      },
    });
    // Never returns anything derived from XFF.
    expect(sourceIpFromRequest(req)).toBe('203.0.113.9');
  });

  it('returns null when cf-connecting-ip is absent', () => {
    const req = new Request('https://x.test/');
    expect(sourceIpFromRequest(req)).toBeNull();
  });
});

describe('isIpAllowed', () => {
  it('matches an exact IPv4', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
    expect(isIpAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
  });

  it('matches a /24 CIDR', () => {
    expect(isIpAllowed('10.0.0.1', ['10.0.0.0/24'])).toBe(true);
    expect(isIpAllowed('10.0.0.255', ['10.0.0.0/24'])).toBe(true);
    expect(isIpAllowed('10.0.1.1', ['10.0.0.0/24'])).toBe(false);
  });

  it('matches a /32 CIDR as exact host', () => {
    expect(isIpAllowed('192.0.2.7', ['192.0.2.7/32'])).toBe(true);
    expect(isIpAllowed('192.0.2.8', ['192.0.2.7/32'])).toBe(false);
  });

  it('rejects out-of-range CIDR entries', () => {
    // /33 is invalid — that entry is skipped, no allow.
    expect(isIpAllowed('10.0.0.1', ['10.0.0.0/33'])).toBe(false);
  });

  it('rejects malformed entries without throwing', () => {
    expect(() => isIpAllowed('1.2.3.4', ['not-an-ip', '1.2.3.4/abc', '999.0.0.0/24'])).not.toThrow();
    expect(isIpAllowed('1.2.3.4', ['not-an-ip', '1.2.3.4/abc', '999.0.0.0/24'])).toBe(false);
  });

  it('null/empty allowlist means "no restriction" (allow)', () => {
    expect(isIpAllowed('1.2.3.4', null)).toBe(true);
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('null client IP against a non-empty allowlist is denied', () => {
    expect(isIpAllowed(null, ['1.2.3.4'])).toBe(false);
  });
});
