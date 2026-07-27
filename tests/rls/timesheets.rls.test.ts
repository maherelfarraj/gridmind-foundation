// P-227 — Offline RLS stub for timesheets, timesheet_entries, leave_requests,
// leave_balances. Policies, grants, constraints and triggers are parsed straight
// out of the shipped migration SQL so these assertions stay honest without a
// live database: every table is company-scoped, non-admin members only ever see
// their own rows, entry writes are draft-gated (with a trigger backstop),
// balances are admin-write-only, and nothing is granted to anon.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const TABLES = ["timesheets", "timesheet_entries", "leave_requests", "leave_balances"] as const;
type Table = (typeof TABLES)[number];
type Action = "select" | "insert" | "update" | "delete";

const ADMIN_ROLES = ["foreman", "construction_admin", "project_admin", "company_admin"] as const;

const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  .filter((body) => body.includes("timesheet_entries"))
  .join("\n");

interface Policy {
  table: Table;
  action: Action;
  body: string;
  memberScoped: boolean;
  ownerScoped: boolean;
  roles: string[];
}

function parsePolicies(): Policy[] {
  const re =
    /create policy\s+\w+\s+on\s+public\.(timesheets|timesheet_entries|leave_requests|leave_balances)\s+for\s+(select|insert|update|delete)([\s\S]*?);\n/gi;
  const out: Policy[] = [];
  for (const m of sql.matchAll(re)) {
    const body = m[3];
    out.push({
      table: m[1] as Table,
      action: m[2].toLowerCase() as Action,
      body,
      memberScoped: /is_company_member\(company_id\)/.test(body),
      ownerScoped: /user_id = auth\.uid\(\)/.test(body),
      roles: [...new Set([...body.matchAll(/has_company_role\('(\w+)'\)/g)].map((r) => r[1]))],
    });
  }
  return out;
}

function grantedActions(table: Table, grantee: string): Set<Action> {
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

function find(table: Table, action: Action): Policy {
  const p = policies.find((x) => x.table === table && x.action === action);
  if (!p) throw new Error(`missing policy ${table}.${action}`);
  return p;
}

describe("P-227 timesheets — grants", () => {
  it.each(TABLES)("%s grants full CRUD to authenticated only", (table) => {
    expect([...grantedActions(table, "authenticated")].sort()).toEqual([
      "delete",
      "insert",
      "select",
      "update",
    ]);
  });

  it.each(TABLES)("%s grants nothing to anon", (table) => {
    expect(grantedActions(table, "anon").size).toBe(0);
    expect(sql).toContain(`revoke all on public.${table} from anon`);
  });

  it.each(TABLES)("%s has RLS enabled", (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
  });

  it("keeps the numbering counter table out of reach of clients", () => {
    expect(sql).toContain("revoke all on public.timesheet_counters from anon, authenticated");
    expect(grantedActions("timesheets", "service_role").size).toBeGreaterThan(0);
  });
});

describe("P-227 timesheets — cross-tenant isolation", () => {
  it.each(TABLES)("every %s policy is company-scoped", (table) => {
    const rows = policies.filter((p) => p.table === table);
    expect(rows.length).toBe(4);
    for (const p of rows) expect(p.memberScoped).toBe(true);
  });
});

describe("P-227 timesheets — owner vs admin visibility", () => {
  it("timesheets SELECT shows own rows or the four admin roles", () => {
    const p = find("timesheets", "select");
    expect(p.ownerScoped).toBe(true);
    expect(p.roles.sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it("timesheet_entries SELECT joins the parent sheet and keeps owner scoping", () => {
    const p = find("timesheet_entries", "select");
    expect(p.body).toContain("from public.timesheets t");
    expect(p.body).toContain("t.user_id = auth.uid()");
    for (const role of ADMIN_ROLES) expect(p.roles).toContain(role);
  });

  it("leave_requests SELECT shows own rows or admins", () => {
    const p = find("leave_requests", "select");
    expect(p.ownerScoped).toBe(true);
    expect(p.roles.sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it("plain members (engineer, field_technician, client_viewer) match no role branch", () => {
    for (const p of policies) {
      for (const role of ["engineer", "field_technician", "client_viewer", "vendor_viewer"]) {
        expect(p.roles).not.toContain(role);
      }
    }
  });
});

describe("P-227 timesheets — draft gating on entries", () => {
  it("INSERT and DELETE on entries require a draft parent", () => {
    expect(find("timesheet_entries", "insert").body).toContain("t.status = 'draft'");
    expect(find("timesheet_entries", "delete").body).toContain("t.status = 'draft'");
  });

  it("UPDATE on entries is draft-only unless an admin role applies", () => {
    const p = find("timesheet_entries", "update");
    expect(p.body).toContain("t.status = 'draft'");
    expect(p.body).toContain("has_company_role('company_admin')");
  });

  it("a trigger backstops locked sheets on hour fields", () => {
    expect(sql).toContain("create or replace function public.timesheets_guard_locked()");
    expect(sql).toContain("timesheet_locked: parent status %");
    expect(sql).toMatch(
      /create trigger timesheet_entries_guard_locked\s+before insert or update or delete on public\.timesheet_entries/,
    );
    expect(sql).toContain("new.hours is distinct from old.hours");
  });

  it("owners can only self-update timesheets while draft", () => {
    expect(find("timesheets", "update").body).toContain("user_id = auth.uid() and status = 'draft'");
    expect(find("timesheets", "delete").body).toContain("status = 'draft'");
  });
});

describe("P-227 leave requests & balances", () => {
  it("leave_requests INSERT is owner-only and pending-only", () => {
    const p = find("leave_requests", "insert");
    expect(p.ownerScoped).toBe(true);
    expect(p.body).toContain("status = 'pending'");
    expect(p.roles).toEqual([]);
  });

  it("decisions on leave_requests are limited to the four admin roles", () => {
    expect(find("leave_requests", "update").roles.sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it("leave_balances are readable by the owner or admins", () => {
    const p = find("leave_balances", "select");
    expect(p.ownerScoped).toBe(true);
    expect(p.roles.sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it("leave_balances writes are admin-only — a plain member UPDATE is denied", () => {
    const p = find("leave_balances", "update");
    expect(p.ownerScoped).toBe(false);
    expect(p.roles.sort()).toEqual(
      ["company_admin", "construction_admin", "project_admin"].sort(),
    );
    expect(find("leave_balances", "insert").ownerScoped).toBe(false);
  });
});

describe("P-227 schema invariants", () => {
  it("week_start is Monday-only and unique per person per week", () => {
    expect(sql).toContain("check (extract(isodow from week_start) = 1)");
    expect(sql).toContain("constraint timesheets_unique_week unique (company_id, user_id, week_start)");
  });

  it("entry hours are bounded and one slot per day/project/activity", () => {
    expect(sql).toContain("check (hours >= 0 and hours <= 24)");
    expect(sql).toContain(
      "constraint timesheet_entries_unique_slot unique (timesheet_id, work_date, project_id, activity)",
    );
  });

  it("TS-#### and LR-#### numbering fires on insert", () => {
    expect(sql).toContain("'TS-' || lpad(public.next_timesheet_number(new.company_id, 'timesheet')::text, 4, '0')");
    expect(sql).toContain(
      "'LR-' || lpad(public.next_timesheet_number(new.company_id, 'leave_request')::text, 4, '0')",
    );
    expect(sql).toMatch(/create trigger timesheets_number_trg before insert on public\.timesheets/);
    expect(sql).toMatch(/create trigger leave_requests_number_trg before insert on public\.leave_requests/);
  });

  it("the work-package FK is added conditionally via to_regclass", () => {
    expect(sql).toContain("to_regclass('public.construction_work_packages')");
    expect(sql).toContain("timesheet_entries_cwp_fk");
  });

  it("profiles gains the labor-cost fallback rate", () => {
    expect(sql).toContain("alter table public.profiles add column if not exists default_hourly_rate");
  });

  it("all four tables carry set_updated_at triggers", () => {
    for (const table of TABLES) {
      expect(sql).toMatch(
        new RegExp(`create trigger ${table}_updated_at before update on public\\.${table}`),
      );
    }
  });
});
