// P-208 — Offline RLS stub for gl_account_mappings, gl_export_runs,
// gl_journal_entries. Policies and grants are parsed straight out of the
// shipped migration SQL, so these assertions stay honest without a live
// database: cross-tenant reads return nothing, writes are role-gated to
// finance_admin / company_admin, journal entries are append-only, and no
// table grants DELETE to authenticated (regeneration supersedes, never
// deletes).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const GL_TABLES = ["gl_account_mappings", "gl_export_runs", "gl_journal_entries"] as const;
type GlTable = (typeof GL_TABLES)[number];
type Action = "select" | "insert" | "update" | "delete";

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .filter((body) => body.includes("gl_export_runs"))
  .join("\n");

interface Policy {
  table: GlTable;
  action: Action;
  memberScoped: boolean;
  roles: string[];
}

function parsePolicies(): Policy[] {
  const re =
    /create policy\s+\w+\s+on\s+public\.(gl_\w+)\s+for\s+(select|insert|update|delete)[\s\S]*?;/gi;
  const out: Policy[] = [];
  for (const m of sql.matchAll(re)) {
    const table = m[1] as GlTable;
    if (!GL_TABLES.includes(table)) continue;
    out.push({
      table,
      action: m[2].toLowerCase() as Action,
      memberScoped: m[0].includes("is_company_member(company_id)"),
      roles: [...m[0].matchAll(/has_company_role\('(\w+)'\)/g)].map((r) => r[1]),
    });
  }
  return out;
}

function grantedActions(table: GlTable, grantee = "authenticated"): Set<Action> {
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

/** Replay a request through grants + policies, exactly as Postgres would. */
function allowed(
  table: GlTable,
  action: Action,
  actor: { sameCompany: boolean; roles: string[] },
): boolean {
  if (!grantedActions(table).has(action)) return false;
  return policies
    .filter((p) => p.table === table && p.action === action)
    .some((p) => {
      if (p.memberScoped && !actor.sameCompany) return false;
      if (p.roles.length === 0) return true;
      return p.roles.some((r) => actor.roles.includes(r));
    });
}

const member = { sameCompany: true, roles: ["project_manager"] };
const financeAdmin = { sameCompany: true, roles: ["finance_admin"] };
const companyAdmin = { sameCompany: true, roles: ["company_admin"] };
const outsider = { sameCompany: false, roles: ["finance_admin", "company_admin"] };

describe("GL migration shape", () => {
  it("ships all three tables with RLS enabled", () => {
    for (const table of GL_TABLES) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      );
    }
  });

  it("defines the run status enum with superseded", () => {
    expect(sql).toMatch(/gl_run_status as enum \('generated','downloaded','superseded'\)/);
  });
});

describe("cross-tenant isolation", () => {
  it("returns nothing to a user outside the company", () => {
    for (const table of GL_TABLES) {
      expect(allowed(table, "select", outsider)).toBe(false);
    }
  });

  it("lets a company member read their own ledger data", () => {
    for (const table of GL_TABLES) {
      expect(allowed(table, "select", member)).toBe(true);
    }
  });

  it("blocks writes from outside the company even for finance admins", () => {
    for (const table of GL_TABLES) {
      expect(allowed(table, "insert", outsider)).toBe(false);
      expect(allowed(table, "update", outsider)).toBe(false);
    }
  });
});

describe("role gating", () => {
  it("restricts writes to finance_admin or company_admin", () => {
    for (const table of GL_TABLES) {
      expect(allowed(table, "insert", member)).toBe(false);
      expect(allowed(table, "insert", financeAdmin)).toBe(true);
      expect(allowed(table, "insert", companyAdmin)).toBe(true);
    }
  });

  it("allows run status updates (downloaded / superseded) for finance admins only", () => {
    expect(allowed("gl_export_runs", "update", financeAdmin)).toBe(true);
    expect(allowed("gl_export_runs", "update", member)).toBe(false);
  });
});

describe("append-only + supersede-not-delete", () => {
  it("grants no DELETE on any GL table to authenticated", () => {
    for (const table of GL_TABLES) {
      expect(grantedActions(table).has("delete")).toBe(false);
      expect(allowed(table, "delete", companyAdmin)).toBe(false);
    }
  });

  it("declares no DELETE policy at all", () => {
    expect(policies.filter((p) => p.action === "delete")).toHaveLength(0);
  });

  it("keeps journal entries immutable — insert and select only", () => {
    const grants = grantedActions("gl_journal_entries");
    expect([...grants].sort()).toEqual(["insert", "select"]);
    expect(allowed("gl_journal_entries", "update", financeAdmin)).toBe(false);
  });
});
