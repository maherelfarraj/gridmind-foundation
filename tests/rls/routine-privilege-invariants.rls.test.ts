import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * GC-18 least-privilege regression guards.
 *
 * These invariants encode the advisor remediation performed in GC-18:
 *  - no SECURITY DEFINER routine in `public` may be callable by `anon`;
 *  - no trigger routine may be directly callable by `anon`/`authenticated`
 *    (triggers fire under the table owner, never the caller's EXECUTE right);
 *  - every SECURITY DEFINER routine must pin `search_path`.
 */

const SESSION_GUARDS = "-c statement_timeout=120000 -c lock_timeout=15000";

function q(sql: string): string[] {
  const out = execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ""} ${SESSION_GUARDS}`.trim() },
  });
  return out.split("\n").filter((l) => l.trim() !== "");
}

describe("GC-18 routine privilege invariants", () => {
  it("no SECURITY DEFINER routine in public is executable by anon", () => {
    const offenders = q(`
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'execute')
      order by 1;`);
    expect(offenders).toEqual([]);
  });

  it("no trigger routine in public is directly executable by anon or authenticated", () => {
    const offenders = q(`
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))
      order by 1;`);
    expect(offenders).toEqual([]);
  });

  it("every SECURITY DEFINER routine in public pins search_path", () => {
    const offenders = q(`
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
          where cfg like 'search_path=%')
      order by 1;`);
    expect(offenders).toEqual([]);
  });

  it("every tenant table exposing company_id has an index leading on company_id", () => {
    const offenders = q(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.oid and i.indkey[0] = a.attnum)
      order by 1;`);
    expect(offenders).toEqual([]);
  });
});
