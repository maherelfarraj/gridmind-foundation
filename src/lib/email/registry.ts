// P-269 — Outbound notification email registry (pure, client-safe).
//
// DOCTRINE
//   - Template IDs are NEVER hardcoded. Every event type maps to a secret
//     name; the value is read from the server environment at send time.
//   - Missing secrets are not an error: the dispatcher degrades to in-app
//     only (`emailjs_configured: false`), exactly as before this module.
//   - Templates are bilingual. We pass BOTH `lang` (recipient locale, when
//     known) and EN/AR label pairs so a single EmailJS template can render
//     the right column without a second template per language.
//
// This module is pure: no process.env reads, no I/O. It is unit-testable and
// safe to import from anywhere.

export const EMAIL_EVENTS = [
  "client_invite",
  "sub_invite",
  "transmittal",
  "claim_submitted",
  "claim_certified",
  "payment",
  "compliance_expiry",
  "scheduled_report",
] as const;

export type EmailEvent = (typeof EMAIL_EVENTS)[number];

/** Event type → secret name holding the EmailJS template id. */
export const TEMPLATE_ENV_KEYS: Record<EmailEvent, string> = {
  client_invite: "EMAILJS_TEMPLATE_CLIENT_INVITE",
  sub_invite: "EMAILJS_TEMPLATE_SUB_INVITE",
  transmittal: "EMAILJS_TEMPLATE_TRANSMITTAL",
  claim_submitted: "EMAILJS_TEMPLATE_CLAIM_SUBMITTED",
  claim_certified: "EMAILJS_TEMPLATE_CLAIM_CERTIFIED",
  payment: "EMAILJS_TEMPLATE_PAYMENT",
  compliance_expiry: "EMAILJS_TEMPLATE_COMPLIANCE_EXPIRY",
  // The P-117 scheduled-report path keeps its original secret name so an
  // already-configured deployment does not regress.
  scheduled_report: "EMAILJS_TEMPLATE_ID",
};

export type EmailLocale = "en" | "ar";

export interface EmailJsCredentials {
  serviceId: string;
  publicKey: string;
  privateKey: string;
}

export type EnvLike = Record<string, string | undefined>;

/** Account-level EmailJS credentials, or null when not configured. */
export function emailjsCredentials(env: EnvLike): EmailJsCredentials | null {
  const serviceId = env.EMAILJS_SERVICE_ID;
  const publicKey = env.EMAILJS_PUBLIC_KEY;
  const privateKey = env.EMAILJS_PRIVATE_KEY;
  if (!serviceId || !publicKey || !privateKey) return null;
  return { serviceId, publicKey, privateKey };
}

/** Template id for an event, or null when that template is not configured. */
export function resolveTemplateId(event: EmailEvent, env: EnvLike): string | null {
  const key = TEMPLATE_ENV_KEYS[event];
  const value = env[key];
  return value && value.trim() ? value.trim() : null;
}

/** True only when credentials AND this event's template are both present. */
export function isEventConfigured(event: EmailEvent, env: EnvLike): boolean {
  return !!emailjsCredentials(env) && !!resolveTemplateId(event, env);
}

/** Normalises a profile locale string (P-242) to a supported email locale. */
export function pickLocale(locale?: string | null): EmailLocale {
  return typeof locale === "string" && locale.toLowerCase().startsWith("ar") ? "ar" : "en";
}

/** Bilingual subject/heading pairs shipped with every send. */
export const EVENT_LABELS: Record<EmailEvent, { en: string; ar: string }> = {
  client_invite: { en: "You have been invited to GridMind", ar: "تمت دعوتك إلى GridMind" },
  sub_invite: {
    en: "Subcontractor portal invitation",
    ar: "دعوة إلى بوابة مقاولي الباطن",
  },
  transmittal: { en: "Document transmittal issued", ar: "تم إصدار إحالة مستندات" },
  claim_submitted: { en: "Claim submitted for review", ar: "تم تقديم مطالبة للمراجعة" },
  claim_certified: { en: "Claim certified", ar: "تم اعتماد المطالبة" },
  payment: { en: "Payment recorded", ar: "تم تسجيل دفعة" },
  compliance_expiry: { en: "Compliance document expiring", ar: "وثيقة امتثال على وشك الانتهاء" },
  scheduled_report: { en: "Scheduled report", ar: "تقرير مجدول" },
};

export interface TemplateParamInput {
  event: EmailEvent;
  to: string;
  locale?: string | null;
  companyName?: string | null;
  /** Event-specific fields forwarded verbatim to the EmailJS template. */
  params?: Record<string, unknown>;
}

/**
 * Builds the EmailJS `template_params` payload. Every template receives the
 * same envelope keys (`to_email`, `lang`, `dir`, `subject_en`, `subject_ar`,
 * `company_name`) plus its event-specific fields.
 */
export function buildTemplateParams(input: TemplateParamInput): Record<string, unknown> {
  const lang = pickLocale(input.locale);
  const labels = EVENT_LABELS[input.event];
  return {
    to_email: input.to,
    event_type: input.event,
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    subject_en: labels.en,
    subject_ar: labels.ar,
    subject: lang === "ar" ? labels.ar : labels.en,
    company_name: input.companyName ?? "GridMind EPC",
    ...(input.params ?? {}),
  };
}
