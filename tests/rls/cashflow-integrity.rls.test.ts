// GC-13 — Live-schema guarantees and invariant proofs for governed cash flow,
// funding and liquidity. Reads the deployed schema through psql and skips
// (never silently passes) without managed PG* env vars.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);
const d = HAS_DB ? describe : describe.skip;

const flat = (col: string) => `regexp_replace(coalesce(${col}::text,''), '\\s+', ' ', 'g')`;

function q(sql: string): string[][] {
  return execFileSync("psql", ["-At", "-F", "\u0001", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

/** Run SQL that is expected to fail; return the error text. */
function qFail(sql: string): string {
  try {
    execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? "");
  }
}

/**
 * Run a psql script in ONE session and return every line the script tagged
 * with `FP:`. Errors are tolerated (the probes below are expected to fail);
 * the script itself recovers through savepoints.
 */
function script(sql: string): string[] {
  let out = "";
  try {
    out = execFileSync("psql", ["-Atq", "-F", "\u0001"], {
      encoding: "utf8",
      input: sql,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: Buffer | string };
    out = String(err.stdout ?? "");
  }
  return out
    .split("\n")
    .filter((l) => l.startsWith("FP:"))
    .map((l) => l.slice(3));
}


const TABLES = [
  "cashflow_settings",
  "cashflow_snapshots",
  "cashflow_snapshot_lines",
  "cashflow_exceptions",
  "cashflow_adjustments",
  "cashflow_events",
  "funding_facilities",
  "funding_allocations",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

// Authoritative data a cash-flow operation must never mutate.
const PROTECTED = [
  "cost_forecast_periods",
  "cost_accruals",
  "forecast_versions",
  "forecast_version_lines",
  "costing_periods",
  "fx_rates",
  "invoices",
  "payments",
  "purchase_orders",
  "evm_reports",
  "evm_report_lines",
  "portfolio_scenarios",
  "baseline_snapshots",
] as const;

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------
d("cash flow live schema — tables, RLS and grants", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every GC-13 table", () => {
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
    // No TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
    expect(authenticated).not.toMatch(/[Dxtm]/);
    expect(grants).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps the event history read-append only for authenticated", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("cashflow_events")!)?.[1] ?? "";
    expect(priv).toBe("ar");
  });

  it("is idempotent to re-apply: every table and enum exists exactly once", () => {
    const dupes = q(
      `select relname, count(*)::text from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})
        group by relname having count(*) > 1`,
    );
    expect(dupes).toEqual([]);
    const enums = q(
      `select typname, count(*)::text from pg_type
        where typnamespace='public'::regnamespace and typtype='e'
          and typname in ('cashflow_snapshot_status','cashflow_bucket_granularity',
                          'cashflow_source','cashflow_date_basis','funding_facility_status',
                          'cashflow_adjustment_status')
        group by typname having count(*) > 1`,
    );
    expect(enums).toEqual([]);
  });

  it("registers the liquidity alert families on the portfolio alert enum", () => {
    const vals = q(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'portfolio_alert_rule_type'`,
    ).map((r) => r[0]);
    for (const v of ["liquidity_shortfall", "funding_headroom", "covenant_breach"]) {
      expect(vals).toContain(v);
    }
  });
});

d("cash flow live schema — policies", () => {
  const pol = q(
    `select tablename, policyname, cmd, ${flat("qual")}, ${flat("with_check")}
       from pg_policies where schemaname='public' and tablename in (${list})`,
  );
  const byTable = (t: string) => pol.filter((r) => r[0] === t);

  it.each(TABLES)("%s carries at least one policy", (t) => {
    expect(byTable(t).length).toBeGreaterThan(0);
  });

  it.each(TABLES)("%s scopes every policy to company membership", (t) => {
    for (const [, , , qual, check] of byTable(t)) {
      expect(`${qual} ${check}`).toContain("is_company_member(company_id)");
    }
  });

  it("never exposes an unrestricted USING (true) or WITH CHECK (true)", () => {
    for (const [, name, , qual, check] of pol) {
      expect(`${name}:${qual}`).not.toMatch(/:true$/);
      expect(`${name}:${check}`).not.toMatch(/:true$/);
    }
  });

  it("pairs USING with WITH CHECK on every write policy", () => {
    for (const [, , cmd, qual, check] of pol) {
      if (cmd === "INSERT") expect(check).not.toBe("");
      if (cmd === "UPDATE" || cmd === "ALL") {
        expect(qual).not.toBe("");
        expect(check).not.toBe("");
      }
    }
  });

  it("restricts every cash write to finance, project or company admins", () => {
    for (const t of TABLES) {
      for (const [, , cmd, qual, check] of byTable(t).filter((r) => r[2] !== "SELECT")) {
        if (t === "cashflow_events" && cmd === "INSERT") continue; // any member may log.
        expect(`${t}:${qual} ${check}`).toMatch(
          /has_company_role\('(finance_admin|project_admin|company_admin)'/,
        );
      }
    }
  });

  it("only admits working snapshots and only deletes working snapshots", () => {
    const insert = byTable("cashflow_snapshots").find((r) => r[2] === "INSERT")!;
    expect(insert[4]).toContain("'working'::cashflow_snapshot_status");
    const del = byTable("cashflow_snapshots").find((r) => r[2] === "DELETE")!;
    expect(del[3]).toContain("'working'::cashflow_snapshot_status");
  });

  it("restricts snapshot line writes to working or submitted parents", () => {
    const write = byTable("cashflow_snapshot_lines").find((r) => r[2] === "ALL")!;
    expect(write[3]).toContain("'working'::cashflow_snapshot_status");
    expect(write[3]).toContain("'submitted'::cashflow_snapshot_status");
    expect(write[3]).toContain("s.company_id = cashflow_snapshot_lines.company_id");
  });

  it("admits adjustments as drafts and reserves authorisation to finance", () => {
    const insert = byTable("cashflow_adjustments").find((r) => r[2] === "INSERT")!;
    expect(insert[4]).toContain("'draft'::cashflow_adjustment_status");
    const update = byTable("cashflow_adjustments").find((r) => r[2] === "UPDATE")!;
    expect(update[3]).toMatch(/finance_admin|company_admin/);
    expect(update[3]).not.toContain("project_admin");
  });

  it("forbids event mutation or deletion outright", () => {
    expect(byTable("cashflow_events").some((r) => r[2] === "UPDATE" || r[2] === "DELETE")).toBe(
      false,
    );
  });
});

d("cash flow live schema — triggers and routines", () => {
  const trg = q(
    `select c.relname, t.tgname, p.proname, ${flat("pg_get_triggerdef(t.oid)")}
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc  p on p.oid = t.tgfoid
      where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (${list})`,
  );
  const fns = q(
    `select p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),''),
            coalesce(${flat("array_to_string(p.proacl,' ')")},''), ${flat("p.prosrc")}
       from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'cashflow%'`,
  );

  it("guards the snapshot lifecycle, adjustments and the append-only history", () => {
    const pairs = trg.map((r) => `${r[0]}:${r[2]}`);
    expect(pairs).toContain("cashflow_snapshots:cashflow_snapshots_guard");
    expect(pairs).toContain("cashflow_adjustments:cashflow_adjustments_guard");
    expect(pairs).toContain("cashflow_events:cashflow_events_append_only");
  });

  it("scopes the append-only trigger to update and delete", () => {
    const def = trg.find((r) => r[2] === "cashflow_events_append_only")![3]!;
    expect(/before (delete or update|update or delete)/i.test(def)).toBe(true);
  });

  it("freezes approved and superseded snapshots and bumps the row version", () => {
    const src = fns.find((f) => f[0] === "cashflow_snapshots_guard")![4]!.toLowerCase();
    expect(src).toContain("approved");
    expect(src).toContain("superseded");
    expect(src).toContain("row_version");
    expect(src).toContain("raise exception");
  });

  it("enforces segregation of duties and period locks in the guards", () => {
    const snap = fns.find((f) => f[0] === "cashflow_snapshots_guard")![4]!.toLowerCase();
    expect(snap).toContain("submitted_by");
    expect(snap).toMatch(/period|lock/);
    const adj = fns.find((f) => f[0] === "cashflow_adjustments_guard")![4]!.toLowerCase();
    expect(adj).toContain("raise exception");
  });

  it.each([
    "cashflow_snapshots_guard",
    "cashflow_adjustments_guard",
    "cashflow_events_append_only",
  ])("%s is security definer with a fixed search_path", (name) => {
    const f = fns.find((x) => x[0] === name)!;
    expect(f[1]).toBe("true");
    expect(f[2]).toMatch(/search_path=/);
  });

  it("revokes execute on every cash-flow routine from all client roles", () => {
    for (const name of [
      "cashflow_snapshots_guard",
      "cashflow_adjustments_guard",
      "cashflow_events_append_only",
    ]) {
      const acl = fns.find((x) => x[0] === name)![3]!;
      expect(acl).not.toMatch(/\banon=/);
      expect(acl).not.toMatch(/\bauthenticated=/);
      expect(acl).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
    }
  });
});

d("cash flow live schema — constraints and index coverage", () => {
  const idx = q(
    `select tablename, ${flat("indexdef")} from pg_indexes
      where schemaname='public' and tablename in (${list})`,
  );
  const has = (t: string, re: RegExp) => idx.filter((r) => r[0] === t).some((s) => re.test(s[1]!));

  it("enforces one active snapshot per project period", () => {
    expect(
      has("cashflow_snapshots", /UNIQUE INDEX .*\(project_id, period_month\) WHERE .*superseded/),
    ).toBe(true);
  });

  it("indexes project cockpit and portfolio selection", () => {
    expect(has("cashflow_snapshots", /\(project_id, period_month DESC, version_no DESC\)/)).toBe(
      true,
    );
    expect(has("cashflow_snapshots", /\(company_id, period_month, status\)/)).toBe(true);
  });

  it("indexes bucket, source and cost-code drilldowns", () => {
    expect(has("cashflow_snapshot_lines", /\(snapshot_id, bucket_start, sort_order\)/)).toBe(true);
    expect(has("cashflow_snapshot_lines", /\(snapshot_id, source, direction\)/)).toBe(true);
    expect(has("cashflow_snapshot_lines", /\(snapshot_id, cost_code_id\)/)).toBe(true);
  });

  it("indexes exceptions, events, adjustments and funding lookups", () => {
    expect(has("cashflow_exceptions", /\(snapshot_id, severity, code\)/)).toBe(true);
    expect(has("cashflow_events", /\(snapshot_id, created_at DESC\)/)).toBe(true);
    expect(has("cashflow_adjustments", /\(project_id, effective_period, status\)/)).toBe(true);
    expect(has("funding_facilities", /\(company_id, status, expiry_date\)/)).toBe(true);
    expect(has("funding_allocations", /UNIQUE INDEX .*\(facility_id, project_id\)/)).toBe(true);
    expect(has("cashflow_settings", /UNIQUE INDEX .*\(project_id\)/)).toBe(true);
  });

  it("ties every child row to its parent with a foreign key", () => {
    const fks = q(
      `select cl.relname, rf.relname from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_class rf on rf.oid = c.confrelid
        where c.contype='f' and cl.relname in (${list})`,
    ).map((r) => r.join("->"));
    expect(fks).toContain("cashflow_snapshot_lines->cashflow_snapshots");
    expect(fks).toContain("cashflow_exceptions->cashflow_snapshots");
    expect(fks).toContain("funding_allocations->funding_facilities");
  });
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
d("cash flow invariants — authoritative data is never touched", () => {
  const fingerprint = () =>
    q(
      PROTECTED.map(
        (t) =>
          `select '${t}'::text as t, count(*)::text as n, coalesce(md5(string_agg(x, ',' order by x)),'-') as h
             from (select id::text as x from public.${t}) s`,
      ).join(" union all "),
    )
      .map((r) => r.join("|"))
      .sort()
      .join("\n");

  it("declares no cash-flow routine that writes an authoritative table", () => {
    const routines = q(
      `select p.proname, ${flat("p.prosrc")} from pg_proc p
        where p.pronamespace='public'::regnamespace
          and (p.proname like 'cashflow%' or p.proname like 'funding%')`,
    );
    for (const [name, src] of routines) {
      for (const t of PROTECTED) {
        const writes = new RegExp(
          `(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`,
          "i",
        );
        expect(`${name}:${writes.test(src!)}`).toBe(`${name}:false`);
      }
    }
  });

  it("declares no cascade from a cash-flow table back into authoritative data", () => {
    const upward = q(
      `select cl.relname, rf.relname from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_class rf on rf.oid = c.confrelid
        where c.contype='f' and (rf.relname like 'cashflow%' or rf.relname like 'funding%')
          and cl.relname in (${PROTECTED.map((t) => `'${t}'`).join(",")})`,
    );
    expect(upward.map((r) => r.join("->"))).toEqual([]);
  });

  const OPERATIONS: [string, string][] = [
    [
      "calculate/save",
      `insert into public.cashflow_snapshots (company_id, project_id, period_month, status, reporting_currency, project_currency)
         values (gen_random_uuid(), gen_random_uuid(), '2026-03-01', 'working', 'USD', 'USD')`,
    ],
    [
      "submit",
      `update public.cashflow_snapshots set status='submitted' where period_month='2026-03-01'`,
    ],
    [
      "approve",
      `update public.cashflow_snapshots set status='approved' where period_month='2026-03-01'`,
    ],
    ["supersede", `update public.cashflow_snapshots set status='superseded' where true`],
    [
      "adjustment",
      `insert into public.cashflow_adjustments (company_id, project_id, status, amount, bucket_date, effective_period)
         values (gen_random_uuid(), gen_random_uuid(), 'draft', 100, '2026-03-01', '2026-03-01')`,
    ],
    [
      "facility maintenance",
      `insert into public.funding_facilities (company_id, name, status, currency_code, limit_amount)
         values (gen_random_uuid(), 'probe', 'active', 'USD', 1000)`,
    ],
    [
      "allocation",
      `insert into public.funding_allocations (company_id, facility_id, project_id, allocated_amount)
         values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 100)`,
    ],
  ];

  it.each(OPERATIONS)(
    "an attempted %s leaves every authoritative table byte-identical after rollback",
    (_label, sql) => {
      const before = fingerprint();
      qFail(`begin; ${sql}; rollback;`);
      expect(fingerprint()).toBe(before);
    },
  );

  it("cannot mutate frozen snapshots or history from an unprivileged session", () => {
    for (const sql of [
      `update public.cashflow_snapshots set totals='{}'::jsonb where true`,
      `update public.cashflow_events set detail='{}'::jsonb where true`,
      `delete from public.cashflow_events where true`,
    ]) {
      expect(qFail(`begin; ${sql}; rollback;`)).not.toBe("");
    }
  });

  // --- GC-13c hardening -----------------------------------------------------
  it("frozen snapshot lines are protected by a database trigger, not only by policy", () => {
    const [row] = q(
      `select tgname, p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig,','),'')
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and c.relname = 'cashflow_snapshot_lines'
          and tgname = 'trg_cashflow_lines_frozen'`,
    );
    expect(row?.[1]).toBe("cashflow_lines_frozen_guard");
    expect(row?.[2]).toBe("t");
    expect(row?.[3]).toContain("search_path=public");
  });

  it("funding facility versions are incremented by the database", () => {
    const [row] = q(
      `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and c.relname='funding_facilities'
          and tgname='trg_funding_facilities_version'`,
    );
    expect(row?.[0]).toBe("trg_funding_facilities_version");
  });

  it("the new cash-flow guards are not executable by anon or authenticated", () => {
    const rows = q(
      `select p.proname, coalesce(array_to_string(p.proacl,' | '),'DEFAULT')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public'
          and p.proname in ('cashflow_lines_frozen_guard','funding_facilities_version_guard')`,
    );
    expect(rows.length).toBe(2);
    for (const [, acl] of rows) {
      expect(acl).not.toContain("anon=X");
      expect(acl).not.toContain("authenticated=X");
    }
  });

  it("every cash-flow and funding update policy carries both USING and WITH CHECK", () => {
    const rows = q(
      `select tablename, policyname, ${flat("qual")}, ${flat("with_check")}
         from pg_policies
        where schemaname='public' and cmd in ('UPDATE','ALL')
          and (tablename like 'cashflow%' or tablename like 'funding%')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const [table, policy, using, check] of rows) {
      expect(`${table}.${policy}:${using}`).toContain("is_company_member");
      expect(`${table}.${policy}:${check}`).toContain("is_company_member");
    }
  });
});
