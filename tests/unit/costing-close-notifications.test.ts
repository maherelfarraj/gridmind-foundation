// GC-04 — finance notifications on period transitions and next-open-period
// discovery, exercised against a fake Supabase client.
import { describe, expect, it } from "vitest";

import { findNextOpenPeriod, notifyPeriodTransition } from "@/lib/costing.close.server";

type Row = Record<string, unknown>;

function matchesContains(metadata: Row, filter: Row): boolean {
  return Object.entries(filter).every(([k, v]) => (metadata?.[k] ?? null) === (v ?? null));
}

/** Minimal PostgREST-shaped stub: notifications + user_roles + rpc. */
function fakeCtx(opts: {
  notifications?: Row[];
  roleHolders?: string[];
  states?: Record<string, string>;
}) {
  const notifications: Row[] = [...(opts.notifications ?? [])];
  const holders = (opts.roleHolders ?? ["u1", "u2", "u1"]).map((user_id) => ({ user_id }));

  const builder = (table: string) => {
    const filters: Row = {};
    let containsFilter: Row = {};
    const api: Row = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      in: () => api,
      contains: (_col: string, val: Row) => {
        containsFilter = val;
        return api;
      },
      limit: async () => {
        if (table !== "notifications") return { data: [] };
        return {
          data: notifications.filter(
            (n) =>
              n.type === filters.type &&
              n.company_id === filters.company_id &&
              matchesContains(n.metadata as Row, containsFilter),
          ),
        };
      },
      insert: async (rows: Row[]) => {
        notifications.push(...rows);
        return { error: null };
      },
    };
    if (table === "user_roles") api.in = async () => ({ data: holders });
    return api;
  };

  return {
    notifications,
    ctx: {
      supabase: {
        from: (t: string) => builder(t),
        rpc: async (_name: string, args: Row) => ({
          data: opts.states?.[String(args.p_date ?? args.p_period_month ?? "")] ?? "open",
        }),
      },
    } as never,
  };
}

const COMPANY = "c1";
const PROJECT = "p1";

describe("period transition notifications", () => {
  it("notifies every distinct finance role holder once", async () => {
    const { ctx, notifications } = fakeCtx({});
    const n = await notifyPeriodTransition(ctx, {
      companyId: COMPANY,
      projectId: PROJECT,
      projectName: "East Amman",
      period: "2026-03-01",
      state: "soft_locked",
      reason: "pre-close",
      rowVersion: 2,
    });
    expect(n).toBe(2); // u1 deduplicated
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      type: "costing.period.soft_locked",
      title: "Costing period soft locked",
      link: "/projects/p1/costing/close",
    });
    expect(notifications[0].body).toBe("East Amman — 2026-03 — pre-close");
  });

  it("stays silent for a repeated idempotent transition", async () => {
    const { ctx, notifications } = fakeCtx({
      notifications: [
        {
          company_id: COMPANY,
          type: "costing.period.hard_closed",
          metadata: { period: "2026-03-01", project_id: PROJECT, row_version: 3 },
        },
      ],
    });
    const n = await notifyPeriodTransition(ctx, {
      companyId: COMPANY,
      projectId: PROJECT,
      projectName: null,
      period: "2026-03-01",
      state: "hard_closed",
      reason: null,
      rowVersion: 3,
    });
    expect(n).toBe(0);
    expect(notifications).toHaveLength(1);
  });

  it("notifies again after reopen -> re-lock (new row version)", async () => {
    const { ctx } = fakeCtx({
      notifications: [
        {
          company_id: COMPANY,
          type: "costing.period.soft_locked",
          metadata: { period: "2026-03-01", project_id: PROJECT, row_version: 1 },
        },
      ],
    });
    const n = await notifyPeriodTransition(ctx, {
      companyId: COMPANY,
      projectId: PROJECT,
      projectName: null,
      period: "2026-03-01",
      state: "soft_locked",
      reason: "re-locked after restatement",
      rowVersion: 3,
    });
    expect(n).toBe(2);
  });

  it("links company-level transitions to the finance periods page", async () => {
    const { notifications, ctx } = fakeCtx({ roleHolders: ["u9"] });
    await notifyPeriodTransition(ctx, {
      companyId: COMPANY,
      projectId: null,
      projectName: null,
      period: "2026-03-01",
      state: "open",
      reason: "audit adjustment",
      rowVersion: 4,
    });
    expect(notifications[0]).toMatchObject({
      link: "/finance/periods",
      title: "Costing period reopened",
    });
  });

  it("returns 0 when nobody holds a finance role", async () => {
    const { ctx } = fakeCtx({ roleHolders: [] });
    await expect(
      notifyPeriodTransition(ctx, {
        companyId: COMPANY,
        projectId: null,
        projectName: null,
        period: "2026-03-01",
        state: "soft_locked",
        reason: null,
      }),
    ).resolves.toBe(0);
  });
});

describe("next open period for a reversal", () => {
  it("returns the original month when it is still open", async () => {
    const { ctx } = fakeCtx({});
    await expect(findNextOpenPeriod(ctx, COMPANY, PROJECT, "2026-03-18")).resolves.toBe(
      "2026-03-01",
    );
  });

  it("skips locked months and lands on the first open one", async () => {
    const { ctx } = fakeCtx({
      states: {
        "2026-03-01": "hard_closed",
        "2026-04-01": "soft_locked",
        "2026-05-01": "open",
      },
    });
    await expect(findNextOpenPeriod(ctx, COMPANY, PROJECT, "2026-03-31")).resolves.toBe(
      "2026-05-01",
    );
  });

  it("returns null when nothing opens inside the horizon", async () => {
    const { ctx } = fakeCtx({ states: {} });
    const ctxAllClosed = {
      supabase: {
        from: () => ({ select: () => ({}) }),
        rpc: async () => ({ data: "hard_closed" }),
      },
    } as never;
    void ctx;
    await expect(
      findNextOpenPeriod(ctxAllClosed, COMPANY, PROJECT, "2026-03-01", 6),
    ).resolves.toBeNull();
  });
});
