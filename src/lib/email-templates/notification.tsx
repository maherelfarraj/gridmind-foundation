// P-270 — Bilingual notification email templates (EN / AR, RTL-aware).
//
// One component renders every notification: the envelope (heading, intro,
// detail table, optional CTA) comes from `src/lib/email/registry.ts`, so the
// EN and AR bodies always stay in lockstep and the variable contract matches
// the original dispatcher designs.
import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import {
  EMAIL_EVENTS,
  EVENT_INTROS,
  EVENT_LABELS,
  buildTemplateParams,
  type EmailEvent,
  type NotificationTemplateProps,
} from "@/lib/email/registry";

import type { TemplateEntry } from "./registry";

const BRAND = "#33506F";
const INK = "#1B2733";
const MUTED = "#5B6B7B";
const LINE = "#E2E8F0";

const main: React.CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily: "Helvetica, Arial, sans-serif",
  color: INK,
};
const container: React.CSSProperties = {
  padding: "28px 28px 40px",
  maxWidth: "600px",
  margin: "0 auto",
};
const brandBar: React.CSSProperties = {
  backgroundColor: BRAND,
  color: "#ffffff",
  padding: "14px 20px",
  borderRadius: "6px",
  fontSize: "13px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
const h1: React.CSSProperties = { fontSize: "20px", margin: "26px 0 8px", color: INK };
const p: React.CSSProperties = { fontSize: "14px", lineHeight: "22px", color: INK, margin: "0 0 8px" };
const secondary: React.CSSProperties = { ...p, color: MUTED };
const rowLabel: React.CSSProperties = {
  fontSize: "12px",
  color: MUTED,
  margin: "0",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const rowValue: React.CSSProperties = { fontSize: "14px", color: INK, margin: "2px 0 12px" };
const button: React.CSSProperties = {
  backgroundColor: BRAND,
  color: "#ffffff",
  padding: "11px 22px",
  borderRadius: "6px",
  fontSize: "14px",
  textDecoration: "none",
  display: "inline-block",
};
const footer: React.CSSProperties = { fontSize: "12px", color: MUTED, lineHeight: "18px" };

/** Renders the bilingual notification body. Primary language first. */
export function NotificationEmail(props: Partial<NotificationTemplateProps>) {
  const lang = props.lang === "ar" ? "ar" : "en";
  const dir = lang === "ar" ? "rtl" : "ltr";
  const headingPrimary = lang === "ar" ? props.heading_ar : props.heading_en;
  const headingSecondary = lang === "ar" ? props.heading_en : props.heading_ar;
  const introPrimary = lang === "ar" ? props.intro_ar : props.intro_en;
  const introSecondary = lang === "ar" ? props.intro_en : props.intro_ar;
  const ctaPrimary = lang === "ar" ? props.cta_ar : props.cta_en;
  const fields = props.fields ?? [];
  const company = props.company_name ?? "GridMind EPC";

  return (
    <Html lang={lang} dir={dir}>
      <Head />
      <Preview>{headingPrimary ?? company}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandBar}>{company}</Section>

          <Heading style={{ ...h1, textAlign: dir === "rtl" ? "right" : "left" }}>
            {headingPrimary}
          </Heading>
          <Text style={{ ...p, textAlign: dir === "rtl" ? "right" : "left" }}>{introPrimary}</Text>

          {fields.length > 0 && (
            <Section style={{ marginTop: "18px" }}>
              {fields.map((f) => (
                <Section key={f.key} style={{ textAlign: dir === "rtl" ? "right" : "left" }}>
                  <Text style={rowLabel}>{lang === "ar" ? f.label_ar : f.label_en}</Text>
                  <Text style={rowValue}>{f.value}</Text>
                </Section>
              ))}
            </Section>
          )}

          {props.cta_url && (
            <Section style={{ margin: "22px 0", textAlign: dir === "rtl" ? "right" : "left" }}>
              <Button href={props.cta_url} style={button}>
                {ctaPrimary}
              </Button>
            </Section>
          )}

          <Hr style={{ borderColor: LINE, margin: "28px 0 16px" }} />

          {/* Secondary language block — the same message in the other language. */}
          <Text
            style={{ ...secondary, textAlign: dir === "rtl" ? "left" : "right" }}
            dir={dir === "rtl" ? "ltr" : "rtl"}
          >
            <strong>{headingSecondary}</strong>
            <br />
            {introSecondary}
          </Text>

          <Hr style={{ borderColor: LINE, margin: "16px 0" }} />
          <Text style={footer}>
            {company} · GridMind EPC operations platform
            <br />
            This is an automated notification. / هذا إشعار آلي.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function previewFor(event: EmailEvent): NotificationTemplateProps {
  return buildTemplateParams({
    event,
    to: "maher@next.jo",
    locale: "en",
    companyName: "GridMind EPC",
    params:
      event === "client_invite" || event === "sub_invite"
        ? { role: "company_admin", accept_url: "https://gridmind-sparkle.lovable.app/accept-invite" }
        : { subject: "Sample notification", title: "Sample" },
  });
}

function makeTemplate(event: EmailEvent): TemplateEntry {
  return {
    component: NotificationEmail,
    subject: (data: Record<string, unknown>) => {
      const lang = data?.lang === "ar" ? "ar" : "en";
      return `${EVENT_LABELS[event][lang]} · ${data?.company_name ?? "GridMind EPC"}`;
    },
    displayName: `${EVENT_LABELS[event].en} (${event})`,
    previewData: previewFor(event),
  };
}

/** event → TemplateEntry, consumed by the transactional template registry. */
export const NOTIFICATION_TEMPLATES = Object.fromEntries(
  EMAIL_EVENTS.map((event) => [event, makeTemplate(event)]),
) as Record<EmailEvent, TemplateEntry>;

export { EVENT_INTROS };
