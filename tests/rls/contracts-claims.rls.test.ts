// GC-16 — live-schema guarantees for the contract & claims bundle.
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
  "contract_claims",
  "contract_claim_events",
  "contract_claim_valuations",
  "contract_deadlines",
  "contract_claim_snapshots",
  "contract_claim_snapshot_lines",
  "contract_claim_alerts",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

d("contracts & claims tables — grants and RLS", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class where relnamespace='public'::regnamespace and relname in (${list})`,
    ).map(([n, v]) => [n, v]),
  );

  it.each(TABLES)("%s exists with RLS enabled", (t) => {
    expect(acl.get(t)).toBeDefined();
    expect(acl.get(t)!.endsWith("|true")).toBe(true);
  });

  it.each(TABLES)("%s grants nothing to anon or PUBLIC", (t) => {
    const grants = acl.get(t)!;
    expect(grants).not.toMatch(/\banon=/);
    expect(grants).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });

  it.each(TABLES)("%s grants explicit privileges to authenticated and service_role", (t) => {
    expect(acl.get(t)!).toMatch(/authenticated=[a-zA-Z]+\//);
    expect(acl.get(t)!).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps the claim event log append-only for authenticated callers", () => {
    const grants = acl.get("contract_claim_events")!;
    expect(grants).not.toMatch(/authenticated=[a-v x-z]*w/);
    expect(grants).not.toMatch(/authenticated=[a-z]*d/);
    const cmds = q(
      `select cmd from pg_policies where schemaname='public' and tablename='contract_claim_events'`,
    ).map(([c]) => c);
    expect(cmds).not.toContain("UPDATE");
    expect(cmds).not.toContain("DELETE");
  });

  it("makes snapshot line values immutable (no UPDATE privilege)", () => {
    expect(acl.get("contract_claim_snapshot_lines")!).not.toMatch(/authenticated=[a-v x-z]*w/);
  });

  it("keeps claim valuations append-only", () => {
    const grants = acl.get("contract_claim_valuations")!;
    expect(grants).not.toMatch(/authenticated=[a-v x-z]*w/);
    expect(grants).not.toMatch(/authenticated=[a-z]*d/);
  });

  it("only allows deleting a snapshot while it is still working", () => {
    const [[qual]] = q(
      `select coalesce(qual::text,'') from pg_policies
        where schemaname='public' and tablename='contract_claim_snapshots' and cmd='DELETE'`,
    );
    expect(qual).toMatch(/status = 'working'/);
  });
});

d("contracts & claims tables — policy shape", () => {
  const policies = q(
    `select tablename, policyname, cmd, ${flat("qual")}, ${flat("with_check")}, ${flat("roles")}
       from pg_policies where schemaname='public' and tablename in (${list})`,
  );

  it("defines at least one policy per table", () => {
    for (const t of TABLES) {
      expect(policies.some((p) => p[0] === t)).toBe(true);
    }
  });

  it("scopes every policy to the caller's company", () => {
    for (const [table, name, , qual, check] of policies) {
      const expr = `${qual} ${check}`;
      expect(
        /company_id/.test(expr),
        `${table}.${name} must be company-scoped, got: ${expr}`,
      ).toBe(true);
    }
  });

  it("never targets the anon or public role", () => {
    for (const [table, name, , , , roles] of policies) {
      expect(/\banon\b/.test(roles), `${table}.${name} targets anon`).toBe(false);
      expect(/\{public\}/.test(roles), `${table}.${name} targets public`).toBe(false);
    }
  });

  it("gives every write policy a WITH CHECK clause", () => {
    for (const [table, name, cmd, , check] of policies) {
      if (cmd === "INSERT" || cmd === "UPDATE" || cmd === "ALL") {
        expect(check.trim().length > 0, `${table}.${name} (${cmd}) has no WITH CHECK`).toBe(true);
      }
    }
  });
});

d("contracts & claims — data integrity invariants", () => {
  it("stores a checksum on every snapshot", () => {
    const [[nulls]] = q(
      `select count(*) from public.contract_claim_snapshots where checksum is null`,
    );
    expect(Number(nulls)).toBe(0);
  });

  it("keeps claim references unique per project", () => {
    const [[dupes]] = q(
      `select count(*) from (
         select project_id, claim_ref from public.contract_claims
         group by 1,2 having count(*) > 1
       ) x`,
    );
    expect(Number(dupes)).toBe(0);
  });

  it("never orphans a snapshot line", () => {
    const [[orphans]] = q(
      `select count(*) from public.contract_claim_snapshot_lines l
         left join public.contract_claim_snapshots s on s.id = l.snapshot_id
        where s.id is null`,
    );
    expect(Number(orphans)).toBe(0);
  });

  it("has at most one non-superseded snapshot per project period", () => {
    const [[dupes]] = q(
      `select count(*) from (
         select project_id, period_month from public.contract_claim_snapshots
          where status <> 'superseded'
          group by 1,2 having count(*) > 1
       ) x`,
    );
    expect(Number(dupes)).toBe(0);
  });
});
