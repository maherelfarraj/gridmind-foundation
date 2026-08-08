// GC-17 — live UI alert lifecycle verification.
//
// Renders the real shared <AlertRegister/> against a real tenant and drives
// every lifecycle transition through the rendered controls with user-event.
// Each click runs the real `decideAlert` server path as the signed-in user
// (RLS enforced), then the assertions read the persisted rows back. Service
// role is fixture setup/teardown only and never appears in an assertion.
// Self-skips when the dev server or service-role env are down.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { isDevServerUp } from "../helpers/dev-server";
import { purgeFixtureTenants } from "../helpers/fixture-teardown";
import { envReady, login, service } from "./helpers/rpc";
import { AlertRegister, type AlertRegisterRow } from "@/components/risk-contingency/alert-register";
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { createI18n, type Locale } from "@/lib/i18n";
import { decideAlert, resolveRcAccess } from "@/lib/risk-contingency.server";
import { alertDedupeKey, snoozeUntil } from "@/lib/risk-sim.rules";

const canRun = (await isDevServerUp()) && envReady();
const NOW = new Date("2026-03-01T00:00:00.000Z");

describe.skipIf(!canRun)("GC-17 live UI — alert lifecycle end to end", () => {
  const svc = envReady() ? service() : (null as never);
  const suffix = crypto.randomUUID().slice(0, 8);
  const writerEmail = `gc17-ui-w-${suffix}@gm-e2e.local`;
  const readerEmail = `gc17-ui-r-${suffix}@gm-e2e.local`;
  const password = `Pw!${crypto.randomUUID()}`;

  const state: { companyId?: string; projectId?: string; writerId?: string } = {};
  let writerCtx: AuthContext;
  let readerCtx: AuthContext;

  async function seedAlert(family: string, over: Record<string, unknown> = {}): Promise<string> {
    const subject = crypto.randomUUID();
    const { data, error } = await svc
      .from("risk_contingency_alerts")
      .insert({
        company_id: state.companyId!,
        project_id: state.projectId!,
        family,
        severity: "warning",
        status: "open",
        dedupe_key: alertDedupeKey(family as never, state.projectId!, subject),
        title: `GC-17 ${family} ${suffix}`,
        detail: "Seeded for live UI lifecycle verification.",
        ...over,
      } as never)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("alert insert failed");
    return (data as { id: string }).id;
  }

  /** Reads the row exactly as a loader would, through the signed-in client. */
  async function fetchRow(ctx: AuthContext, id: string): Promise<AlertRegisterRow> {
    const { data, error } = await ctx.supabase
      .from("risk_contingency_alerts")
      .select(
        "id, project_id, family, severity, status, title, detail, owner_id, due_date, snoozed_until, row_version",
      )
      .eq("id", id)
      .single();
    if (error || !data) throw error ?? new Error("alert not visible");
    return data as unknown as AlertRegisterRow;
  }

  async function persisted(id: string) {
    const { data } = await svc
      .from("risk_contingency_alerts")
      .select("status, severity, snoozed_until, row_version, acknowledged_by, resolved_at")
      .eq("id", id)
      .single();
    return data as unknown as {
      status: string;
      severity: string;
      snoozed_until: string | null;
      row_version: number;
      acknowledged_by: string | null;
      resolved_at: string | null;
    };
  }

  /**
   * Renders the register for one alert and clicks a rendered action. The click
   * handler awaits the real server path, so a resolved promise means the write
   * (or its rejection) already happened.
   */
  async function clickAction(
    ctx: AuthContext,
    id: string,
    label: string,
    locale: Locale = "en",
  ): Promise<{ error: unknown }> {
    const row = await fetchRow(ctx, id);
    const access = await resolveRcAccess(ctx);
    const user = userEvent.setup();
    let error: unknown = null;
    let settled: Promise<void> = Promise.resolve();
    render(
      <I18nextProvider i18n={createI18n(locale)}>
        <AlertRegister
          alerts={[row]}
          canWrite={access.canWrite}
          busy={false}
          now={NOW}
          onDecide={(d) => {
            settled = decideAlert(ctx, d).catch((e: unknown) => {
              error = e;
            });
          }}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: label }));
    await settled;
    return { error };
  }

  beforeAll(async () => {
    const { data: co, error: coErr } = await svc
      .from("companies")
      .insert({ name: `GC17 UI ${suffix}`, slug: `gc17-ui-${suffix}`, plan_tier: "enterprise" })
      .select("id")
      .single();
    if (coErr || !co) throw coErr ?? new Error("company insert failed");
    state.companyId = co.id;

    for (const [email, roles] of [
      [writerEmail, ["company_admin", "project_admin"]],
      [readerEmail, []],
    ] as const) {
      const { data: u, error: uErr } = await svc.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (uErr || !u.user) throw uErr ?? new Error("createUser failed");
      await svc.from("profiles").upsert({ id: u.user.id, company_id: co.id, email });
      for (const role of roles) {
        await svc
          .from("user_roles")
          .insert({ user_id: u.user.id, company_id: co.id, role: role as never });
      }
      if (email === writerEmail) state.writerId = u.user.id;
    }

    const { data: proj, error: projErr } = await svc
      .from("projects")
      .insert({
        company_id: co.id,
        name: `GC17 UI project ${suffix}`,
        code: `G17U-${suffix.slice(0, 4).toUpperCase()}`,
        status: "active",
        archetype: "utility_pv",
      } as never)
      .select("id")
      .single();
    if (projErr || !proj) throw projErr ?? new Error("project insert failed");
    state.projectId = (proj as { id: string }).id;

    const writer = await login(writerEmail, password);
    const reader = await login(readerEmail, password);
    writerCtx = {
      user: { id: writer.userId } as AuthContext["user"],
      supabase: writer.client,
    };
    readerCtx = {
      user: { id: reader.userId } as AuthContext["user"],
      supabase: reader.client,
    };
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await purgeFixtureTenants(svc, [state.companyId]);
  });

  // -------------------------------------------------------------------------
  // Full happy-path lifecycle through rendered controls
  // -------------------------------------------------------------------------
  it("persists acknowledge → snooze → unsnooze → resolve → reopen from the UI", async () => {
    const id = await seedAlert("high_exposure");

    expect((await clickAction(writerCtx, id, "Acknowledge")).error).toBeNull();
    let row = await persisted(id);
    expect(row.status).toBe("acknowledged");
    expect(row.acknowledged_by).toBe(state.writerId);
    expect(row.row_version).toBe(2);

    expect((await clickAction(writerCtx, id, "Snooze")).error).toBeNull();
    row = await persisted(id);
    expect(row.status).toBe("snoozed");
    expect(row.snoozed_until).toBe(snoozeUntil(NOW));
    expect(row.row_version).toBe(3);

    expect((await clickAction(writerCtx, id, "Unsnooze")).error).toBeNull();
    row = await persisted(id);
    expect(row.status).toBe("open");
    expect(row.snoozed_until).toBeNull();

    expect((await clickAction(writerCtx, id, "Acknowledge")).error).toBeNull();
    expect((await clickAction(writerCtx, id, "Resolve")).error).toBeNull();
    row = await persisted(id);
    expect(row.status).toBe("resolved");
    expect(row.resolved_at).not.toBeNull();

    expect((await clickAction(writerCtx, id, "Reopen")).error).toBeNull();
    row = await persisted(id);
    expect(row.status).toBe("open");
    expect(row.resolved_at).toBeNull();
    expect(row.row_version).toBe(7);
  });

  it("writes an append-only event row for every UI-driven transition", async () => {
    const id = await seedAlert("cover_ratio_breach");
    await clickAction(writerCtx, id, "Acknowledge");
    await clickAction(writerCtx, id, "Resolve");

    const { data } = await svc
      .from("risk_contingency_events")
      .select("action, actor_id, entity_type")
      .eq("entity_id", id)
      .order("created_at", { ascending: true });
    const events = (data ?? []) as { action: string; actor_id: string; entity_type: string }[];
    expect(events.map((e) => e.action)).toEqual(["acknowledged", "resolved"]);
    for (const e of events) {
      expect(e.entity_type).toBe("alert");
      expect(e.actor_id).toBe(state.writerId);
    }
  });

  it("escalates severity from the UI without changing lifecycle status", async () => {
    const id = await seedAlert("sod_exception", { severity: "info" });
    expect((await clickAction(writerCtx, id, "Escalate")).error).toBeNull();
    let row = await persisted(id);
    expect(row.severity).toBe("warning");
    expect(row.status).toBe("open");

    expect((await clickAction(writerCtx, id, "Escalate")).error).toBeNull();
    row = await persisted(id);
    expect(row.severity).toBe("critical");

    // At the top of the ladder the UI stops offering the control.
    const top = await fetchRow(writerCtx, id);
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AlertRegister
          alerts={[top]}
          canWrite
          busy={false}
          now={NOW}
          onDecide={() => {
            throw new Error("unreachable");
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("button", { name: "Escalate" })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Governance: concurrency, role gating, tenancy
  // -------------------------------------------------------------------------
  it("rejects a stale UI decision with 409 and leaves the row untouched", async () => {
    const id = await seedAlert("funding_mismatch");
    const stale = await fetchRow(writerCtx, id);
    // Another actor moves the alert after this UI loaded its row.
    await clickAction(writerCtx, id, "Acknowledge");

    const user = userEvent.setup();
    let err: unknown = null;
    let settled: Promise<void> = Promise.resolve();
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AlertRegister
          alerts={[stale]}
          canWrite
          busy={false}
          now={NOW}
          onDecide={(d) => {
            settled = decideAlert(writerCtx, d).catch((e: unknown) => {
              err = e;
            });
          }}
        />
      </I18nextProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    await settled;
    expect(String((err as { message?: string })?.message ?? err)).toMatch(/stale|409|changed/i);
    const row = await persisted(id);
    expect(row.status).toBe("acknowledged");
    expect(row.row_version).toBe(2);
  });

  it("renders read-only for a member without a write role and blocks the write path", async () => {
    const id = await seedAlert("probability_impact_increase");
    const row = await fetchRow(readerCtx, id);
    const access = await resolveRcAccess(readerCtx);
    expect(access.canWrite).toBe(false);

    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AlertRegister
          alerts={[row]}
          canWrite={access.canWrite}
          busy={false}
          now={NOW}
          onDecide={() => {
            throw new Error("unreachable");
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    // Even bypassing the UI, the server path refuses the reader.
    await expect(
      decideAlert(readerCtx, { id, target: "acknowledged", row_version: row.row_version }),
    ).rejects.toThrow();
    expect((await persisted(id)).status).toBe("open");
  });

  it("keeps the register empty for a signed-in user of another tenant", async () => {
    await seedAlert("shared_register_drift");
    const otherSuffix = crypto.randomUUID().slice(0, 8);
    const { data: co } = await svc
      .from("companies")
      .insert({
        name: `GC17 UI other ${otherSuffix}`,
        slug: `gc17-uio-${otherSuffix}`,
        plan_tier: "enterprise",
      })
      .select("id")
      .single();
    const email = `gc17-ui-o-${otherSuffix}@gm-e2e.local`;
    const { data: u } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    await svc.from("profiles").upsert({ id: u!.user!.id, company_id: co!.id, email });
    await svc
      .from("user_roles")
      .insert({ user_id: u!.user!.id, company_id: co!.id, role: "company_admin" as never });
    const outsider = await login(email, password);

    const { data: visible } = await outsider.client
      .from("risk_contingency_alerts")
      .select("id")
      .eq("project_id", state.projectId!);
    expect(visible ?? []).toHaveLength(0);

    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AlertRegister
          alerts={[]}
          canWrite
          busy={false}
          now={NOW}
          onDecide={() => {
            throw new Error("unreachable");
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("No open alerts.")).toBeTruthy();
    await purgeFixtureTenants(svc, [co!.id]);
  });

  it("drives the Arabic RTL register through the same persisted transition", async () => {
    const id = await seedAlert("stale_quantification");
    document.documentElement.setAttribute("dir", "rtl");
    const row = await fetchRow(writerCtx, id);
    const access = await resolveRcAccess(writerCtx);
    const i18n = createI18n("ar");
    const user = userEvent.setup();
    let settled: Promise<void> = Promise.resolve();
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <AlertRegister
          alerts={[row]}
          canWrite={access.canWrite}
          busy={false}
          now={NOW}
          onDecide={(d) => {
            settled = decideAlert(writerCtx, d);
          }}
        />
      </I18nextProvider>,
    );
    expect(container.textContent ?? "").not.toMatch(/costing\.riskContingency\./);
    const buttons = [...container.querySelectorAll("tbody button")];
    expect(buttons.length).toBeGreaterThan(0);
    await user.click(buttons[0]!);
    await settled;
    expect((await persisted(id)).status).toBe("acknowledged");
    document.documentElement.setAttribute("dir", "ltr");
  });
});
