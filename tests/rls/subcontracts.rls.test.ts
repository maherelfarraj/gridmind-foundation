// P-262 — Subcontract module RLS: static policy shape (live schema, via psql)
// plus live cross-tenant / cross-sub probes against a throw-away fixture.
//
// The five tables of the module:
//   subcontracts · subcontract_lines · subcontract_claims ·
//   subcontract_claim_lines · subcontract_retention_releases
//
// Doctrine proved here (Batch 34 reference for future external-party modules):
//   1. every client-facing policy is company-scoped   → cross-tenant isolation
//   2. anon holds no privileges                        → no unauthenticated read
//   3. external viewers are excluded from raw tables   → subs read via definers
//   4. writes are role-gated                           → engineers cannot write
//   5. the certified status is engine-owned            → manual writes rejected
//   6. subs reach their own rows only through the portal definers

import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";
import {
  attachMember,
  anonClient,
  createTenant,
  createUser,
  isSupabaseUp,
  rpc,
  serviceClient,
  setupSubcontractFixture,
  type SubcontractFixture,
} from "../subcontracts/fixtures";

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

const TABLES = [
  "subcontracts",
  "subcontract_lines",
  "subcontract_claims",
  "subcontract_claim_lines",
  "subcontract_retention_releases",
] as const;
const TABLE_LIST = TABLES.map((t) => `'${t}'`).join(",");

const COMPANY_SCOPE =
  /is_company_member\(|is_company_admin\(|has_company_role\(|company_id\s*=|company_id\s+IN|company_id\s+in\s*\(/;

describe.skipIf(!HAS_DB)("P-262 · subcontract tables — policy shape (live schema)", () => {
  const policies = q(
    `select tablename, policyname, cmd,
            replace(coalesce(qual,'')||' '||coalesce(with_check,''), chr(10), ' '), roles::text
       from pg_policies
      where schemaname='public' and tablename in (${TABLE_LIST})
      order by 1,2`,
  ).map(([table, name, cmd, expr, roles]) => ({ table, name, cmd, expr, roles }));

  it("all five tables exist with RLS enabled and at least one policy each", () => {
    const rows = q(
      `select cl.relname, cl.relrowsecurity::text
         from pg_class cl join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
        where cl.relkind='r' and cl.relname in (${TABLE_LIST})`,
    );
    expect(rows.map(([name]) => name).sort()).toEqual([...TABLES].sort());
    expect(rows.filter(([, rls]) => !/^t/.test(rls))).toEqual([]);
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

  it("no policy grants raw table access to external portal viewers", () => {
    const offenders = policies
      .filter(
        (p) =>
          /portal_memberships|sub_portal_has_seat\(/.test(p.expr) ||
          /(^|\bOR\s+|\(\s*)is_external_viewer\(\)/.test(
            p.expr.replace(/NOT\s+is_external_viewer\(\)/g, ""),
          ),
      )
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `external viewer reachable directly:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every write policy is role-gated, not merely membership-gated", () => {
    const offenders = policies
      .filter((p) => /INSERT|UPDATE|DELETE|ALL/i.test(p.cmd))
      .filter((p) => !/has_company_role\(|is_company_admin\(/.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `write policy without a role gate:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("anon holds no privileges on any of the five tables", () => {
    const grants = q(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema='public' and grantee='anon' and table_name in (${TABLE_LIST})`,
    ).map((r) => r.join("."));
    expect(grants, `anon grants:\n${grants.join("\n")}`).toEqual([]);
  });

  it("the certified state is engine-owned (guard trigger + settle path)", () => {
    const [[guard]] = q(
      `select replace(pg_get_functiondef(p.oid), chr(10), ' ') from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname='subcontract_claims_guard_status'`,
    );
    expect(guard).toMatch(/subcontract_claim_engine_only/);
    expect(guard).toMatch(/gridmind\.approval_settle/);

    const [[settle]] = q(
      `select replace(pg_get_functiondef(p.oid), chr(10), ' ') from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname='settle_derived_entity'`,
    );
    expect(settle).toMatch(/subcontract_claim/);
    expect(settle).toMatch(/sub_claim_generate_ap_invoice/);
  });

  it("the sub portal paths are SECURITY DEFINER with a pinned search_path", () => {
    const rows = q(
      `select p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),'')
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname in ('sub_portal_list_subcontracts','sub_portal_get_subcontract',
                            'sub_portal_get_claim','sub_portal_submit_claim',
                            'sub_portal_has_seat','subcontract_release_retention')`,
    );
    expect(rows).toHaveLength(6);
    for (const [name, secdef, cfg] of rows) {
      expect(secdef, `${name} is not SECURITY DEFINER`).toMatch(/^t/);
      expect(cfg, `${name} has a mutable search_path`).toMatch(/search_path/);
    }
  });
});

// ---------------------------------------------------------------------------
// Live probes
// ---------------------------------------------------------------------------
const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

d("P-262 · subcontract tables — live isolation probes", () => {
  let fx: SubcontractFixture;
  let other: Awaited<ReturnType<typeof createUser>> & { companyId: string };

  beforeAll(async () => {
    fx = await setupSubcontractFixture();
    const svc = serviceClient();
    const companyId = await createTenant(svc, "other");
    const user = await createUser(svc, "p262-other");
    await attachMember(svc, user.userId, user.email, companyId, ["company_admin"]);
    other = { ...user, companyId };
  }, 180_000);

  afterAll(async () => {
    const svc = serviceClient();
    if (other) {
      await purgeFixtureTenants(svc, [other.companyId]);
      await deleteFixtureUsers(svc, [other.userId]);
    }
    await fx?.cleanup();
  }, 180_000);

  it("a foreign tenant's admin reads nothing from any of the five tables", async () => {
    for (const table of TABLES) {
      const { data, error } = await other.client.from(table as never).select("id");
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect((data ?? []).length, `${table} leaked rows cross-tenant`).toBe(0);
    }
  });

  it("a foreign tenant's admin cannot write into the fixture tenant", async () => {
    const { error } = await other.client.from("subcontract_lines").insert({
      company_id: fx.companyId,
      subcontract_id: fx.subA.id,
      line_no: 99,
      description: "cross-tenant insert",
      qty: 1,
      unit_price: 1,
    } as never);
    expect(error).not.toBeNull();
  });

  it("an external viewer (portal seat) reads nothing from the raw tables", async () => {
    for (const table of TABLES) {
      const { data } = await fx.subUserA.client.from(table as never).select("id");
      expect((data ?? []).length, `${table} exposed to an external viewer`).toBe(0);
    }
  });

  it("sub A reaches its own subcontract through the portal definer", async () => {
    const { data, error } = await rpc(fx.subUserA.client)("sub_portal_list_subcontracts", {
      p_vendor_id: fx.vendorA,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as { id: string }[];
    expect(rows.map((r) => r.id)).toContain(fx.subA.id);
  });

  it("sub A is denied on sub B's subcontract, claim and vendor id", async () => {
    const denials = await Promise.all([
      rpc(fx.subUserA.client)("sub_portal_get_subcontract", { p_subcontract_id: fx.subB.id }),
      rpc(fx.subUserA.client)("sub_portal_get_claim", { p_claim_id: fx.subB.claimId }),
      rpc(fx.subUserA.client)("sub_portal_list_subcontracts", { p_vendor_id: fx.vendorB }),
    ]);
    for (const { error } of denials) {
      expect(error?.message ?? "", "cross-sub access was not denied").toMatch(
        /vendor_portal_access_denied/,
      );
    }
  });

  it("sub B cannot submit a claim against sub A's subcontract", async () => {
    const { error } = await rpc(fx.subUserB.client)("sub_portal_submit_claim", {
      p_subcontract_id: fx.subA.id,
      p_period_start: "2026-07-01",
      p_period_end: "2026-07-31",
      p_lines: [],
      p_note: null,
    });
    expect(error?.message ?? "").toMatch(/vendor_portal_access_denied/);
  });

  it("anon reads nothing and writes nothing", async () => {
    const anon = anonClient();
    for (const table of TABLES) {
      const { data } = await anon.from(table as never).select("id");
      expect((data ?? []).length, `${table} readable by anon`).toBe(0);
    }
    const { error } = await anon.from("subcontracts").insert({
      company_id: fx.companyId,
      project_id: fx.projectId,
      vendor_id: fx.vendorA,
      title: "anon",
      contract_value: 1,
      currency_code: "USD",
    } as never);
    expect(error).not.toBeNull();
  });

  it("an internal engineer may read but not write a subcontract", async () => {
    const { data } = await fx.engineer.client.from("subcontracts").select("id");
    expect(((data ?? []) as { id: string }[]).map((r) => r.id)).toContain(fx.subA.id);

    await fx.engineer.client
      .from("subcontracts")
      .update({ title: "engineer rename" })
      .eq("id", fx.subA.id);
    const { data: after } = await fx.svc
      .from("subcontracts")
      .select("title")
      .eq("id", fx.subA.id)
      .single();
    expect((after as { title: string }).title).not.toBe("engineer rename");
  });

  it("the certified status is frozen against manual writes (engine-only)", async () => {
    const { error } = await fx.svc
      .from("subcontract_claims")
      .update({ status: "certified" })
      .eq("id", fx.subB.claimId);
    expect(error?.message ?? "").toMatch(/subcontract_claim_engine_only/);
  });
});
