// Performance/pagination regressions for the portfolio audit loader.
//
// These pin the query shape (set-based, no N+1) and the page-window maths so a
// future refactor cannot reintroduce per-event fetches or off-by-one ranges.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/costing.close.server", () => ({
  hasCloseRole: vi.fn(async () => true),
}));
vi.mock("@/lib/portfolio-costing.server", () => ({
  currentCompanyId: vi.fn(async () => "company-1"),
}));
vi.mock("@/lib/costing.server", () => ({
  costingAudit: vi.fn(async () => undefined),
  costingHttpError: (status: number, code: string, message: string) => {
    throw new Error(`${status} ${code}: ${message}`);
  },
}));

import { loadPortfolioAudit } from "@/lib/portfolio-audit.server";
import type { AuditFilter } from "@/lib/portfolio-audit.rules";

interface Call {
  table: string;
  ops: { op: string; args: unknown[] }[];
}

const LOG = {
  id: "log-1",
  created_at: "2026-07-01T10:00:00Z",
  actor_id: "user-1",
  action: "costing.period.closed",
  entity: "costing_periods",
  entity_id: "period-1",
  company_id: "company-1",
  metadata: { project_id: "project-1", period: "2026-07-01" },
};

function fakeSupabase(rows = [LOG], count = 137) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const result =
      table === "audit_logs"
        ? { data: rows, error: null, count }
        : table === "projects"
          ? {
              data: [{ id: "project-1", code: "GSI-EAM-001", name: "East Amman" }],
              error: null,
              count: 1,
            }
          : { data: [{ id: "user-1", full_name: "Maher" }], error: null, count: 1 };

    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    for (const op of [
      "select",
      "eq",
      "in",
      "gte",
      "lte",
      "order",
      "range",
      "contains",
      "limit",
    ]) {
      builder[op] = (...args: unknown[]) => {
        call.ops.push({ op, args });
        return builder;
      };
    }
    return builder;
  };
  return { calls, ctx: { supabase: { from } } as never };
}

const filter = (over: Partial<AuditFilter> = {}): AuditFilter =>
  ({ page: 1, page_size: 50, ...over }) as AuditFilter;

describe("portfolio audit loader query shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues exactly three set-based queries regardless of event count", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...LOG, id: `log-${i}` }));
    const { calls, ctx } = fakeSupabase(many, 137);
    await loadPortfolioAudit(ctx, filter());
    expect(calls.map((c) => c.table).sort()).toEqual(["audit_logs", "profiles", "projects"]);
    expect(calls).toHaveLength(3);
  });

  it("scopes every query to the caller's company", async () => {
    const { calls, ctx } = fakeSupabase();
    await loadPortfolioAudit(ctx, filter());
    for (const call of calls) {
      expect(call.ops.some((o) => o.op === "eq" && o.args[0] === "company_id")).toBe(true);
    }
  });

  it("pushes severity/group filtering into the SQL action list", async () => {
    const { calls, ctx } = fakeSupabase();
    await loadPortfolioAudit(ctx, filter({ severity: "critical" }));
    const logs = calls.find((c) => c.table === "audit_logs")!;
    const inOp = logs.ops.find((o) => o.op === "in")!;
    const actions = inOp.args[1] as string[];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).not.toContain("__none__");
  });

  it("computes half-open-free page ranges at boundaries", async () => {
    for (const [page, size, expected] of [
      [1, 50, [0, 49]],
      [2, 50, [50, 99]],
      [3, 50, [100, 149]],
      [1, 200, [0, 199]],
    ] as const) {
      const { calls, ctx } = fakeSupabase();
      await loadPortfolioAudit(ctx, filter({ page, page_size: size }));
      const range = calls.find((c) => c.table === "audit_logs")!.ops.find((o) => o.op === "range")!;
      expect(range.args).toEqual([expected[0], expected[1]]);
    }
  });

  it("reports the server-side total, not the page length", async () => {
    const { ctx } = fakeSupabase([LOG], 137);
    const data = await loadPortfolioAudit(ctx, filter({ page: 2 }));
    expect(data.reconciliation.total).toBe(137);
    expect(data.reconciliation.page_count).toBe(1);
    expect(data.page).toBe(2);
    expect(data.page_size).toBe(50);
  });

  it("applies deep-link filters as indexed predicates", async () => {
    const { calls, ctx } = fakeSupabase();
    await loadPortfolioAudit(
      ctx,
      filter({
        from: "2026-07-01",
        to: "2026-07-31",
        actor: "user-1",
        project_id: "project-1",
        period: "2026-07-01",
        correlation_id: "corr-9",
      }),
    );
    const ops = calls.find((c) => c.table === "audit_logs")!.ops;
    expect(ops.some((o) => o.op === "gte" && o.args[0] === "created_at")).toBe(true);
    expect(ops.some((o) => o.op === "lte" && o.args[0] === "created_at")).toBe(true);
    expect(ops.some((o) => o.op === "eq" && o.args[0] === "actor_id")).toBe(true);
    expect(ops.filter((o) => o.op === "contains")).toHaveLength(3);
  });

  it("keeps deterministic ordering for stable pagination", async () => {
    const { calls, ctx } = fakeSupabase();
    await loadPortfolioAudit(ctx, filter());
    const orders = calls.find((c) => c.table === "audit_logs")!.ops.filter((o) => o.op === "order");
    expect(orders.map((o) => o.args[0])).toEqual(["created_at", "id"]);
  });

  it("denies callers without a close role", async () => {
    const { hasCloseRole } = await import("@/lib/costing.close.server");
    vi.mocked(hasCloseRole).mockResolvedValueOnce(false);
    const { ctx } = fakeSupabase();
    await expect(loadPortfolioAudit(ctx, filter())).rejects.toThrow(/403/);
  });
});
