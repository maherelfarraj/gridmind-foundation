// P-232 — Offline stub over the shipped SQL for the timesheet approval chain
// (0092 seed) and the leave surface. No live database: the migration text is
// the contract, so drift in the chain roles, the leave tables' grants or their
// RLS scoping fails here.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"));

const sql = files.join("\n");
const chainSql = files.filter((b) => b.includes("timesheet_approval")).join("\n");
const leaveSql = files.filter((b) => b.includes("leave_requests")).join("\n");

describe("timesheet approval chain seed", () => {
  it("registers a timesheet_approval rule", () => {
    expect(chainSql).toMatch(/insert into public\.approval_rules/i);
    expect(chainSql).toMatch(/'timesheet_approval'/);
  });

  it("seeds step 1 = foreman and step 2 = project_admin", () => {
    const steps = [...chainSql.matchAll(/select[\s\S]*?r\.company_id[\s\S]*?;/gi)].join("\n");
    expect(chainSql).toMatch(/approval_chain_steps/i);
    expect(steps + chainSql).toMatch(/foreman/);
    expect(steps + chainSql).toMatch(/project_admin/);
  });

  it("is idempotent across re-runs", () => {
    expect(chainSql).toMatch(/on conflict \(rule_id, step_order\) do nothing/i);
  });
});

describe("leave tables", () => {
  const tables = ["leave_requests", "leave_balances"] as const;

  for (const table of tables) {
    it(`${table} enables RLS and is company-scoped`, () => {
      expect(leaveSql).toMatch(
        new RegExp(`alter table public\\.${table}[\\s\\S]{0,80}enable row level security`, "i"),
      );
      const policies = [
        ...leaveSql.matchAll(
          new RegExp(`create policy[\\s\\S]*?on public\\.${table}[\\s\\S]*?;`, "gi"),
        ),
      ].map((m) => m[0]);
      expect(policies.length).toBeGreaterThan(0);
      for (const p of policies) {
        expect(p).toMatch(/is_company_member\(company_id\)|has_company_role|company_id/);
      }
    });

    it(`${table} grants the Data API roles but never anon`, () => {
      expect(sql).toMatch(new RegExp(`grant[^;]*on public\\.${table} to authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant[^;]*on public\\.${table} to service_role`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant[^;]*on public\\.${table} to anon`, "i"));
    });
  }

  it("numbers leave requests LR-#### through a trigger", () => {
    expect(leaveSql).toMatch(/request_number/i);
    expect(leaveSql).toMatch(/LR-/);
  });

  it("blocks duplicate (user, type, range) requests at the constraint level", () => {
    expect(leaveSql).toMatch(/unique\s*\([\s\S]{0,120}(user_id|date_from)[\s\S]{0,120}\)/i);
  });
});
