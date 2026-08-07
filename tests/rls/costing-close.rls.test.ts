// GC-03/04/05 — live-schema guarantees for the finance-close bundle.
// Reads the deployed schema through psql. Skips (never silently passes)
// without managed PG* env vars.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);
const d = HAS_DB ? describe : describe.skip;

function q(sql: string): string[][] {
  return execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

const TABLES = [
  "costing_settings",
  "costing_periods",
  "forecast_versions",
  "forecast_version_lines",
  "cost_accruals",
  "cost_forecast_periods",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

d("finance-close tables — grants and RLS", () => {
  const acl = new Map(
    q(
      `select relname, coalesce(array_to_string(relacl,' '),'') || '|' || relrowsecurity
         from pg_class where relnamespace='public'::regnamespace and relname in (${list})`,
    ).map(([n, v]) => [n, v]),
  );

  it.each(TABLES)("%s exists with RLS enabled", (t) => {
    expect(acl.get(t)).toBeDefined();
    expect(acl.get(t)!.endsWith("|t")).toBe(true);
  });

  it.each(TABLES)("%s grants nothing to anon or PUBLIC", (t) => {
    const grants = acl.get(t)!;
    expect(grants).not.toMatch(/\banon=/);
    // A bare "=priv/owner" entry is the PUBLIC grant.
    expect(grants).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });

  it.each(TABLES)("%s grants explicit privileges to authenticated and service_role", (t) => {
    expect(acl.get(t)!).toMatch(/authenticated=[a-zA-Z]+\//);
    expect(acl.get(t)!).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps period state changes out of direct writes (RPC-only)", () => {
    // authenticated may read costing_periods but not write it; transitions go
    // through transition_costing_period(), which enforces role + state machine.
    const grants = acl.get("costing_periods")!;
    expect(grants).toMatch(/authenticated=r\//);
  });

  it("makes frozen snapshot lines un-updatable", () => {
    // no 'w' privilege and no UPDATE policy => an approved snapshot is immutable
    expect(acl.get("forecast_version_lines")!).not.toMatch(/authenticated=[a-v x-z]*w/);
    const cmds = q(
      `select cmd from pg_policies where schemaname='public' and tablename='forecast_version_lines'`,
    ).map(([c]) => c);
    expect(cmds).not.toContain("UPDATE");
  });

  it("never allows deleting a forecast version", () => {
    expect(acl.get("forecast_versions")!).not.toMatch(/authenticated=[a-z]*d/);
  });
});

d("finance-close tables — policy shape", () => {
  const policies = q(
    `select tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'')
       from pg_policies where schemaname='public' and tablename in (${list})`,
  ).map(([table, name, cmd, qual, check]) => ({ table, name, cmd, qual, check }));

  it.each(TABLES)("%s scopes every policy to the caller's company", (t) => {
    const rows = policies.filter((p) => p.table === t);
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      expect(`${p.qual} ${p.check}`).toMatch(/is_company_member\(company_id\)/);
    }
  });

  it.each(TABLES)("%s exposes a SELECT policy", (t) => {
    expect(policies.filter((p) => p.table === t).some((p) => ["SELECT", "ALL"].includes(p.cmd))).toBe(
      true,
    );
  });

  it("gives every UPDATE policy both a USING and a WITH CHECK clause", () => {
    const updates = policies.filter((p) => p.cmd === "UPDATE" || p.cmd === "ALL");
    expect(updates.length).toBeGreaterThan(0);
    for (const p of updates) {
      expect(p.qual.trim(), `${p.table}.${p.name} USING`).not.toBe("");
      expect(p.check.trim(), `${p.table}.${p.name} WITH CHECK`).not.toBe("");
    }
  });

  it("restricts writes to finance/project/company admins", () => {
    const writes = policies.filter((p) => ["INSERT", "UPDATE", "DELETE", "ALL"].includes(p.cmd));
    for (const p of writes) {
      expect(`${p.qual} ${p.check}`, `${p.table}.${p.name}`).toMatch(/has_company_role\(/);
    }
  });

  it("ties a snapshot line to a working version in the SAME company (GC-05)", () => {
    const fvl = policies.filter(
      (p) => p.table === "forecast_version_lines" && p.cmd !== "SELECT",
    );
    expect(fvl.length).toBe(2);
    for (const p of fvl) {
      const expr = `${p.qual} ${p.check}`;
      expect(expr).toMatch(/v\.company_id = forecast_version_lines\.company_id/);
      expect(expr).not.toMatch(/v\.company_id = v\.company_id/);
      expect(expr).toMatch(/v\.status = 'working'::forecast_version_status/);
    }
  });
});

d("finance-close — concurrency and lookup indexes", () => {
  const idx = q(
    `select indexdef from pg_indexes where schemaname='public' and tablename in (${list})`,
  ).map(([s]) => s);
  const has = (re: RegExp) => idx.some((s) => re.test(s));

  it("allows at most one costing period row per company month and per project month", () => {
    expect(has(/UNIQUE INDEX .*costing_periods .*\(company_id, period_month\).*project_id IS NULL/s)).toBe(
      true,
    );
    expect(
      has(/UNIQUE INDEX .*costing_periods .*\(project_id, period_month\).*project_id IS NOT NULL/s),
    ).toBe(true);
  });

  it("allows at most one approved forecast version per project period", () => {
    expect(has(/UNIQUE INDEX forecast_versions_one_approved .*status = 'approved'/s)).toBe(true);
  });

  it("numbers versions uniquely within a project period", () => {
    expect(has(/UNIQUE INDEX .*\(project_id, reporting_period, version_no\)/)).toBe(true);
  });

  it("allows an accrual to be reversed at most once", () => {
    expect(has(/UNIQUE INDEX .*cost_accruals .*\(reverses_accrual_id\)/)).toBe(true);
  });

  it("indexes the period lookups the close dashboard runs", () => {
    expect(has(/costing_periods_lookup_idx/)).toBe(true);
    expect(has(/forecast_versions_lookup_idx/)).toBe(true);
    expect(has(/cost_accruals_project_period_idx/)).toBe(true);
  });
});

d("finance-close — enforcement functions", () => {
  const fns = new Map(
    q(
      `select p.proname,
              p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig,','),'') || '|' ||
              coalesce(array_to_string(p.proacl,' '),'PUBLIC')
         from pg_proc p
        where p.pronamespace='public'::regnamespace
          and p.proname in ('assert_costing_period_open','costing_period_state',
                            'transition_costing_period','approve_forecast_version')`,
    ).map(([n, v]) => [n, v]),
  );

  it.each([
    "assert_costing_period_open",
    "costing_period_state",
    "transition_costing_period",
    "approve_forecast_version",
  ])("%s is a pinned security-definer function that anon cannot execute", (name) => {
    const v = fns.get(name);
    expect(v, `${name} missing`).toBeDefined();
    const [secdef, config, aclStr] = v!.split("|");
    expect(secdef).toBe("true");
    expect(config).toMatch(/search_path=/);
    expect(aclStr).not.toBe("PUBLIC");
    expect(aclStr).not.toMatch(/\banon=/);
    expect(aclStr).toMatch(/authenticated=X/);
  });

  it("guards costing rows with a database-side period trigger", () => {
    const triggers = q(
      `select c.relname || '.' || t.tgname
         from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where not t.tgisinternal and c.relname in ('cost_accruals','cost_forecast_periods')`,
    ).map(([s]) => s);
    expect(triggers).toContain("cost_accruals.cost_accruals_period_guard");
    expect(triggers).toContain("cost_forecast_periods.cost_forecast_periods_period_guard");
  });
});
