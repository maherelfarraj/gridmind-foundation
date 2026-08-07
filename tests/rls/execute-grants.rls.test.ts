// Regression: internal probe-role EXECUTE grants must never come back, and
// public/anon execution must stay revoked.
//
// The RLS probes intentionally run as the platform's restricted exec role and
// must not rely on any grant to it — earlier grants to that role did not
// persist between platform runs and caused order-dependent failures.
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function psql(sql: string): string[] {
  return execFileSync("psql", ["-At", "-c", sql], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

const TARGETS = [
  "document_history(uuid)",
  "document_current_in_lineage(uuid)",
  "issue_controlled_copy(uuid,uuid,uuid,text,text,text,date)",
];

describe("routine execute grants", () => {
  it("resolves each guarded routine to exactly one signature", () => {
    const found = psql(
      `select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.oid::regprocedure::text in (${TARGETS.map((t) => `'${t}'`).join(",")})`,
    );
    expect(found.sort()).toEqual([...TARGETS].sort());
  });

  it("grants no EXECUTE to the internal probe role on any public routine", () => {
    if (psql("select count(*) from pg_roles where rolname = 'sandbox_exec'")[0] === "0") return;
    const leaked = psql(
      `select p.oid::regprocedure::text from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and has_function_privilege('sandbox_exec', p.oid, 'EXECUTE')
          and array_to_string(coalesce(p.proacl, '{}'), ',') like '%sandbox_exec=X%'`,
    );
    expect(leaked).toEqual([]);
  });

  it("keeps PUBLIC and anon execution revoked on the guarded routines", () => {
    const rows = psql(
      `select p.oid::regprocedure::text || '|' || coalesce(array_to_string(p.proacl, ','), '')
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.oid::regprocedure::text in (${TARGETS.map((t) => `'${t}'`).join(",")})`,
    );
    expect(rows).toHaveLength(TARGETS.length);
    for (const row of rows) {
      expect(row, "anon execute").not.toMatch(/(^|,)anon=X/);
      expect(row, "PUBLIC execute").not.toMatch(/(,|\|)=X\//);
      expect(row, "authenticated execute").toContain("authenticated=X");
    }
  });
});
