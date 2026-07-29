// P-269 / P-270 — Outbound notification registry (pure, client-safe).
//
// DOCTRINE
//   - One email stack: every notification renders a React Email template
//     registered in `src/lib/email-templates/registry.ts` and ships through
//     Lovable's managed sender on notify.gridmindepc.com. No third-party
//     provider keys, no per-event template ids in secrets.
//   - Templates are bilingual. The recipient's profile locale (P-242) picks
//     the primary language; every label carries an EN and an AR string so a
//     single component renders both directions (LTR / RTL).
//   - This module is pure: no process.env reads, no I/O. Unit-testable and
//     safe to import from anywhere.

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

/** Event type → registered template name (src/lib/email-templates/registry.ts). */
export const EVENT_TEMPLATES: Record<EmailEvent, string> = {
  client_invite: "client-invite",
  sub_invite: "sub-invite",
  transmittal: "transmittal",
  claim_submitted: "claim-submitted",
  claim_certified: "claim-certified",
  payment: "payment",
  compliance_expiry: "compliance-expiry",
  scheduled_report: "scheduled-report",
};

export type EmailLocale = "en" | "ar";

/** Normalises a profile locale string (P-242) to a supported email locale. */
export function pickLocale(locale?: string | null): EmailLocale {
  return typeof locale === "string" && locale.toLowerCase().startsWith("ar") ? "ar" : "en";
}

/** Bilingual subject / heading pairs shipped with every send. */
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

/** Short bilingual intro sentence per event. */
export const EVENT_INTROS: Record<EmailEvent, { en: string; ar: string }> = {
  client_invite: {
    en: "You have been invited to join a GridMind workspace. Use the button below to accept the invitation.",
    ar: "تمت دعوتك للانضمام إلى مساحة عمل GridMind. استخدم الزر أدناه لقبول الدعوة.",
  },
  sub_invite: {
    en: "You have been invited to the subcontractor portal. Accept the invitation to submit claims and documents.",
    ar: "تمت دعوتك إلى بوابة مقاولي الباطن. اقبل الدعوة لتقديم المطالبات والمستندات.",
  },
  transmittal: {
    en: "A document transmittal has been issued to you.",
    ar: "تم إصدار إحالة مستندات إليك.",
  },
  claim_submitted: {
    en: "A subcontract claim has been submitted and is now under review.",
    ar: "تم تقديم مطالبة عقد باطن وهي الآن قيد المراجعة.",
  },
  claim_certified: {
    en: "A subcontract claim has been certified for payment.",
    ar: "تم اعتماد مطالبة عقد الباطن للدفع.",
  },
  payment: {
    en: "A payment has been recorded against your invoice.",
    ar: "تم تسجيل دفعة على فاتورتك.",
  },
  compliance_expiry: {
    en: "A compliance document is approaching its expiry date. Please upload a renewal.",
    ar: "وثيقة امتثال تقترب من تاريخ انتهائها. يرجى رفع نسخة مجددة.",
  },
  scheduled_report: {
    en: "Your scheduled report summary is ready.",
    ar: "ملخص تقريرك المجدول جاهز.",
  },
};

/** Bilingual labels for every field a template may render. */
export const FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  role: { en: "Role", ar: "الدور" },
  expires_at: { en: "Expires", ar: "تنتهي الصلاحية" },
  transmittal_number: { en: "Transmittal no.", ar: "رقم الإحالة" },
  subject: { en: "Subject", ar: "الموضوع" },
  from_party: { en: "From", ar: "من" },
  to_party: { en: "To", ar: "إلى" },
  response_due: { en: "Response due", ar: "موعد الرد" },
  item_count: { en: "Items", ar: "عدد البنود" },
  claim_number: { en: "Claim no.", ar: "رقم المطالبة" },
  subcontract_number: { en: "Subcontract no.", ar: "رقم عقد الباطن" },
  net_payable: { en: "Net payable", ar: "صافي المستحق" },
  currency: { en: "Currency", ar: "العملة" },
  invoice_number: { en: "Invoice no.", ar: "رقم الفاتورة" },
  amount: { en: "Amount", ar: "المبلغ" },
  payment_date: { en: "Payment date", ar: "تاريخ الدفع" },
  balance_after: { en: "Balance after", ar: "الرصيد بعد الدفع" },
  method: { en: "Method", ar: "طريقة الدفع" },
  doc_type: { en: "Document type", ar: "نوع المستند" },
  title: { en: "Title", ar: "العنوان" },
  expiry_date: { en: "Expiry date", ar: "تاريخ الانتهاء" },
  report_name: { en: "Report", ar: "التقرير" },
  period: { en: "Period", ar: "الفترة" },
  sections: { en: "Sections", ar: "الأقسام" },
  project_name: { en: "Project", ar: "المشروع" },
  generated_at: { en: "Generated", ar: "تاريخ الإنشاء" },
};

/** Bilingual call-to-action label per event (only used when a URL is present). */
export const CTA_LABELS: Record<string, { en: string; ar: string }> = {
  client_invite: { en: "Accept invitation", ar: "قبول الدعوة" },
  sub_invite: { en: "Open the portal", ar: "فتح البوابة" },
  default: { en: "Open GridMind", ar: "فتح GridMind" },
};

export interface NotificationField {
  key: string;
  label_en: string;
  label_ar: string;
  value: string;
}

/** Props handed to every notification template component. */
export interface NotificationTemplateProps {
  event: EmailEvent;
  lang: EmailLocale;
  dir: "ltr" | "rtl";
  to_email: string;
  company_name: string;
  heading_en: string;
  heading_ar: string;
  intro_en: string;
  intro_ar: string;
  fields: NotificationField[];
  cta_url?: string;
  cta_en?: string;
  cta_ar?: string;
}

export interface TemplateParamInput {
  event: EmailEvent;
  to: string;
  locale?: string | null;
  companyName?: string | null;
  /** Event-specific fields rendered as the detail table. */
  params?: Record<string, unknown>;
  /** Absolute origin used to expand relative CTA paths. */
  baseUrl?: string | null;
}

function toAbsolute(url: string, baseUrl?: string | null): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (baseUrl ?? "").replace(/\/+$/, "");
  return base ? `${base}${url.startsWith("/") ? "" : "/"}${url}` : url;
}

/**
 * Builds the props for a notification template. Every template receives the
 * same envelope (locale, direction, bilingual heading/intro, company) plus its
 * event-specific fields, so one component renders EN and AR correctly.
 */
export function buildTemplateParams(input: TemplateParamInput): NotificationTemplateProps {
  const lang = pickLocale(input.locale);
  const labels = EVENT_LABELS[input.event];
  const intros = EVENT_INTROS[input.event];
  const raw = { ...(input.params ?? {}) } as Record<string, unknown>;

  const ctaRaw = raw.accept_url ?? raw.cta_url ?? raw.link_url;
  delete raw.accept_url;
  delete raw.cta_url;
  delete raw.link_url;

  const fields: NotificationField[] = Object.entries(raw)
    .filter(([, v]) => v !== null && v !== undefined && `${v}`.trim() !== "")
    .map(([key, value]) => ({
      key,
      label_en: FIELD_LABELS[key]?.en ?? key.replace(/_/g, " "),
      label_ar: FIELD_LABELS[key]?.ar ?? key.replace(/_/g, " "),
      value: Array.isArray(value) ? value.join(", ") : String(value),
    }));

  const cta = CTA_LABELS[input.event] ?? CTA_LABELS.default;

  return {
    event: input.event,
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    to_email: input.to,
    company_name: input.companyName ?? "GridMind EPC",
    heading_en: labels.en,
    heading_ar: labels.ar,
    intro_en: intros.en,
    intro_ar: intros.ar,
    fields,
    ...(typeof ctaRaw === "string" && ctaRaw.trim()
      ? { cta_url: toAbsolute(ctaRaw.trim(), input.baseUrl), cta_en: cta.en, cta_ar: cta.ar }
      : {}),
  };
}
