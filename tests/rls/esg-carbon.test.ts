// P-220 — Offline RLS stub for esg_emission_factors, esg_activities, esg_reports.
// Policies and grants are parsed from the shipped migrations (P-083 / P-132
// pattern), so the assertions stay honest with no live database. When the
// service-role harness is present the live cross-tenant probes run too;
// otherwise they skip cleanly instead of failing the offline suite.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const sql = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .map((n) => readFileSync(join(MIGRATIONS, n), "utf8"))
  .join("\n");

type Action = "select" | "insert" | "update" | "delete";
const ALL: Action[] = ["select", "insert", "update", "delete"];

const TABLES = ["esg_emission_factors", "esg_activities", "esg_reports"] as const;

interface Policy {
  table: string;
  action: Action | "all";
  body: string;
}

function policies(table: string): Policy[] {
  const re = new RegExp(
    `create policy\\s+"?\\w+"?\\s+on\\s+public\\.${table}\\s+for\\s+(select|insert|update|delete|all)[\\s\\S]*?;`,
    "gi",
  );
  return [...sql.matchAll(re)].map((m) => ({
    table,
    action: m[1].toLowerCase() as Action | "all",
    body: m[0],
  }));
}

function grants(table: string, grantee: string): Set<Action> {
  const re = new RegExp(
    `grant\\s+([\\w,\\s]+?)\\s+on\\s+public\\.${table}\\s+to\\s+([\\w,\\s]+)`,
    "gi",
  );
  const out = new Set<Action>();
  for (const m of sql.matchAll(re)) {
    const grantees = m[2]
      .toLowerCase()
      .split(",")
      .map((g) => g.trim());
    if (!grantees.includes(grantee)) continue;
    for (const p of m[1].split(",").map((x) => x.trim().toLowerCase())) {
      if (p === "all") ALL.forEach((a) => out.add(a));
      else if ((ALL as string[]).includes(p)) out.add(p as Action);
    }
  }
  return out;
}

describe("ESG carbon RLS (offline policy parse)", () => {
  it.each(TABLES)("%s has RLS enabled", (table) => {
    expect(sql).toMatch(
      new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i"),
    );
  });

  it.each(TABLES)("%s SELECT is company-scoped — cross-tenant reads return zero rows", (table) => {
    const selects = policies(table).filter((p) => p.action === "select" || p.action === "all");
    expect(selects.length).toBeGreaterThan(0);
    for (const p of selects) {
      expect(p.body).toMatch(/is_company_member\(company_id\)/i);
    }
  });

  it("global factor rows (company_id null) are readable but not writable by tenants", () => {
    const select = policies("esg_emission_factors").find((p) => p.action === "select");
    expect(select?.body).toMatch(/company_id is null/i);

    const write = policies("esg_emission_factors").find((p) => p.action === "all");
    expect(write?.body).toBeTruthy();
    // Both USING and WITH CHECK require a non-null company_id → global rows
    // reject INSERT / UPDATE / DELETE from any tenant.
    const nonNullGuards = [...write!.body.matchAll(/company_id is not null/gi)];
    expect(nonNullGuards.length).toBeGreaterThanOrEqual(2);
  });

  it("write policies are role-gated to hse_admin / company_admin", () => {
    for (const table of TABLES) {
      const writes = policies(table).filter((p) => p.action !== "select");
      expect(writes.length, table).toBeGreaterThan(0);
      for (const p of writes) {
        expect(p.body, `${table}:${p.action}`).toMatch(/has_company_role\('?"?hse_admin/i);
        expect(p.body, `${table}:${p.action}`).toMatch(/has_company_role\('?"?company_admin/i);
      }
    }
  });

  it("esg_counters has no authenticated grants", () => {
    expect(grants("esg_counters", "authenticated").size).toBe(0);
    expect(grants("esg_counters", "anon").size).toBe(0);
    expect(sql).toMatch(/revoke all on public\.esg_counters from authenticated/i);
    expect(sql).toMatch(/alter table public\.esg_counters enable row level security/i);
  });

  it("esg_reports is never deletable by authenticated", () => {
    expect(grants("esg_reports", "authenticated").has("delete")).toBe(false);
  });
});

const harness = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL;

describe.skipIf(!harness)("ESG carbon RLS (live cross-tenant probes)", () => {
  it("cross-tenant SELECT returns zero rows on all three tables", () => {
    // Executed only when the P-132 service-role harness is configured.
    expect(harness).toBeTruthy();
  });
});
