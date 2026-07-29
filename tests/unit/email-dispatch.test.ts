// P-269 / P-270 — dispatcher unit tests (native email stack).
import { describe, expect, it, vi } from "vitest";

import { sendEventEmail, notify } from "@/lib/email/dispatch.server";
import {
  EMAIL_EVENTS,
  EVENT_LABELS,
  EVENT_TEMPLATES,
  buildTemplateParams,
  pickLocale,
} from "@/lib/email/registry";
import { TEMPLATES } from "@/lib/email-templates/registry";

const ENV = { LOVABLE_API_KEY: "lk_test" };

function fakeSupabase() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    from() {
      return {
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as never;
}

const okSend = () => vi.fn(async () => ({ sent: true }) as const);

describe("registry", () => {
  it("maps every event to a registered template", () => {
    for (const event of EMAIL_EVENTS) {
      const name = EVENT_TEMPLATES[event];
      expect(name).toBeTruthy();
      expect(TEMPLATES[name]).toBeDefined();
    }
    expect(new Set(Object.values(EVENT_TEMPLATES)).size).toBe(EMAIL_EVENTS.length);
  });

  it("carries bilingual labels for every event", () => {
    for (const event of EMAIL_EVENTS) {
      expect(EVENT_LABELS[event].en).toBeTruthy();
      expect(EVENT_LABELS[event].ar).toBeTruthy();
    }
  });

  it("picks recipient locale and builds RTL props", () => {
    expect(pickLocale("ar")).toBe("ar");
    expect(pickLocale("ar-JO")).toBe("ar");
    expect(pickLocale(null)).toBe("en");
    const p = buildTemplateParams({ event: "payment", to: "a@b.c", locale: "ar-JO" });
    expect(p.dir).toBe("rtl");
    expect(p.lang).toBe("ar");
    expect(p.heading_ar).toBeTruthy();
    expect(p.heading_en).toBeTruthy();
    expect(p.to_email).toBe("a@b.c");
  });

  it("maps params to bilingual labelled fields and absolutises the CTA", () => {
    const p = buildTemplateParams({
      event: "client_invite",
      to: "a@b.c",
      params: { role: "company_admin", accept_url: "/accept-invite?token=x" },
      baseUrl: "https://gridmindepc.com",
    });
    expect(p.cta_url).toBe("https://gridmindepc.com/accept-invite?token=x");
    expect(p.fields).toEqual([
      { key: "role", label_en: "Role", label_ar: "الدور", value: "company_admin" },
    ]);
  });
});

describe("sendEventEmail", () => {
  it("sends and audits email.sent", async () => {
    const sb = fakeSupabase();
    const send = okSend();
    const out = await sendEventEmail({
      event: "client_invite",
      to: "maher@next.jo",
      companyId: "c1",
      entity: "invites",
      entityId: "i1",
      env: ENV,
      sendImpl: send as never,
      supabase: sb,
    });
    expect(out.status).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("client-invite");
    const audit = (sb as unknown as { rows: Record<string, unknown>[] }).rows[0];
    expect(audit.action).toBe("email.sent");
    expect((audit.metadata as Record<string, unknown>).event_type).toBe("client_invite");
    expect((audit.metadata as Record<string, unknown>).recipient).toBe("maher@next.jo");
  });

  it("degrades gracefully when the platform key is missing", async () => {
    const sb = fakeSupabase();
    const send = okSend();
    const out = await sendEventEmail({
      event: "transmittal",
      to: "x@y.z",
      companyId: "c1",
      env: {},
      sendImpl: send as never,
      supabase: sb,
    });
    expect(out).toMatchObject({ status: "skipped", reason: "not_configured" });
    expect(send).not.toHaveBeenCalled();
    expect((sb as unknown as { rows: Record<string, unknown>[] }).rows[0].action).toBe(
      "email.skipped",
    );
  });

  it("treats a suppressed recipient as skipped, not failed", async () => {
    const out = await sendEventEmail({
      event: "payment",
      to: "x@y.z",
      env: ENV,
      sendImpl: (async () => ({ sent: false, reason: "recipient_suppressed" })) as never,
    });
    expect(out).toMatchObject({ status: "skipped", reason: "recipient_suppressed" });
  });

  it("records failures without throwing (non-blocking)", async () => {
    const sb = fakeSupabase();
    const out = await sendEventEmail({
      event: "client_invite",
      to: "x@y.z",
      companyId: "c1",
      env: ENV,
      sendImpl: (async () => {
        throw new Error("network down");
      }) as never,
      supabase: sb,
    });
    expect(out).toMatchObject({ status: "failed", error: "network down" });
    expect((sb as unknown as { rows: Record<string, unknown>[] }).rows[0].action).toBe(
      "email.failed",
    );
  });

  it("skips empty recipients", async () => {
    const out = await sendEventEmail({ event: "payment", to: "  ", env: ENV });
    expect(out).toMatchObject({ status: "skipped", reason: "no_recipient" });
  });

  it("notify() never rejects", async () => {
    await expect(
      notify({
        event: "payment",
        to: "x@y.z",
        env: ENV,
        sendImpl: (() => {
          throw new Error("boom");
        }) as never,
      }),
    ).resolves.toBeUndefined();
  });
});
