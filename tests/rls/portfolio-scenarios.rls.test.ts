// GC-11 — live-schema guarantees for portfolio scenario forecasting.
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

const TABLES = [
  "portfolio_scenarios",
  "portfolio_scenario_assumptions",
  "portfolio_scenario_events",
] as const;

function acl(table: string): string {
  return (
    q(
      `select ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class where relnamespace='public'::regnamespace and relname = '${table}'`,
    )[0]?.[0] ?? ""
  );
}

function policies(table: string): Map<string, { cmd: string; using: string; check: string }> {
  const out = new Map<string, { cmd: string; using: string; check: string }>();
  for (const [row] of q(
    `select polname || '\u0002' || polcmd::text || '\u0002' || ${flat("pg_get_expr(polqual, polrelid)")}
            || '\u0002' || ${flat("pg_get_expr(polwithcheck, polrelid)")}
       from pg_policy where polrelid = 'public.${table}'::regclass`,
  )) {
    const [name, cmd, using, check] = row!.split("\u0002");
    out.set(name!, { cmd: cmd!, using: using!, check: check! });
  }
  return out;
}

d("portfolio scenario tables — grants and RLS", () => {
  for (const table of TABLES) {
    it(`${table} exists with RLS enabled`, () => {
      expect(acl(table).endsWith("|true")).toBe(true);
    });

    it(`${table} grants nothing to anon or PUBLIC`, () => {
      const a = acl(table);
      expect(a).not.toMatch(/\banon=/);
      expect(a).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
    });

    it(`${table} has at least one policy`, () => {
      expect(policies(table).size).toBeGreaterThan(0);
    });
  }

  it("scenario history is append-only for app users", () => {
    const a = acl("portfolio_scenario_events");
    const authenticated = a.split(" ").find((g) => g.startsWith("authenticated=")) ?? "";
    expect(authenticated).toMatch(/^authenticated=ar\//);
  });

  it("every scenario policy is company-scoped", () => {
    for (const [, p] of policies("portfolio_scenarios")) {
      expect(`${p.using} ${p.check}`).toMatch(/is_company_member/);
    }
  });

  it("scenario writes require a finance or company admin role", () => {
    const insert = policies("portfolio_scenarios").get("psc_insert")!;
    expect(insert.check).toMatch(/finance_admin/);
    expect(insert.check).toMatch(/company_admin/);
    expect(insert.check).toMatch(/owner_id = auth\.uid\(\)/);
  });

  it("only draft scenarios owned by the caller can be deleted", () => {
    const del = policies("portfolio_scenarios").get("psc_delete")!;
    expect(del.using).toMatch(/owner_id = auth\.uid\(\)/);
    expect(del.using).toMatch(/draft/);
  });

  it("assumption writes are gated on a draft parent scenario", () => {
    const write = policies("portfolio_scenario_assumptions").get("psa_write")!;
    expect(write.using).toMatch(/draft/);
    expect(write.check).toMatch(/draft/);
    expect(write.check).toMatch(/company_id = /);
  });

  it("guard triggers exist on scenarios and assumptions", () => {
    const triggers = q(
      `select tgname from pg_trigger
        where tgrelid in ('public.portfolio_scenarios'::regclass,
                          'public.portfolio_scenario_assumptions'::regclass)
          and not tgisinternal`,
    ).map((r) => r[0]);
    expect(triggers).toContain("trg_psc_guard");
    expect(triggers).toContain("trg_psa_guard");
  });

  it("definer guard routines pin search_path and are not public", () => {
    const [row] = q(
      `select p.proname || '|' || coalesce(array_to_string(p.proconfig,','),'')
              || '|' || ${flat("array_to_string(p.proacl,' ')")}
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'portfolio_scenario_assumptions_guard'`,
    );
    expect(row?.[0]).toMatch(/search_path=public/);
    expect(row?.[0]).not.toMatch(/\banon=/);
  });

  it("no scenario table can reach approved forecast rows through a policy", () => {
    for (const table of TABLES) {
      for (const [, p] of policies(table)) {
        expect(`${p.using} ${p.check}`).not.toMatch(/forecast_version/);
      }
    }
  });
});
