// Day 7 — blocked-attempt audit regression.
// A blocked July posting must write EXACTLY one audit row and still 409.
import { describe, expect, it } from "vitest";

import {
  EXPORT_BLOCKED_ACTION,
  PERIOD_BLOCKED_ACTION,
  exportBlockedAuditRow,
  periodBlockedAuditRow,
} from "@/lib/blocked-audit";
import { assertPeriodOpen, isPeriodClosedError } from "@/lib/finance/periods";

type Row = Record<string, unknown>;

function fakeSupabase(opts: { closed: boolean }) {
  const inserted: Row[] = [];
  return {
    inserted,
    auth: {
      getUser: async () => ({ data: { user: { id: "actor-1" } } }),
    },
    rpc: async () =>
      opts.closed
        ? {
            error: {
              message:
                "finance_period_closed: 2026-07-01 is closed for financial mutations",
            },
          }
        : { error: null },
    from: (table: string) => ({
      insert: async (row: Row) => {
        if (table === "audit_logs") inserted.push(row);
        return { error: null };
      },
    }),
  } as never;
}

describe("blocked-attempt audit", () => {
  it("writes exactly one audit row and still throws 409 on a closed period", async () => {
    const sb = fakeSupabase({ closed: true }) as unknown as {
      inserted: Row[];
    };
    let thrown: unknown;
    try {
      await assertPeriodOpen(
        sb as never,
        "company-1",
        "2026-07-28",
        { entity: "payments", entityId: "11111111-1111-1111-1111-111111111111" },
      );
    } catch (err) {
      thrown = err;
    }
    expect(isPeriodClosedError(thrown)).toBe(true);
    expect((thrown as { statusCode: number }).statusCode).toBe(409);
    expect(sb.inserted).toHaveLength(1);
    const row = sb.inserted[0];
    expect(row.action).toBe(PERIOD_BLOCKED_ACTION);
    expect(row.entity).toBe("payments");
    expect(row.actor_id).toBe("actor-1");
    expect((row.metadata as Row).attempted_posting_date).toBe("2026-07-28");
    expect((row.metadata as Row).period).toBe("2026-07");
  });

  it("writes no audit row when the period is open", async () => {
    const sb = fakeSupabase({ closed: false }) as unknown as { inserted: Row[] };
    await expect(
      assertPeriodOpen(sb as never, "company-1", "2026-08-02"),
    ).resolves.toBeUndefined();
    expect(sb.inserted).toHaveLength(0);
  });

  it("builds a period-blocked row with the attempted date and 409 code", () => {
    const row = periodBlockedAuditRow({
      companyId: "c",
      actorId: "a",
      attemptedDate: "2026-07-15",
      entity: "invoices",
    });
    expect(row).toMatchObject({
      action: PERIOD_BLOCKED_ACTION,
      entity: "invoices",
      entity_id: null,
    });
    expect(row.metadata).toMatchObject({
      reason: "finance_period_closed",
      attempted_posting_date: "2026-07-15",
      status_code: 409,
    });
  });

  it("builds an export-blocked row scoped to the project and export type", () => {
    const row = exportBlockedAuditRow({
      companyId: "c",
      projectId: "p",
      exportType: "weekly_client_report",
    });
    expect(row.action).toBe(EXPORT_BLOCKED_ACTION);
    expect(row.entity).toBe("project_export_locks");
    expect(row.entity_id).toBe("p");
    expect(row.metadata).toMatchObject({
      export_type: "weekly_client_report",
      status_code: 423,
    });
  });
});
