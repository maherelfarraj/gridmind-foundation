// P-209 — Offline RLS stub for rate_library, estimates, estimate_lines.
// Policies and grants are parsed straight out of the shipped migration SQL so
// these assertions stay honest without a live database: every table is
// company-scoped on SELECT, writes are role-gated, finance_admin can read but
// never write estimates or lines, deletes are draft-only, and nothing is
// granted to anon.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const TABLES = ["rate_library", "estimates", "estimate_lines"] as const;
type Table = (typeof TABLES)[number];
type Action = "select" | "insert" | "update" | "delete";

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .filter((body) => body.includes("estimate_lines"))
  .join("\n");

interface Policy {
  table: Table;
  action: Action;
  body: string;
  memberScoped: boolean;
  roles: string[];
}

function parsePolicies(): Policy[] {
  const re =
    /create policy\s+\w+\s+on\s+public\.(rate_library|estimates|estimate_lines)\s+for\s+(select|insert|update|delete)([\s\S]*?);/gi;
  const out: Policy[] = [];
  for (const m of sql.matchAll(re)) {
    const body = m[3];
    out.push({
      table: m[1] as Table,
      action: m[2].toLowerCase() as Action,
      body,
      memberScoped: /is_company_member\(company_id\)/.test(body),
      roles: [...new Set([...body.matchAll(/has_company_role\('(\w+)'\)/g)].map((r) => r[1]))],
    });
  }
  return out;
}

const policies = parsePolicies();

function find(table: Table, action: Action): Policy {
  const p = policies.find((x) => x.table === table && x.action === action);
  expect(p, `${table}.${action} policy missing`).toBeTruthy();
  return p as Policy;
}

describe("P-209 estimating RLS", () => {
  it("ships policies for every table and action", () => {
    for (const table of TABLES) {
      for (const action of ["select", "insert", "update", "delete"] as Action[]) {
        expect(find(table, action).table).toBe(table);
      }
    }
  });

  it("scopes every policy to company membership (cross-tenant SELECT = 0 rows)", () => {
    expect(policies.length).toBeGreaterThanOrEqual(12);
    for (const p of policies) expect(p.memberScoped, `${p.table}.${p.action}`).toBe(true);
  });

  it("SELECT is membership-only — no extra role gate", () => {
    for (const table of TABLES) expect(find(table, "select").roles).toEqual([]);
  });

  it("rate_library writes are gated to engineering/procurement/finance/company admins", () => {
    for (const action of ["insert", "update"] as Action[]) {
      expect(find("rate_library", action).roles.sort()).toEqual([
        "company_admin",
        "engineering_admin",
        "finance_admin",
        "procurement_admin",
      ]);
    }
  });

  it("estimates and lines are writable by engineering/procurement/company admins only", () => {
    for (const table of ["estimates", "estimate_lines"] as Table[]) {
      for (const action of ["insert", "update"] as Action[]) {
        const roles = find(table, action).roles.sort();
        expect(roles).toEqual(["company_admin", "engineering_admin", "procurement_admin"]);
        expect(roles).not.toContain("finance_admin");
      }
    }
  });

  it("finance_admin reads estimates but can never write them", () => {
    const writes = policies.filter(
      (p) => p.table !== "rate_library" && p.action !== "select" && p.roles.includes("finance_admin"),
    );
    expect(writes).toEqual([]);
    expect(find("estimates", "select").memberScoped).toBe(true);
  });

  it("estimate DELETE is draft-only and limited to owner or company admin", () => {
    const del = find("estimates", "delete");
    expect(del.body).toMatch(/status\s*=\s*'draft'/);
    expect(del.body).toMatch(/created_by\s*=\s*auth\.uid\(\)/);
    expect(del.body).toMatch(/has_company_role\('company_admin'\)/);
  });

  it("estimate line DELETE requires the parent estimate to still be draft", () => {
    expect(find("estimate_lines", "delete").body).toMatch(/estimates[\s\S]*status\s*=\s*'draft'/);
  });

  it("has a trigger backstop blocking deletes of non-draft estimates", () => {
    expect(sql).toMatch(/function public\.estimates_block_delete\(\)/);
    expect(sql).toMatch(/old\.status <> 'draft'/);
    expect(sql).toMatch(/create trigger estimates_block_delete_trg[\s\S]*before delete on public\.estimates/);
  });

  it("mints EST-#### numbers from a company counter", () => {
    expect(sql).toMatch(/'EST-' \|\| lpad\(public\.next_estimate_number\(new\.company_id, 'estimate'\)/);
    expect(sql).toMatch(/constraint estimates_number_unique unique \(company_id, estimate_number\)/);
  });

  it("keeps rate names unique per company and rate type, and indexes expiry", () => {
    expect(sql).toMatch(/constraint rate_library_unique unique \(company_id, rate_type, name\)/);
    expect(sql).toMatch(/rate_library_company_valid_to_idx[\s\S]*\(company_id, valid_to\)/);
  });

  it("grants nothing to anon and revokes the counter table from authenticated", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${table} from anon`));
      expect(sql).not.toMatch(new RegExp(`grant [^;]*on public\\.${table} to anon`));
    }
    expect(sql).toMatch(/revoke all on public\.estimate_counters from anon, authenticated/);
  });

  it("enables RLS on all three tables", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
  });
});
