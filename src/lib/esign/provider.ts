// P-049 — E-signature provider adapter.
//
// The manual adapter is the default and enables a "dev-mode" flow where a
// sales user simulates status transitions from the UI. Real providers (e.g.
// DocuSign, HelloSign) plug in later without any schema change — the shape
// below is stable.
//
// Env:
//   ESIGN_PROVIDER   — 'manual' (default) | provider name
//   ESIGN_API_KEY    — required for real providers
//   ESIGN_WEBHOOK_SECRET — verified in src/routes/api/webhooks/esign.ts
//
// Never import service-role secrets here — provider adapters run inside
// createServerFn handlers that already carry a scoped Supabase client.

export type EsignEvent = "sent" | "viewed" | "completed" | "declined" | "voided";

export interface EsignSendInput {
  proposalId: string;
  companyId: string;
  version: number;
  signerName: string;
  signerEmail: string;
  /** Storage path (in the `documents` bucket) where the unsigned PDF lives. */
  envelopePdfStoragePath: string;
}

export interface EsignSendResult {
  envelopeId: string;
  status: Extract<EsignEvent, "sent">;
}

export interface EsignRefreshResult {
  status: EsignEvent;
}

export interface EsignFetchSignedPdfInput {
  envelopeId: string;
  /** Fallback path in the `documents` bucket — used by the manual provider. */
  envelopePdfStoragePath: string | null;
}

export interface EsignFetchSignedPdfResult {
  /** Raw signed-PDF bytes. */
  bytes: Uint8Array;
  contentType: string;
}

export interface EsignProvider {
  readonly name: string;
  readonly isDevMode: boolean;
  send(input: EsignSendInput): Promise<EsignSendResult>;
  refresh(envelopeId: string): Promise<EsignRefreshResult>;
  void(envelopeId: string, reason?: string): Promise<void>;
  fetchSignedPdf(
    input: EsignFetchSignedPdfInput,
    /** Supabase client (may be service-role for privileged storage reads). */
    supabase: any,
  ): Promise<EsignFetchSignedPdfResult>;
}

// ---------------------------------------------------------------------------
// Manual (dev-mode) provider
// ---------------------------------------------------------------------------

const manualProvider: EsignProvider = {
  name: "manual",
  isDevMode: true,
  async send({ proposalId }) {
    const rand = Math.random().toString(36).slice(2, 10);
    return {
      envelopeId: `manual_${proposalId.slice(0, 8)}_${rand}`,
      status: "sent",
    };
  },
  async refresh() {
    // Manual provider is externally driven — refresh alone never advances state.
    // Status changes come from the "Simulate" server function or the webhook route.
    return { status: "sent" };
  },
  async void() {
    /* no-op — envelope state lives on the proposal row */
  },
  async fetchSignedPdf({ envelopePdfStoragePath }, supabase) {
    if (!envelopePdfStoragePath) {
      throw new Error("manual provider: no envelope PDF to sign");
    }
    // Manual "signed" copy = the unsigned envelope. Sufficient for dev; real
    // providers overwrite this with an actually-signed PDF.
    const { data, error } = await supabase.storage
      .from("documents")
      .download(envelopePdfStoragePath);
    if (error || !data) {
      throw new Error(error?.message ?? "manual: envelope PDF not found");
    }
    const buffer = await (data as Blob).arrayBuffer();
    return { bytes: new Uint8Array(buffer), contentType: "application/pdf" };
  },
};

// ---------------------------------------------------------------------------
// Selector — server-only
// ---------------------------------------------------------------------------

export interface ResolvedEsignProvider {
  provider: EsignProvider;
  providerName: string;
}

export function getEsignProvider(): ResolvedEsignProvider | null {
  const name = (typeof process !== "undefined" && process.env?.ESIGN_PROVIDER) || "manual";
  if (name === "manual") {
    return { provider: manualProvider, providerName: "manual" };
  }
  // Real provider slots go here. Until an adapter exists, treat unknown
  // provider names as "not configured" so the UI renders its empty state.
  const key = process.env?.ESIGN_API_KEY;
  if (!key) return null;
  return null;
}

export function isEsignConfigured(): boolean {
  return getEsignProvider() !== null;
}

// ---------------------------------------------------------------------------
// P-126 — Inbound webhook verification (provider-specific)
// ---------------------------------------------------------------------------

import { timingSafeEqual, hmacSha256Hex } from "@/lib/public-api/guard";

export type WebhookVerifyResult =
  | { ok: true; providerName: string }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "signature_missing"
        | "signature_expired"
        | "signature_mismatch"
        | "manual_token_mismatch";
      providerName: string;
    };

const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

/**
 * Verify an inbound e-signature webhook. Provider-specific recipes:
 *   - "manual" (dev):   header `x-manual-token` == ESIGN_WEBHOOK_SECRET
 *   - default (docusign-style connect): header
 *       `x-esign-signature: sha256=<hex>` = HMAC-SHA256(rawBody, secret)
 *       and `x-esign-timestamp: <unix>` within ±300s.
 */
export async function verifyWebhook(
  request: Request,
  rawBody: string,
): Promise<WebhookVerifyResult> {
  const secret = process.env.ESIGN_WEBHOOK_SECRET;
  const providerName = (typeof process !== "undefined" && process.env?.ESIGN_PROVIDER) || "manual";
  if (!secret) return { ok: false, reason: "not_configured", providerName };

  if (providerName === "manual") {
    const token = request.headers.get("x-manual-token") ?? "";
    if (token.length === secret.length && timingSafeEqual(token, secret)) {
      return { ok: true, providerName };
    }
    return { ok: false, reason: "manual_token_mismatch", providerName };
  }

  const sigHeader = request.headers.get("x-esign-signature") ?? "";
  const tsHeader = request.headers.get("x-esign-timestamp") ?? "";
  if (!sigHeader || !tsHeader) {
    return { ok: false, reason: "signature_missing", providerName };
  }
  const ts = Number(tsHeader);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > WEBHOOK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "signature_expired", providerName };
  }
  const provided = sigHeader.toLowerCase().replace(/^sha256=/, "");
  const expected = await hmacSha256Hex(secret, rawBody);
  if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
    return { ok: true, providerName };
  }
  return { ok: false, reason: "signature_mismatch", providerName };
}
