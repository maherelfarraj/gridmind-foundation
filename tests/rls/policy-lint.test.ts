// Policy lint — structural RLS guard against the cross-tenant hole class.
//
// Reads the LIVE schema (pg_policies + information_schema) through psql and
// fails on three rules:
//
//   R1  a policy that gates on a role check (has_company_role / has_role)
//       WITHOUT any row-level company scope on the same table.
//   R2  a policy on a tenant table (table has company_id) that carries no
//       company scope at all — unless it is an own-row policy or a deny-all.
//   R3  a tenant table with RLS disabled, or with zero policies while still
//       granting privileges to anon/authenticated.
//
// Requires managed PG* env vars. Skips (does not silently pass) without them.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);

function q(sql: string): string[][] {
  const out = execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

/** Row-level company scoping: member/admin helpers, any fn(company_id), or a direct predicate. */
const COMPANY_SCOPE =
  /is_company_member\(|is_company_admin\(|\(company_id\)|company_id\s*=|company_id\s+IN|company_id\s+in\s*\(/;

/** Role gates that are NOT row-scoped on their own. */
const ROLE_CHECK = /has_company_role\(|has_role\(/;

/** Own-row ownership predicates — legitimately outside company scoping. */
const OWN_ROW = /\b\w*(?:user_id|_by|_id)\s*=\s*auth\.uid\(\)|\bid\s*=\s*auth\.uid\(\)/;

/** Deny-all policies (service-role only surfaces). */
const DENY_ALL = /\(\s*false\s*\)|^\s*false\s*$/;

interface Policy {
  table: string;
  name: string;
  cmd: string;
  expr: string;
}

const policies: Policy[] = HAS_DB
  ? q(
      `select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,'')
       from pg_policies where schemaname='public' order by 1,2`,
    ).map(([table, name, cmd, expr]) => ({ table, name, cmd, expr }))
  : [];

const tenantTables: string[] = HAS_DB
  ? q(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t
         on t.table_schema='public' and t.table_name=c.table_name and t.table_type='BASE TABLE'
       where c.table_schema='public' and c.column_name='company_id' order by 1`,
    ).map(([t]) => t)
  : [];

const tenantSet = new Set(tenantTables);

describe.skipIf(!HAS_DB)("RLS policy lint (live schema)", () => {
  it("R1: no role check without a row-level company scope on a tenant table", () => {
    const offenders = policies
      .filter(
        (p) =>
          tenantSet.has(p.table) && ROLE_CHECK.test(p.expr) && !COMPANY_SCOPE.test(p.expr),
      )
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `role check without company scope:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("R2: every tenant-table policy carries company scope, own-row scope, or denies all", () => {
    const offenders = policies
      .filter(
        (p) =>
          tenantSet.has(p.table) &&
          !COMPANY_SCOPE.test(p.expr) &&
          !OWN_ROW.test(p.expr) &&
          !DENY_ALL.test(p.expr),
      )
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `unscoped tenant policy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("R3: every tenant table has RLS enabled and is not reachable without policies", () => {
    const rows = q(
      `select cl.relname, cl.relrowsecurity::text,
              (select count(*) from pg_policies pp
                where pp.schemaname='public' and pp.tablename=cl.relname)::text,
              (select count(*) from information_schema.role_table_grants g
                where g.table_schema='public' and g.table_name=cl.relname
                  and g.grantee in ('anon','authenticated'))::text
       from pg_class cl
       join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
       where cl.relkind='r' order by 1`,
    );
    const offenders: string[] = [];
    for (const [name, rls, policyCount, grantCount] of rows) {
      if (!tenantSet.has(name)) continue;
      if (rls !== "t") offenders.push(`${name}: RLS disabled`);
      else if (policyCount === "0" && grantCount !== "0")
        offenders.push(`${name}: zero policies but granted to anon/authenticated`);
    }
    expect(offenders, `tenant table exposure:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("lints a non-trivial live surface (sanity)", () => {
    expect(policies.length).toBeGreaterThan(100);
    expect(tenantTables.length).toBeGreaterThan(50);
  });
});
