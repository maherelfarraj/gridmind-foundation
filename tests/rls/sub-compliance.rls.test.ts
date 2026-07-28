// P-260 — Compliance + scorecard RLS, read from the LIVE schema via psql.
//
//   1. subcontract_compliance_docs and subcontract_scorecards are tenant tables
//      with RLS on and every client-facing policy company-scoped.
//   2. Subs never read these tables directly — their access is the two
//      SECURITY DEFINER portal routines, which self-scope by seat.
//   3. The claim hard gate and the expiry sweep exist in the live schema.
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

const TABLES = ["subcontract_compliance_docs", "subcontract_scorecards"];
const TABLE_LIST = TABLES.map((t) => `'${t}'`).join(",");

const COMPANY_SCOPE =
  /is_company_member\(|is_company_admin\(|has_company_role\(|\(company_id\)|company_id\s*=|company_id\s+IN|company_id\s+in\s*\(/;

describe.skipIf(!HAS_DB)("sub compliance + scorecards — RLS (live schema)", () => {
  const policies = q(
    `select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,''), roles::text
       from pg_policies
      where schemaname='public' and tablename in (${TABLE_LIST})
      order by 1,2`,
  ).map(([table, name, cmd, expr, roles]) => ({ table, name, cmd, expr, roles }));

  it("both tables exist with RLS enabled and at least one policy", () => {
    const rows = q(
      `select cl.relname, cl.relrowsecurity::text
         from pg_class cl join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
        where cl.relkind='r' and cl.relname in (${TABLE_LIST})`,
    );
    expect(rows.map(([n]) => n).sort()).toEqual([...TABLES].sort());
    expect(rows.filter(([, rls]) => rls !== "t" && rls !== "true")).toEqual([]);
    for (const t of TABLES) {
      expect(policies.filter((p) => p.table === t).length, `${t} has no policies`).toBeGreaterThan(
        0,
      );
    }
  });

  it("every client-facing policy is company-scoped (cross-tenant isolation)", () => {
    const offenders = policies
      .filter((p) => /anon|authenticated|public/.test(p.roles) && !COMPANY_SCOPE.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `unscoped policy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no policy exposes compliance or scores to external portal viewers (cross-sub isolation)", () => {
    const offenders = policies
      // Excluding external viewers (NOT is_external_viewer()) is the correct
      // shape; only a GRANTING reference is an offender.
      .filter(
        (p) =>
          /portal_memberships|sub_portal_has_seat\(/.test(p.expr) ||
          /(^|[^T]\bOR\s+|\(\s*)is_external_viewer\(\)/.test(
            p.expr.replace(/NOT\s+is_external_viewer\(\)/g, ""),
          ),
      )
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `external viewer reachable directly:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("anon holds no privileges on either table", () => {
    const grants = q(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema='public' and grantee='anon' and table_name in (${TABLE_LIST})`,
    ).map((r) => r.join("."));
    expect(grants, `anon grants:\n${grants.join("\n")}`).toEqual([]);
  });

  it("portal read paths are SECURITY DEFINER routines pinned to a safe search_path", () => {
    const rows = q(
      `select p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),'')
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname in ('sub_portal_list_compliance','sub_portal_get_scorecard',
                            'sub_compliance_gate','sub_compliance_expiry_sweep')`,
    );
    const byName = new Map(rows.map(([name, secdef, cfg]) => [name, { secdef, cfg }]));
    for (const fn of [
      "sub_portal_list_compliance",
      "sub_portal_get_scorecard",
      "sub_compliance_gate",
      "sub_compliance_expiry_sweep",
    ]) {
      const found = byName.get(fn);
      expect(found, `${fn} missing from live schema`).toBeTruthy();
      expect(found!.secdef, `${fn} is not SECURITY DEFINER`).toMatch(/^t/);
      expect(found!.cfg, `${fn} has a mutable search_path`).toMatch(/search_path/);
    }
  });

  it("the portal routines scope to the caller's seat rather than trusting the argument", () => {
    const [[src]] = q(
      `select replace(string_agg(pg_get_functiondef(p.oid), ' '), chr(10), ' ')
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname in ('sub_portal_list_compliance','sub_portal_get_scorecard')`,
    );
    // Company + vendor are resolved from the caller's ACTIVE portal seat; the
    // argument alone can never widen the read to another sub.
    expect(src).toMatch(/vendor_portal_memberships/);
    expect(src).toMatch(/auth\.uid\(\)/);
    expect(src).toMatch(/vendor_portal_access_denied/);
  });

  it("the expired-insurance hard gate is enforced by a trigger on subcontract_claims", () => {
    const trg = q(
      `select t.tgname, p.proname
         from pg_trigger t
         join pg_class c on c.oid=t.tgrelid and c.relname='subcontract_claims'
         join pg_proc p on p.oid=t.tgfoid
        where not t.tgisinternal`,
    );
    expect(
      trg.map(([, fn]) => fn),
      `claims triggers: ${JSON.stringify(trg)}`,
    ).toContain("subcontract_claims_compliance_guard");
  });

  it("status is derived by trigger, never trusted from the client", () => {
    const trg = q(
      `select p.proname
         from pg_trigger t
         join pg_class c on c.oid=t.tgrelid and c.relname='subcontract_compliance_docs'
         join pg_proc p on p.oid=t.tgfoid
        where not t.tgisinternal`,
    ).map(([fn]) => fn);
    expect(trg).toContain("subcontract_compliance_docs_derive");
  });

  it("alerts are fingerprint-deduped by a unique index (no double-crying)", () => {
    const idx = q(
      `select indexdef from pg_indexes
        where schemaname='public' and indexdef ilike '%compliance_fingerprint%'`,
    ).map(([d]) => d);
    expect(
      idx.some((d) => /unique/i.test(d)),
      `indexes:\n${idx.join("\n")}`,
    ).toBe(true);
  });
});
