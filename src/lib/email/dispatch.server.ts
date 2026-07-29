// P-269 / P-270 — Notification dispatcher (server-only).
//
// DOCTRINE (approved constraints)
//   1. Email is a SIDE EFFECT, never a blocker. `sendEventEmail` never throws;
//      it returns a typed outcome. Business operations complete regardless.
//   2. Every attempt is audited: `email.sent` / `email.failed` / `email.skipped`
//      rows carrying event type, recipient, template name and timestamp.
//   3. Templates live in the native registry (`src/lib/email-templates`) and
//      ship through Lovable's managed sender on notify.gridmindepc.com.
//      No third-party provider keys.
//   4. Missing platform config (no LOVABLE_API_KEY) → `skipped: not_configured`,
//      i.e. in-app only. Identical behaviour to the pre-dispatcher world.
//   5. Recipient locale (profiles.locale, P-242) selects the primary language;
//      the template renders both EN and AR with the right direction.

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendTemplateEmail } from "@/lib/email-templates/send-email";

import { EVENT_TEMPLATES, buildTemplateParams, type EmailEvent } from "./registry";

export type EnvLike = Record<string, string | undefined>;

export type EmailOutcome =
  | { status: "sent"; event: EmailEvent; to: string }
  | {
      status: "skipped";
      event: EmailEvent;
      to: string;
      reason: "not_configured" | "no_recipient" | "recipient_suppressed";
    }
  | { status: "failed"; event: EmailEvent; to: string; error: string };

export interface SendEventEmailInput {
  event: EmailEvent;
  to: string | null | undefined;
  companyId?: string | null;
  entity?: string;
  entityId?: string | null;
  actorId?: string | null;
  locale?: string | null;
  companyName?: string | null;
  params?: Record<string, unknown>;
  /** Dedupe key for retries of the same logical send. */
  idempotencyKey?: string;
  /** Test seams — production callers omit these. */
  env?: EnvLike;
  sendImpl?: typeof sendTemplateEmail;
  supabase?: SupabaseClient | null;
}

/** Best-effort audit write. Advisory only — a failed audit never surfaces. */
async function auditEmail(
  supabase: SupabaseClient | null | undefined,
  input: SendEventEmailInput,
  outcome: EmailOutcome,
): Promise<void> {
  if (!supabase || !input.companyId) return;
  const action =
    outcome.status === "sent"
      ? "email.sent"
      : outcome.status === "failed"
        ? "email.failed"
        : "email.skipped";
  try {
    await supabase.from("audit_logs").insert({
      company_id: input.companyId,
      actor_id: input.actorId ?? null,
      action,
      entity: input.entity ?? "notifications",
      entity_id: input.entityId ?? null,
      metadata: {
        event_type: input.event,
        recipient: outcome.to,
        template_key: EVENT_TEMPLATES[input.event],
        sent_at: new Date().toISOString(),
        ...(outcome.status === "failed" ? { error: outcome.error } : {}),
        ...(outcome.status === "skipped" ? { reason: outcome.reason } : {}),
      },
    } as never);
  } catch {
    /* advisory */
  }
}

/**
 * Sends one templated notification. Resolves an outcome; never rejects.
 */
export async function sendEventEmail(input: SendEventEmailInput): Promise<EmailOutcome> {
  const env: EnvLike = input.env ?? (process.env as EnvLike);
  const to = (input.to ?? "").trim();

  if (!to) {
    const outcome: EmailOutcome = {
      status: "skipped",
      event: input.event,
      to: "",
      reason: "no_recipient",
    };
    await auditEmail(input.supabase, input, outcome);
    return outcome;
  }

  if (!env.LOVABLE_API_KEY) {
    const outcome: EmailOutcome = {
      status: "skipped",
      event: input.event,
      to,
      reason: "not_configured",
    };
    await auditEmail(input.supabase, input, outcome);
    return outcome;
  }

  const send = input.sendImpl ?? sendTemplateEmail;
  try {
    const result = await send(EVENT_TEMPLATES[input.event], to, {
      templateData: buildTemplateParams({
        event: input.event,
        to,
        locale: input.locale,
        companyName: input.companyName,
        params: input.params,
        baseUrl: env.APP_BASE_URL ?? env.VITE_APP_BASE_URL ?? "https://gridmindepc.com",
      }) as unknown as Record<string, unknown>,
      idempotencyKey:
        input.idempotencyKey ??
        (input.entityId ? `${input.event}-${input.entityId}-${to}` : undefined),
    });
    const outcome: EmailOutcome =
      result.sent === false
        ? { status: "skipped", event: input.event, to, reason: "recipient_suppressed" }
        : { status: "sent", event: input.event, to };
    await auditEmail(input.supabase, input, outcome);
    return outcome;
  } catch (e) {
    const outcome: EmailOutcome = {
      status: "failed",
      event: input.event,
      to,
      error: e instanceof Error ? e.message : String(e),
    };
    await auditEmail(input.supabase, input, outcome);
    return outcome;
  }
}

/**
 * Call-site helper: fire a notification without ever affecting the caller.
 * Swallows even programmer errors so a business mutation cannot fail on email.
 */
export async function notify(input: SendEventEmailInput): Promise<void> {
  try {
    await sendEventEmail(input);
  } catch {
    /* email is a side effect, never a blocker */
  }
}

/** Looks up the recipient's UI locale (P-242) by email. Never throws. */
export async function recipientLocale(
  supabase: SupabaseClient | null | undefined,
  email: string,
): Promise<string | null> {
  if (!supabase || !email) return null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("locale")
      .eq("email", email)
      .maybeSingle<{ locale: string | null }>();
    return data?.locale ?? null;
  } catch {
    return null;
  }
}

/** Vendor / subcontractor contact email. Never throws. */
export async function vendorEmail(
  supabase: SupabaseClient | null | undefined,
  vendorId: string | null | undefined,
): Promise<string | null> {
  if (!supabase || !vendorId) return null;
  try {
    const { data } = await supabase
      .from("vendors")
      .select("email")
      .eq("id", vendorId)
      .maybeSingle<{ email: string | null }>();
    return data?.email ?? null;
  } catch {
    return null;
  }
}
