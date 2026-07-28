// P-238 — Receiving-cycle RLS guards, read from the LIVE schema via psql.
//
//   1. goods_receipts, three_way_matches and batch_serial_tracking are tenant
//      tables with RLS on and every client-facing policy company-scoped.
//   2. No policy on the match internals grants external viewers (vendor
//      portal accounts) read access — vendors see their PO, never the match.
//
// Skips (does not silently pass) without managed PG* env vars.

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);

function q(sql: string): string[][] {
  const out = execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

const RECEIVING_TABLES = ["goods_receipts", "three_way_matches", "batch_serial_tracking"];

const COMPANY_SCOPE =
  /is_company_member\(|is_company_admin\(|\(company_id\)|company_id\s*=|company_id\s+IN|company_id\s+in\s*\(/;

describe.skipIf(!HAS_DB)("receiving cycle — RLS isolation (live schema)", () => {
  const policies = q(
    `select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,''), roles::text
       from pg_policies
      where schemaname='public'
        and tablename in ('goods_receipts','three_way_matches','batch_serial_tracking')
      order by 1,2`,
  ).map(([table, name, cmd, expr, roles]) => ({ table, name, cmd, expr, roles }));

  it("all three receiving tables have RLS enabled and at least one policy", () => {
    const rows = q(
      `select cl.relname, cl.relrowsecurity::text
         from pg_class cl join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
        where cl.relkind='r' and cl.relname in ('goods_receipts','three_way_matches','batch_serial_tracking')`,
    );
    expect(rows.map(([n]) => n).sort()).toEqual([...RECEIVING_TABLES].sort());
    expect(rows.filter(([, rls]) => rls !== "t" && rls !== "true")).toEqual([]);
    for (const t of RECEIVING_TABLES) {
      expect(policies.filter((p) => p.table === t).length, `${t} has no policies`).toBeGreaterThan(
        0,
      );
    }
  });

  it("every client-facing receiving policy is company-scoped (cross-tenant GRN isolation)", () => {
    const offenders = policies
      .filter((p) => /anon|authenticated|public/.test(p.roles) && !COMPANY_SCOPE.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `unscoped receiving policy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no receiving policy opens match internals to external (vendor) viewers", () => {
    const offenders = policies
      .filter((p) => /is_external_viewer\(|portal_memberships|vendor_viewer/.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(
      offenders,
      `external viewer reachable on receiving internals:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("anon holds no privileges on the receiving tables", () => {
    const grants = q(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema='public' and grantee='anon'
          and table_name in ('goods_receipts','three_way_matches','batch_serial_tracking')`,
    ).map((r) => r.join("."));
    expect(grants, `anon grants:\n${grants.join("\n")}`).toEqual([]);
  });

  it("batch_serial_tracking carries the GRN traceability link", () => {
    const cols = q(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='batch_serial_tracking'
          and column_name in ('grn_id','grn_line_no')`,
    ).map(([c]) => c);
    expect(cols.sort()).toEqual(["grn_id", "grn_line_no"]);
  });

  it("goods_receipts stores the GPS receipt stamp", () => {
    const cols = q(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='goods_receipts'
          and column_name like 'receipt_%'`,
    ).map(([c]) => c);
    expect(cols.sort()).toEqual([
      "receipt_accuracy_m",
      "receipt_geo_at",
      "receipt_lat",
      "receipt_lng",
    ]);
  });
});
