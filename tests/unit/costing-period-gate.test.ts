// GC-04 — the centralized period gate must be reachable, project-scoped, and
// audited on EVERY finance/costing mutation path.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertPeriodOpen, isCostingPeriodError, isPeriodClosedError } from "@/lib/finance/periods";

type Row = Record<string, unknown>;
type RpcCall = { name: string; args: Row };

function fakeSupabase(errors: Record<string, { message: string } | null>) {
  const calls: RpcCall[] = [];
  const inserted: Row[] = [];
  const client = {
    calls,
    inserted,
    auth: { getUser: async () => ({ data: { user: { id: "actor-1" } } }) },
    rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      return { error: errors[name] ?? null };
    },
    from: (table: string) => ({
      insert: async (row: Row) => {
        if (table === "audit_logs") inserted.push(row);
        return { error: null };
      },
    }),
  };
  return client;
}

const COMPANY = "c0000000-0000-0000-0000-000000000000";
const PROJECT = "p0000000-0000-0000-0000-000000000000";

describe("assertPeriodOpen — one authoritative gate", () => {
  it("checks the fiscal month AND the costing month, scoped to the project", async () => {
    const sb = fakeSupabase({});
    await assertPeriodOpen(sb as never, COMPANY, "2026-03-18", {
      entity: "invoices",
      projectId: PROJECT,
    });
    expect(sb.calls.map((c) => c.name)).toEqual([
      "assert_finance_period_open",
      "assert_costing_period_open",
    ]);
    expect(sb.calls[1].args).toMatchObject({
      p_company_id: COMPANY,
      p_project_id: PROJECT,
      p_date: "2026-03-18",
      p_adjustment: false,
    });
    expect(sb.inserted).toHaveLength(0);
  });

  it("passes a null project for company-level mutations", async () => {
    const sb = fakeSupabase({});
    await assertPeriodOpen(sb as never, COMPANY, "2026-03-18");
    expect(sb.calls[1].args.p_project_id).toBeNull();
  });

  it("blocks a backdated post into a hard-closed costing month with a 409 and one audit row", async () => {
    const sb = fakeSupabase({
      assert_costing_period_open: {
        message: "costing_period_hard_closed: 2026-02 is hard closed",
      },
    });
    let thrown: unknown;
    try {
      await assertPeriodOpen(sb as never, COMPANY, "2026-02-27", {
        entity: "cost_accruals",
        entityId: "a1",
        projectId: PROJECT,
      });
    } catch (err) {
      thrown = err;
    }
    expect(isCostingPeriodError(thrown)).toBe(true);
    expect((thrown as { statusCode: number }).statusCode).toBe(409);
    expect((thrown as { code: string }).code).toBe("costing_period_hard_closed");
    expect((thrown as { period: string }).period).toBe("2026-02");
    expect(sb.inserted).toHaveLength(1);
    expect(sb.inserted[0].entity).toBe("cost_accruals");
  });

  it("blocks a soft-locked costing month with its own code", async () => {
    const sb = fakeSupabase({
      assert_costing_period_open: { message: "costing_period_soft_locked: 2026-02 is soft locked" },
    });
    await expect(
      assertPeriodOpen(sb as never, COMPANY, "2026-02-27", { projectId: PROJECT }),
    ).rejects.toMatchObject({ code: "costing_period_soft_locked", statusCode: 409 });
  });

  it("still blocks on a closed fiscal period before the costing check runs", async () => {
    const sb = fakeSupabase({
      assert_finance_period_open: { message: "finance_period_closed: 2026-01-01 is closed" },
    });
    await expect(
      assertPeriodOpen(sb as never, COMPANY, "2026-01-15", { projectId: PROJECT }),
    ).rejects.toSatisfy(isPeriodClosedError);
    expect(sb.calls.map((c) => c.name)).toEqual(["assert_finance_period_open"]);
  });

  it("no-ops when the enforcement RPCs are not deployed", async () => {
    const sb = fakeSupabase({});
    sb.rpc = async (name: string, args: Row) => {
      sb.calls.push({ name, args });
      return { error: { code: "PGRST202", message: "not found" } as never };
    };
    await expect(
      assertPeriodOpen(sb as never, COMPANY, "2026-03-18", { projectId: PROJECT }),
    ).resolves.toBeUndefined();
  });

  it("no-ops without a company or a date", async () => {
    const sb = fakeSupabase({});
    await assertPeriodOpen(sb as never, null, "2026-03-18");
    await assertPeriodOpen(sb as never, COMPANY, null);
    expect(sb.calls).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Every mutation path must reach the gate WITH a project scope, otherwise a
// project-level lock silently does nothing.
// --------------------------------------------------------------------------
const GATED_FILES = [
  "src/lib/invoices.functions.ts",
  "src/lib/payments.functions.ts",
  "src/lib/pay-app.functions.ts",
  "src/lib/cash-flow.functions.ts",
];

describe("period gate coverage across finance mutation paths", () => {
  it.each(GATED_FILES)("%s scopes every assertPeriodOpen call to a project", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    const sites = src.split("assertPeriodOpen(").slice(1);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      // The call's argument list ends at the first `);` on its own indentation.
      const args = site.slice(0, site.indexOf("\n    }") + 200 || 400);
      expect(args).toMatch(/projectId/);
    }
  });

  it("costing mutations go through the costing gate", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/costing.functions.ts"), "utf8");
    expect(src).toMatch(/assertCostingPeriodOpen|assertPeriodOpen/);
  });
});
