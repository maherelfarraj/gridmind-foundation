// P-269 — EmailJS dispatcher (server-only).
//
// DOCTRINE (approved constraints)
//   1. Email is a SIDE EFFECT, never a blocker. `sendEventEmail` never throws;
//      it returns a typed outcome. Business operations complete regardless.
//   2. Every attempt is audited: `email.sent` / `email.failed` / `email.skipped`
//      rows carrying event type, recipient, template key and timestamp.
//   3. Template ids come from the registry (secret lookup), never hardcoded.
//   4. Missing secrets → `skipped: not_configured`, i.e. in-app only. Identical
//      behaviour to the pre-dispatcher world.
//   5. Recipient locale (profiles.locale, P-242) selects the language column;
//      the template also receives both EN/AR strings for bilingual bodies.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildTemplateParams,
  emailjsCredentials,
  resolveTemplateId,
  TEMPLATE_ENV_KEYS,
  type EmailEvent,
  type EnvLike,
} from "./registry";

const EMAILJS_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

export type EmailOutcome =
  | { status: "sent"; event: EmailEvent; to: string }
  | { status: "skipped"; event: EmailEvent; to: string; reason: "not_configured" | "no_recipient" }
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
  /** Test seams — production callers omit both. */
  env?: EnvLike;
  fetchImpl?: typeof fetch;
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
        template_key: TEMPLATE_ENV_KEYS[input.event],
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

  const creds = emailjsCredentials(env);
  const templateId = resolveTemplateId(input.event, env);
  if (!creds || !templateId) {
    const outcome: EmailOutcome = {
      status: "skipped",
      event: input.event,
      to,
      reason: "not_configured",
    };
    await auditEmail(input.supabase, input, outcome);
    return outcome;
  }

  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(EMAILJS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: creds.serviceId,
        template_id: templateId,
        user_id: creds.publicKey,
        accessToken: creds.privateKey,
        template_params: buildTemplateParams({
          event: input.event,
          to,
          locale: input.locale,
          companyName: input.companyName,
          params: input.params,
        }),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const outcome: EmailOutcome = {
        status: "failed",
        event: input.event,
        to,
        error: `HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      };
      await auditEmail(input.supabase, input, outcome);
      return outcome;
    }
    const outcome: EmailOutcome = { status: "sent", event: input.event, to };
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
