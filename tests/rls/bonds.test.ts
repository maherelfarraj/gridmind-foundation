// P-206 — Offline RLS stub for bond_instruments, bond_claims, bond_renewals.
//
// The shipped policies (migration 0082) are parsed straight out of the SQL and
// replayed through a tiny in-memory policy store, so these assertions stay
// honest without a live database: cross-tenant reads return zero rows, writes
// require finance_admin / legal_admin / company_admin, renewals are
// append-only, and DELETE has neither a grant nor a policy for any role.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const BOND_TABLES = ["bond_instruments", "bond_claims", "bond_renewals"] as const;
type BondTable = (typeof BOND_TABLES)[number];
type Action = "select" | "insert" | "update" | "delete";

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .filter((body) => body.includes("bond_instruments"))
  .join("\n");

interface Policy {
  table: BondTable;
  action: Action;
  memberScoped: boolean;
  roles: string[];
}

/** Parse `create policy … on public.<bond table> for <action> …` blocks. */
function parsePolicies(): Policy[] {
  const re =
    /create policy\s+\w+\s+on\s+public\.(bond_\w+)\s+for\s+(select|insert|update|delete)[\s\S]*?;/gi;
  const out: Policy[] = [];
  for (const m of sql.matchAll(re)) {
    const table = m[1] as BondTable;
    if (!BOND_TABLES.includes(table)) continue;
    const body = m[0];
    out.push({
      table,
      action: m[2].toLowerCase() as Action,
      memberScoped: body.includes("is_company_member(company_id)"),
      roles: [...body.matchAll(/has_company_role\('(\w+)'\)/g)].map((r) => r[1]),
    });
  }
  return out;
}

/** Parse `grant <privs> on public.<table> to <role>` for the authenticated role. */
function grantedActions(table: BondTable, grantee = "authenticated"): Set<Action> {
  const re = new RegExp(`grant\\s+([\\w,\\s]+?)\\s+on\\s+public\\.${table}\\s+to\\s+(\\w+)`, "gi");
  const set = new Set<Action>();
  for (const m of sql.matchAll(re)) {
    if (m[2].toLowerCase() !== grantee) continue;
    for (const p of m[1].split(",").map((x) => x.trim().toLowerCase())) {
      if (p === "all")
        (["select", "insert", "update", "delete"] as Action[]).forEach((a) => set.add(a));
      else if (["select", "insert", "update", "delete"].includes(p)) set.add(p as Action);
    }
  }
  return set;
}

const policies = parsePolicies();

interface Actor {
  companyId: string;
  roles: string[];
}

const memberA: Actor = { companyId: "A", roles: ["project_member"] };
const financeA: Actor = { companyId: "A", roles: ["finance_admin"] };
const legalA: Actor = { companyId: "A", roles: ["legal_admin"] };
const adminA: Actor = { companyId: "A", roles: ["company_admin"] };
const adminB: Actor = { companyId: "B", roles: ["company_admin"] };

/** Postgres semantics: no grant OR no matching permissive policy → denied. */
function allowed(actor: Actor, table: BondTable, action: Action, rowCompany: string): boolean {
  if (!grantedActions(table).has(action)) return false;
  return policies.some((p) => {
    if (p.table !== table || p.action !== action) return false;
    if (p.memberScoped && actor.companyId !== rowCompany) return false;
    if (p.roles.length > 0 && !p.roles.some((r) => actor.roles.includes(r))) return false;
    return true;
  });
}

describe("P-206 bond RLS stub — policy store", () => {
  it("parsed every bond table's policies out of the shipped migration", () => {
    for (const t of BOND_TABLES) {
      expect(policies.filter((p) => p.table === t).length).toBeGreaterThan(0);
    }
  });

  it("enables row level security on all three tables", () => {
    for (const t of BOND_TABLES) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
    }
  });
});

describe("cross-tenant isolation", () => {
  for (const table of BOND_TABLES) {
    it(`company A reads zero company B rows from ${table}`, () => {
      expect(allowed(adminA, table, "select", "B")).toBe(false);
      expect(allowed(adminA, table, "select", "A")).toBe(true);
    });

    it(`company B admin cannot write into company A's ${table}`, () => {
      expect(allowed(adminB, table, "insert", "A")).toBe(false);
    });
  }

  it("anon has every privilege revoked on the bond tables", () => {
    for (const table of ["bond_instruments", "bond_claims"] as const) {
      expect(sql).toContain(`revoke all on public.${table} from anon`);
      expect(grantedActions(table, "anon").size).toBe(0);
    }
    expect(grantedActions("bond_renewals", "anon").size).toBe(0);
  });
});

describe("write role gating", () => {
  for (const table of BOND_TABLES) {
    it(`a plain member cannot INSERT into ${table}`, () => {
      expect(allowed(memberA, table, "insert", "A")).toBe(false);
    });

    for (const actor of [financeA, legalA, adminA]) {
      it(`${actor.roles[0]} can INSERT into ${table}`, () => {
        expect(allowed(actor, table, "insert", "A")).toBe(true);
      });
    }
  }

  it("a plain member cannot UPDATE instruments or claims", () => {
    expect(allowed(memberA, "bond_instruments", "update", "A")).toBe(false);
    expect(allowed(memberA, "bond_claims", "update", "A")).toBe(false);
  });

  it("finance/legal/company admins can UPDATE instruments and claims in their tenant", () => {
    for (const actor of [financeA, legalA, adminA]) {
      expect(allowed(actor, "bond_instruments", "update", "A")).toBe(true);
      expect(allowed(actor, "bond_claims", "update", "A")).toBe(true);
    }
  });
});

describe("append-only renewals", () => {
  it("has no UPDATE or DELETE policy on bond_renewals", () => {
    expect(
      policies.filter((p) => p.table === "bond_renewals" && p.action === "update"),
    ).toHaveLength(0);
    expect(
      policies.filter((p) => p.table === "bond_renewals" && p.action === "delete"),
    ).toHaveLength(0);
  });

  it("never grants UPDATE or DELETE on bond_renewals to authenticated", () => {
    const granted = grantedActions("bond_renewals");
    expect([...granted].sort()).toEqual(["insert", "select"]);
  });

  it("denies renewal UPDATE and DELETE even for company_admin", () => {
    expect(allowed(adminA, "bond_renewals", "update", "A")).toBe(false);
    expect(allowed(adminA, "bond_renewals", "delete", "A")).toBe(false);
  });
});

describe("no DELETE for any role", () => {
  for (const table of BOND_TABLES) {
    it(`${table} has no DELETE grant and no DELETE policy`, () => {
      expect(grantedActions(table).has("delete")).toBe(false);
      expect(policies.filter((p) => p.table === table && p.action === "delete")).toHaveLength(0);
      for (const actor of [memberA, financeA, legalA, adminA, adminB]) {
        expect(allowed(actor, table, "delete", "A")).toBe(false);
      }
    });
  }
});
