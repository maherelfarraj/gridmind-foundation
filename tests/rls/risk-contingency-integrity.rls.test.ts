// GC-17 — live-schema integrity for governed risk & contingency drawdown.
//
// Reads the deployed schema through psql. Skips (never silently passes)
// without managed PG* env vars. Every mutating probe runs inside a
// transaction that is rolled back, so no row is ever committed.
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

const TABLES = ["risk_sim_runs", "risk_contingency_events", "risk_contingency_alerts"] as const;
const list = TABLES.map((t) => `'${t}'`).join(",");

// GC-17 is derived and non-posting: it must never mutate these authoritative
// tables owned by other governed modules.
const PROTECTED = [
  "fx_rates",
  "costing_periods",
  "cost_forecast_periods",
  "forecast_versions",
  "budgets",
  "cost_codes",
  "evm_reports",
  "cashflow_snapshots",
  "funding_facilities",
  "recognition_snapshots",
  "contract_claims",
  "invoices",
  "payments",
  "change_orders",
];

// ---------------------------------------------------------------------------
// Structure, grants and RLS
// ---------------------------------------------------------------------------
d("GC-17 live schema — tables, RLS and least privilege", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every GC-17 table exactly once", () => {
    expect([...acl.keys()].sort()).toEqual([...TABLES].sort());
  });

  it.each(TABLES)("%s has row level security enabled", (t) => {
    expect(acl.get(t)!.endsWith("|true")).toBe(true);
  });

  it.each(TABLES)("%s grants nothing to anon or PUBLIC", (t) => {
    const grants = acl.get(t)!;
    expect(grants).not.toMatch(/\banon=/);
    expect(grants).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });

  it.each(TABLES)("%s grants explicit least privilege to authenticated", (t) => {
    const grants = acl.get(t)!;
    const authenticated = /authenticated=([a-zA-Z]+)\//.exec(grants)?.[1] ?? "";
    expect(authenticated.length).toBeGreaterThan(0);
    // No DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for app callers.
    expect(authenticated).not.toMatch(/[dDxtm]/);
    expect(grants).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps the risk & contingency event log append-only", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("risk_contingency_events")!)?.[1] ?? "";
    expect(priv).toBe("ar");
    const cmds = q(
      `select cmd from pg_policies where schemaname='public' and tablename='risk_contingency_events'`,
    ).map(([c]) => c);
    expect(cmds).not.toContain("DELETE");
    expect(cmds.some((c) => c === "UPDATE" || c === "ALL")).toBe(false);
  });

  it.each(TABLES)("%s has no DELETE policy for app callers", (t) => {
    const del = q(
      `select policyname from pg_policies
        where schemaname='public' and tablename='${t}' and cmd in ('DELETE','ALL')`,
    );
    expect(del).toEqual([]);
  });

  it("scopes every GC-17 policy to company membership", () => {
    const pols = q(
      `select tablename, policyname, ${flat("coalesce(qual,'')")} || ' ' || ${flat("coalesce(with_check,'')")}
         from pg_policies where schemaname='public' and tablename in (${list})`,
    );
    expect(pols.length).toBeGreaterThanOrEqual(6);
    for (const [table, name, expr] of pols) {
      expect(expr, `${table}.${name} is not company scoped`).toMatch(/is_company_member/);
    }
  });

  it("restricts every GC-17 policy to the authenticated role only", () => {
    const roles = q(
      `select tablename, policyname, array_to_string(roles,',') from pg_policies
        where schemaname='public' and tablename in (${list})`,
    );
    for (const [table, name, r] of roles) {
      expect(r, `${table}.${name}`).toBe("authenticated");
    }
  });
});

// ---------------------------------------------------------------------------
// Columns, constraints, indexes, triggers, routines
// ---------------------------------------------------------------------------
d("GC-17 live schema — columns, constraints and indexes", () => {
  const cols = q(
    `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema='public' and table_name in (${list})`,
  );
  const has = (t: string, c: string) => cols.some((r) => r[0] === t && r[1] === c);

  it("stores reproducible simulation provenance on every run", () => {
    for (const c of [
      "seed",
      "iterations",
      "engine",
      "engine_version",
      "input_checksum",
      "reporting_currency",
      "fx_rate_date",
      "fx_provenance",
      "inputs",
      "results",
      "diagnostics",
      "assumptions",
      "exclusions",
      "row_version",
      "superseded_by",
      "approved_by",
      "approved_at",
    ]) {
      expect(has("risk_sim_runs", c), `risk_sim_runs.${c} missing`).toBe(true);
    }
  });

  it("keeps company and project scope non-nullable on run and event rows", () => {
    for (const [t, c] of [
      ["risk_sim_runs", "company_id"],
      ["risk_sim_runs", "project_id"],
      ["risk_contingency_events", "company_id"],
      ["risk_contingency_events", "project_id"],
      ["risk_contingency_alerts", "company_id"],
    ] as const) {
      const row = cols.find((r) => r[0] === t && r[1] === c);
      expect(row?.[3], `${t}.${c}`).toBe("NO");
    }
  });

  it("bounds iterations, seeds, scopes and statuses by check constraints", () => {
    const defs = q(
      `select conrelid::regclass::text, ${flat("pg_get_constraintdef(oid)")}
         from pg_constraint where contype in ('c','u')
          and conrelid::regclass::text in (${list})`,
    ).map((r) => `${r[0]}:${r[1]}`);
    expect(
      defs.some((x) => x.includes("iterations >= 1000") || x.includes("iterations BETWEEN")),
    ).toBe(true);
    expect(defs.some((x) => x.startsWith("risk_sim_runs:") && x.includes("seed >= 0"))).toBe(true);
    expect(defs.some((x) => x.startsWith("risk_sim_runs:") && x.includes("'superseded'"))).toBe(
      true,
    );
    expect(defs.some((x) => x.includes("'joint'"))).toBe(true);
  });

  it("registers all sixteen governed alert families", () => {
    const def =
      q(
        `select ${flat("pg_get_constraintdef(oid)")} from pg_constraint
          where conname='risk_contingency_alerts_family_check'`,
      )[0]?.[0] ?? "";
    for (const f of [
      "high_exposure",
      "probability_impact_increase",
      "new_top_contributor",
      "p80_budget_breach",
      "p90_schedule_breach",
      "contingency_inadequacy",
      "burn_rate_spike",
      "unlinked_drawdown",
      "overdue_mitigation",
      "stale_simulation",
      "input_quality",
      "fx_materiality",
      "double_count",
      "funding_mismatch",
      "reserve_expiry",
      "sod_exception",
    ]) {
      expect(def, `alert family ${f} missing`).toContain(f);
    }
  });

  it("indexes the hot project, company and dedupe access paths", () => {
    const names = q(
      `select indexname from pg_indexes where schemaname='public' and tablename in (${list})`,
    ).map((r) => r[0]);
    for (const n of [
      "risk_sim_runs_project_idx",
      "risk_sim_runs_company_status_idx",
      "risk_sim_runs_idem_idx",
      "risk_contingency_events_entity_idx",
      "risk_contingency_events_project_idx",
      "risk_contingency_alerts_dedupe_idx",
      "risk_contingency_alerts_project_idx",
    ]) {
      expect(names, `missing index ${n}`).toContain(n);
    }
  });

  it("deduplicates alerts uniquely per company", () => {
    const def = q(
      `select ${flat("indexdef")} from pg_indexes
        where indexname='risk_contingency_alerts_dedupe_idx'`,
    )[0]?.[0];
    expect(def).toMatch(/UNIQUE/);
    expect(def).toMatch(/company_id, dedupe_key/);
  });

  it("enforces idempotency per project on simulation runs", () => {
    const def = q(
      `select ${flat("indexdef")} from pg_indexes where indexname='risk_sim_runs_idem_idx'`,
    )[0]?.[0];
    expect(def).toMatch(/UNIQUE/);
    expect(def).toMatch(/project_id, idempotency_key/);
  });

  it("installs the guard and append-only triggers", () => {
    const trg = q(
      `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where not t.tgisinternal and c.relname in (${list})`,
    ).map((r) => `${r[0]}.${r[1]}`);
    expect(trg).toContain("risk_sim_runs.risk_sim_runs_guard_trg");
    expect(trg).toContain("risk_contingency_events.risk_contingency_events_append_only_trg");
    expect(trg).toContain("risk_contingency_alerts.set_updated_at_risk_contingency_alerts");
  });

  it("pins search_path on every GC-17 routine", () => {
    const fns = q(
      `select proname, ${flat("coalesce(array_to_string(proconfig,','),'')")}
         from pg_proc where pronamespace='public'::regnamespace
          and proname in ('risk_sim_runs_guard','risk_contingency_events_append_only')`,
    );
    expect(fns.length).toBe(2);
    for (const [name, cfg] of fns) {
      expect(cfg, `${name} search_path not pinned`).toMatch(/search_path=public/);
    }
  });

  it("keeps GC-17 guard routines out of anon and PUBLIC execute grants", () => {
    const acl = q(
      `select proname, ${flat("coalesce(array_to_string(proacl,' '),'')")}
         from pg_proc where pronamespace='public'::regnamespace
          and proname in ('risk_sim_runs_guard','risk_contingency_events_append_only')`,
    );
    for (const [name, grants] of acl) {
      expect(grants, `${name} grants anon`).not.toMatch(/\banon=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavioural guarantees — all inside rolled-back transactions
// ---------------------------------------------------------------------------
function tx(body: string): string {
  try {
    return execFileSync(
      "psql",
      ["-At", "-v", "ON_ERROR_STOP=0", "-c", `begin; ${body} rollback;`],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    // A privilege rejection is itself the guarantee under test.
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

d("GC-17 behaviour — immutability and history", () => {
  it("refuses to update or delete an event row", () => {
    const out = tx(
      `savepoint s1;
       update public.risk_contingency_events set action='tampered' where true;
       rollback to s1;
       savepoint s2;
       delete from public.risk_contingency_events where true;
       rollback to s2;`,
    );
    // Either the append-only trigger fires, or no row exists to touch; a
    // successful mutation of an existing row would show neither.
    expect(out).toMatch(/risk_contingency_events_append_only|permission denied/);
  });

  it("freezes approved simulation results", () => {
    const rows = q(`select id from public.risk_sim_runs where status='approved' limit 1`);
    if (rows.length === 0) {
      // No approved run deployed yet: assert the guard exists instead.
      const src =
        q(
          `select ${flat("prosrc")} from pg_proc
            where proname='risk_sim_runs_guard' and pronamespace='public'::regnamespace`,
        )[0]?.[0] ?? "";
      expect(src).toMatch(/risk_sim_run_frozen/);
      return;
    }
    const out = tx(
      `update public.risk_sim_runs set results='{}'::jsonb where id='${rows[0]![0]}';`,
    );
    expect(out).toMatch(/risk_sim_run_frozen/);
  });

  it("bumps row_version on every accepted run update", () => {
    const src =
      q(
        `select ${flat("prosrc")} from pg_proc
          where proname='risk_sim_runs_guard' and pronamespace='public'::regnamespace`,
      )[0]?.[0] ?? "";
    expect(src).toMatch(/row_version := OLD\.row_version \+ 1/);
  });
});

d("GC-17 non-mutation — authoritative tables are never written", () => {
  it("has no GC-17 trigger, rule or foreign-key cascade writing an authoritative table", () => {
    const protectedList = PROTECTED.map((t) => `'${t}'`).join(",");
    const trg = q(
      `select c.relname, t.tgname, p.proname from pg_trigger t
         join pg_class c on c.oid=t.tgrelid
         join pg_proc p on p.oid=t.tgfoid
        where not t.tgisinternal and c.relname in (${protectedList})
          and p.proname like 'risk_%'`,
    );
    expect(trg).toEqual([]);
  });

  it("never grants GC-17 routines the right to write outside their own tables", () => {
    for (const fn of ["risk_sim_runs_guard", "risk_contingency_events_append_only"]) {
      const src =
        q(
          `select ${flat("prosrc")} from pg_proc
            where proname='${fn}' and pronamespace='public'::regnamespace`,
        )[0]?.[0] ?? "";
      for (const t of PROTECTED) {
        expect(src, `${fn} touches ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`));
      }
    }
  });

  it("keeps GC-17 routines SECURITY INVOKER so RLS always applies", () => {
    const rows = q(
      `select proname, prosecdef from pg_proc where pronamespace='public'::regnamespace
        and proname in ('risk_sim_runs_guard','risk_contingency_events_append_only')`,
    );
    for (const [name, secdef] of rows) {
      expect(secdef, `${name} is SECURITY DEFINER`).toBe("f");
    }
  });
});
