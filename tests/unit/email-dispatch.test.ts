// P-269 — dispatcher unit tests.
import { describe, expect, it, vi } from "vitest";

import { sendEventEmail, notify } from "@/lib/email/dispatch.server";
import {
  EMAIL_EVENTS,
  TEMPLATE_ENV_KEYS,
  buildTemplateParams,
  emailjsCredentials,
  isEventConfigured,
  pickLocale,
  resolveTemplateId,
} from "@/lib/email/registry";

const FULL_ENV = {
  EMAILJS_SERVICE_ID: "service_x",
  EMAILJS_PUBLIC_KEY: "pub_x",
  EMAILJS_PRIVATE_KEY: "priv_x",
  EMAILJS_TEMPLATE_CLIENT_INVITE: "template_ci",
  EMAILJS_TEMPLATE_ID: "template_report",
};

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

describe("registry", () => {
  it("maps every event to a distinct secret name", () => {
    const keys = EMAIL_EVENTS.map((e) => TEMPLATE_ENV_KEYS[e]);
    expect(keys).toHaveLength(EMAIL_EVENTS.length);
    expect(new Set(keys).size).toBe(EMAIL_EVENTS.length);
    expect(keys.every((k) => k.startsWith("EMAILJS_TEMPLATE"))).toBe(true);
  });

  it("resolves template ids from env only", () => {
    expect(resolveTemplateId("client_invite", FULL_ENV)).toBe("template_ci");
    expect(resolveTemplateId("transmittal", FULL_ENV)).toBeNull();
    expect(resolveTemplateId("client_invite", { EMAILJS_TEMPLATE_CLIENT_INVITE: "  " })).toBeNull();
  });

  it("requires all three credentials", () => {
    expect(emailjsCredentials(FULL_ENV)).not.toBeNull();
    expect(emailjsCredentials({ ...FULL_ENV, EMAILJS_PRIVATE_KEY: undefined })).toBeNull();
  });

  it("reports per-event configuration", () => {
    expect(isEventConfigured("client_invite", FULL_ENV)).toBe(true);
    expect(isEventConfigured("payment", FULL_ENV)).toBe(false);
  });

  it("picks recipient locale and bilingual params", () => {
    expect(pickLocale("ar")).toBe("ar");
    expect(pickLocale("ar-JO")).toBe("ar");
    expect(pickLocale(null)).toBe("en");
    const p = buildTemplateParams({ event: "payment", to: "a@b.c", locale: "ar-JO" });
    expect(p.dir).toBe("rtl");
    expect(p.subject).toBe(p.subject_ar);
    expect(p.subject_en).toBeTruthy();
    expect(p.to_email).toBe("a@b.c");
  });
});

describe("sendEventEmail", () => {
  it("sends and audits email.sent", async () => {
    const sb = fakeSupabase();
    const fetchImpl = vi.fn(async () => new Response("OK", { status: 200 }));
    const out = await sendEventEmail({
      event: "client_invite",
      to: "maher@next.jo",
      companyId: "c1",
      entity: "invites",
      entityId: "i1",
      env: FULL_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      supabase: sb,
    });
    expect(out.status).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.template_id).toBe("template_ci");
    expect(body.service_id).toBe("service_x");
    const audit = (sb as unknown as { rows: Record<string, unknown>[] }).rows[0];
    expect(audit.action).toBe("email.sent");
    expect((audit.metadata as Record<string, unknown>).event_type).toBe("client_invite");
    expect((audit.metadata as Record<string, unknown>).recipient).toBe("maher@next.jo");
  });

  it("degrades gracefully when secrets are missing", async () => {
    const sb = fakeSupabase();
    const fetchImpl = vi.fn();
    const out = await sendEventEmail({
      event: "transmittal",
      to: "x@y.z",
      companyId: "c1",
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      supabase: sb,
    });
    expect(out).toMatchObject({ status: "skipped", reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((sb as unknown as { rows: Record<string, unknown>[] }).rows[0].action).toBe(
      "email.skipped",
    );
  });

  it("records failures without throwing (non-blocking)", async () => {
    const sb = fakeSupabase();
    const out = await sendEventEmail({
      event: "client_invite",
      to: "x@y.z",
      companyId: "c1",
      env: FULL_ENV,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      supabase: sb,
    });
    expect(out).toMatchObject({ status: "failed", error: "network down" });
    expect((sb as unknown as { rows: Record<string, unknown>[] }).rows[0].action).toBe(
      "email.failed",
    );
  });

  it("surfaces non-2xx as failed", async () => {
    const out = await sendEventEmail({
      event: "client_invite",
      to: "x@y.z",
      env: FULL_ENV,
      fetchImpl: (async () =>
        new Response("bad template", { status: 400 })) as unknown as typeof fetch,
    });
    expect(out.status).toBe("failed");
  });

  it("skips empty recipients", async () => {
    const out = await sendEventEmail({ event: "payment", to: "  ", env: FULL_ENV });
    expect(out).toMatchObject({ status: "skipped", reason: "no_recipient" });
  });

  it("notify() never rejects", async () => {
    await expect(
      notify({
        event: "payment",
        to: "x@y.z",
        env: FULL_ENV,
        fetchImpl: (() => {
          throw new Error("boom");
        }) as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();
  });
});
