// GC-09 — live-schema guarantees for portfolio governance (saved views + audit).
// Reads the deployed schema through psql. Skips (never silently passes)
// without managed PG* env vars.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);
const d = HAS_DB ? describe : describe.skip;

const flat = (col: string) => `regexp_replace(coalesce(${col}::text,''), '\\s+', ' ', 'g')`;

function q(sql: string): string[][] {
  return execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

const T = "portfolio_saved_views";

d("portfolio_saved_views — grants and RLS", () => {
  const acl = q(
    `select ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
       from pg_class where relnamespace='public'::regnamespace and relname = '${T}'`,
  )[0]?.[0];

  it("exists with RLS enabled", () => {
    expect(acl).toBeDefined();
    expect(acl!.endsWith("|true")).toBe(true);
  });

  it("grants nothing to anon or PUBLIC", () => {
    expect(acl!).not.toMatch(/\banon=/);
    expect(acl!).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });

  it("grants explicit privileges to authenticated and service_role", () => {
    expect(acl!).toMatch(/authenticated=[a-zA-Z]+\//);
    expect(acl!).toMatch(/service_role=[a-zA-Z]+\//);
  });

  const policies = new Map(
    q(
      `select polname, polcmd::text || '|' || ${flat("pg_get_expr(polqual, polrelid)")} || '|' || ${flat(
        "pg_get_expr(polwithcheck, polrelid)",
      )}
         from pg_policy where polrelid = 'public.${T}'::regclass`,
    ).map(([n, v]) => [n, v!]),
  );

  it("scopes reads to the owner or an explicitly shared company view", () => {
    const p = policies.get(`${T}_select`);
    expect(p).toBeDefined();
    expect(p!).toContain("owner_id = auth.uid()");
    expect(p!).toContain("is_shared");
    expect(p!).toContain("is_company_member(company_id)");
  });

  it("forces inserts to be owned by the caller and inside their company", () => {
    const p = policies.get(`${T}_insert`);
    expect(p).toBeDefined();
    expect(p!).toContain("owner_id = auth.uid()");
    expect(p!).toContain("is_company_member(company_id)");
  });

  it("restricts sharing to finance/company admins on insert and update", () => {
    for (const name of [`${T}_insert`, `${T}_update`]) {
      const p = policies.get(name)!;
      expect(p).toContain("has_company_role('finance_admin'::app_role)");
      expect(p).toContain("has_company_role('company_admin'::app_role)");
    }
  });

  it("has both USING and WITH CHECK on update, owner-scoped", () => {
    const [, using, withCheck] = policies.get(`${T}_update`)!.split("|");
    expect(using).toContain("owner_id = auth.uid()");
    expect(withCheck).toContain("owner_id = auth.uid()");
    expect(withCheck!.length).toBeGreaterThan(0);
  });

  it("lets only the owner delete", () => {
    expect(policies.get(`${T}_delete`)!).toContain("owner_id = auth.uid()");
  });

  it("indexes the owner, company/shared and default lookups", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='${T}'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /owner_id/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, is_shared/.test(i))).toBe(true);
    expect(idx.some((i) => /UNIQUE.*owner_id.*WHERE is_default/is.test(i))).toBe(true);
    expect(idx.some((i) => /UNIQUE.*owner_id.*lower/is.test(i))).toBe(true);
  });

  it("keeps one default per owner", () => {
    const bad = q(
      `select count(*) from (select owner_id from public.${T} where is_default group by owner_id having count(*) > 1) x`,
    )[0]![0];
    expect(bad).toBe("0");
  });

  it("stores configuration as a JSON object only", () => {
    const checks = q(
      `select ${flat("pg_get_constraintdef(oid)")} from pg_constraint
         where conrelid = 'public.${T}'::regclass and contype = 'c'`,
    )
      .map(([c]) => c!)
      .join(" ");
    expect(checks).toContain("jsonb_typeof(config)");
  });

  it("pins the trigger function's search_path and revokes PUBLIC execute", () => {
    const [cfg, acl2] = q(
      `select ${flat("array_to_string(proconfig,' ')")} || '|' || ${flat("proacl")}
         from pg_proc where proname = 'portfolio_saved_views_before_write'`,
    )[0]![0]!.split("|");
    expect(cfg).toContain("search_path=public");
    expect(acl2).not.toMatch(/(^|\{|,)=X\//);
  });
});

d("audit_logs — immutable trail stays finance-readable and indexed", () => {
  it("has no UPDATE or DELETE policy (append-only in practice)", () => {
    const cmds = q(
      `select polcmd from pg_policy where polrelid = 'public.audit_logs'::regclass`,
    ).map(([c]) => c!);
    expect(cmds).not.toContain("w"); // UPDATE
    expect(cmds).not.toContain("d"); // DELETE
  });

  it("grants no anon access", () => {
    const acl = q(
      `select ${flat("array_to_string(relacl,' ')")} from pg_class
         where relnamespace='public'::regnamespace and relname='audit_logs'`,
    )[0]![0]!;
    expect(acl).not.toMatch(/\banon=/);
  });

  it("indexes the principal audit-trail query (company + action + time)", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='audit_logs'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /company_id, action, created_at DESC/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, actor_id, created_at DESC/.test(i))).toBe(true);
    expect(idx.some((i) => /gin \(metadata/.test(i))).toBe(true);
  });

  it("uses an index for the principal filtered query", () => {
    const plan = q(
      `explain (costs off) select id from public.audit_logs
         where company_id = '00000000-0000-0000-0000-000000000000'
           and action = 'costing.forecast_version.approve'
         order by created_at desc limit 50`,
    )
      .map(([p]) => p!)
      .join(" ");
    expect(plan).toMatch(/Index/);
    expect(plan).not.toMatch(/Seq Scan on audit_logs/);
  });
});
