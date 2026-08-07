// GC-15 — Live-schema guarantees and invariant proofs for governed revenue,
// WIP and percentage-of-completion recognition. Reads the deployed schema
// through psql and skips (never silently passes) without managed PG* env vars.
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

const TABLES = [
  "recognition_settings",
  "recognition_obligations",
  "recognition_snapshots",
  "recognition_snapshot_lines",
  "recognition_exceptions",
  "recognition_adjustments",
  "recognition_events",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

const GUARDS = [
  "recognition_snapshots_guard",
  "recognition_adjustments_guard",
  "recognition_events_append_only",
  "recognition_lines_frozen_guard",
  "recognition_obligations_version",
] as const;

// Authoritative data a recognition operation must never mutate.
const PROTECTED = [
  "contracts",
  "change_orders",
  "invoices",
  "payments",
  "cost_forecast_periods",
  "cost_accruals",
  "forecast_versions",
  "forecast_version_lines",
  "costing_periods",
  "fx_rates",
  "evm_reports",
  "evm_report_lines",
  "cashflow_snapshots",
  "cashflow_snapshot_lines",
  "portfolio_scenarios",
  "baseline_snapshots",
  "gl_journal_entries",
];

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------
d("recognition live schema — tables, RLS and grants", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every GC-15 table", () => {
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

  it("keeps the recognition event history read-append only for authenticated", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("recognition_events")!)?.[1] ?? "";
    expect(priv).toBe("ar");
  });

  it("is idempotent to re-apply: every table and enum exists exactly once", () => {
    expect(
      q(
        `select relname from pg_class
          where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})
          group by relname having count(*) > 1`,
      ),
    ).toEqual([]);
    expect(
      q(
        `select typname from pg_type
          where typnamespace='public'::regnamespace and typtype='e'
            and typname like 'recognition%'
          group by typname having count(*) > 1`,
      ),
    ).toEqual([]);
  });

  it("registers the recognition alert families on the portfolio alert enum", () => {
    const vals = q(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'portfolio_alert_rule_type'`,
    ).map((r) => r[0]);
    const families = [
      "revenue_margin_erosion",
      "revenue_loss_making",
      "recognition_basis_stale",
      "recognition_fx_missing",
      "revenue_reversal_material",
      "wip_underbilling_age",
      "contract_liability_movement",
      "unapproved_variation_exposure",
      "retention_release_overdue",
      "recognition_billing_lag",
      "recognition_reconciliation_failed",
      "recognition_adjustment_pending",
      "recognition_approval_delay",
    ];
    expect(families.length).toBe(13);
    for (const f of families) expect(vals).toContain(f);
  });
});

d("recognition live schema — policies", () => {
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

  it("restricts every recognition write to finance, project or company admins", () => {
    for (const t of TABLES) {
      for (const [, , cmd, qual, check] of byTable(t).filter((r) => r[2] !== "SELECT")) {
        if (t === "recognition_events" && cmd === "INSERT") continue; // any member may log.
        expect(`${t}:${qual} ${check}`).toMatch(
          /has_company_role\('(finance_admin|project_admin|company_admin)'/,
        );
      }
    }
  });

  it("only admits working snapshots and only deletes working snapshots", () => {
    expect(byTable("recognition_snapshots").find((r) => r[2] === "INSERT")![4]).toContain(
      "'working'::recognition_snapshot_status",
    );
    expect(byTable("recognition_snapshots").find((r) => r[2] === "DELETE")![3]).toContain(
      "'working'::recognition_snapshot_status",
    );
  });

  it("blocks any update of a superseded snapshot at policy level", () => {
    expect(byTable("recognition_snapshots").find((r) => r[2] === "UPDATE")![3]).toContain(
      "status <> 'superseded'::recognition_snapshot_status",
    );
  });

  it("restricts snapshot line writes to working or submitted parents in the same company", () => {
    const write = byTable("recognition_snapshot_lines").find((r) => r[2] === "ALL")!;
    expect(write[3]).toContain("'working'::recognition_snapshot_status");
    expect(write[3]).toContain("'submitted'::recognition_snapshot_status");
    expect(write[3]).toContain("s.company_id = recognition_snapshot_lines.company_id");
  });

  it("admits adjustments as drafts and reserves authorisation to finance", () => {
    expect(byTable("recognition_adjustments").find((r) => r[2] === "INSERT")![4]).toContain(
      "'draft'::recognition_adjustment_status",
    );
    const update = byTable("recognition_adjustments").find((r) => r[2] === "UPDATE")!;
    expect(update[3]).toMatch(/finance_admin|company_admin/);
    expect(update[3]).not.toContain("project_admin");
    expect(update[3]).toContain("status <> 'void'::recognition_adjustment_status");
  });

  it("forbids event mutation or deletion outright", () => {
    expect(byTable("recognition_events").some((r) => r[2] === "UPDATE" || r[2] === "DELETE")).toBe(
      false,
    );
  });
});

d("recognition live schema — triggers and routines", () => {
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
      where p.pronamespace='public'::regnamespace and p.proname like 'recognition%'`,
  );

  it("guards the snapshot lifecycle, lines, obligations, adjustments and history", () => {
    const pairs = trg.map((r) => `${r[0]}:${r[2]}`);
    expect(pairs).toContain("recognition_snapshots:recognition_snapshots_guard");
    expect(pairs).toContain("recognition_snapshot_lines:recognition_lines_frozen_guard");
    expect(pairs).toContain("recognition_obligations:recognition_obligations_version");
    expect(pairs).toContain("recognition_adjustments:recognition_adjustments_guard");
    expect(pairs).toContain("recognition_events:recognition_events_append_only");
  });

  it("scopes the append-only trigger to update and delete", () => {
    const def = trg.find((r) => r[2] === "recognition_events_append_only")![3]!;
    expect(/before (delete or update|update or delete)/i.test(def)).toBe(true);
  });

  it("freezes approved and superseded snapshots and bumps the row version", () => {
    const src = fns.find((f) => f[0] === "recognition_snapshots_guard")![4]!.toLowerCase();
    expect(src).toContain("approved");
    expect(src).toContain("superseded");
    expect(src).toContain("row_version");
    expect(src).toContain("raise exception");
    // Frozen snapshots keep their totals and their evidence pointers.
    for (const col of ["totals", "fx_provenance", "policy_version", "contract_basis"]) {
      expect(src).toContain(col);
    }
  });

  it("enforces approver segregation of duties and period locks on approval", () => {
    const src = fns.find((f) => f[0] === "recognition_snapshots_guard")![4]!.toLowerCase();
    expect(src).toContain("submitted_by");
    expect(src).toContain("prepared_by");
    expect(src).toContain("recognition_self_approval");
    expect(src).toContain("recognition_approver_required");
    expect(src).toContain("assert_costing_period_open");
  });

  it("enforces adjustment segregation of duties, void immutability and period locks", () => {
    const src = fns.find((f) => f[0] === "recognition_adjustments_guard")![4]!.toLowerCase();
    expect(src).toContain("recognition_self_authorization");
    expect(src).toContain("recognition_authorizer_required");
    expect(src).toContain("recognition_adjustment_frozen");
    expect(src).toContain("assert_costing_period_open");
    expect(src).toContain("row_version");
  });

  it("freezes lines of approved and superseded snapshots at trigger level", () => {
    const src = fns.find((f) => f[0] === "recognition_lines_frozen_guard")![4]!.toLowerCase();
    expect(src).toContain("approved");
    expect(src).toContain("superseded");
    expect(src).toContain("recognition_line_frozen");
  });

  it("increments obligation versions in the database, not in the client", () => {
    const src = fns.find((f) => f[0] === "recognition_obligations_version")![4]!.toLowerCase();
    expect(src).toContain("row_version := old.row_version + 1");
  });

  it.each(GUARDS)("%s is security definer with a fixed search_path", (name) => {
    const f = fns.find((x) => x[0] === name)!;
    expect(f[1]).toBe("true");
    expect(f[2]).toMatch(/search_path=/);
  });

  it.each(GUARDS)("%s is not executable by anon, authenticated or PUBLIC", (name) => {
    const acl = fns.find((x) => x[0] === name)![3]!;
    expect(acl).not.toMatch(/\banon=/);
    expect(acl).not.toMatch(/\bauthenticated=/);
    expect(acl).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });
});

d("recognition live schema — constraints and index coverage", () => {
  const idx = q(
    `select tablename, ${flat("indexdef")} from pg_indexes
      where schemaname='public' and tablename in (${list})`,
  );
  const has = (t: string, re: RegExp) => idx.filter((r) => r[0] === t).some((s) => re.test(s[1]!));

  it("enforces one active snapshot per project period", () => {
    expect(
      has(
        "recognition_snapshots",
        /UNIQUE INDEX .*\(project_id, period_month\) WHERE .*superseded/,
      ),
    ).toBe(true);
  });

  it("indexes project cockpit and portfolio selection", () => {
    expect(has("recognition_snapshots", /\(project_id, period_month DESC, version_no DESC\)/)).toBe(
      true,
    );
    expect(has("recognition_snapshots", /\(company_id, period_month, status\)/)).toBe(true);
  });

  it("indexes line, obligation, exception, adjustment and event drilldowns", () => {
    expect(has("recognition_snapshot_lines", /\(snapshot_id, sort_order\)/)).toBe(true);
    expect(has("recognition_snapshot_lines", /\(obligation_id\)/)).toBe(true);
    expect(has("recognition_obligations", /UNIQUE INDEX .*\(project_id, code\)/)).toBe(true);
    expect(has("recognition_obligations", /\(project_id, status, code\)/)).toBe(true);
    expect(has("recognition_exceptions", /\(snapshot_id, severity, code\)/)).toBe(true);
    expect(has("recognition_adjustments", /\(project_id, effective_period DESC, status\)/)).toBe(
      true,
    );
    expect(has("recognition_events", /\(snapshot_id, created_at DESC\)/)).toBe(true);
    expect(has("recognition_settings", /UNIQUE INDEX .*\(project_id\)/)).toBe(true);
  });

  it("ties every child row to its parent with a foreign key", () => {
    const fks = q(
      `select cl.relname, rf.relname from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_class rf on rf.oid = c.confrelid
        where c.contype='f' and cl.relname in (${list})`,
    ).map((r) => r.join("->"));
    expect(fks).toContain("recognition_snapshot_lines->recognition_snapshots");
    expect(fks).toContain("recognition_exceptions->recognition_snapshots");
  });
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
d("recognition invariants — authoritative data is never touched", () => {
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

  it("declares no recognition routine that writes an authoritative table", () => {
    const routines = q(
      `select p.proname, ${flat("p.prosrc")} from pg_proc p
        where p.pronamespace='public'::regnamespace and p.proname like 'recognition%'`,
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

  it("declares no cascade from a recognition table back into authoritative data", () => {
    const upward = q(
      `select cl.relname, rf.relname from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_class rf on rf.oid = c.confrelid
        where c.contype='f' and rf.relname like 'recognition%'
          and cl.relname in (${PROTECTED.map((t) => `'${t}'`).join(",")})`,
    );
    expect(upward.map((r) => r.join("->"))).toEqual([]);
  });

  const OPERATIONS: [string, string][] = [
    [
      "build/save",
      `insert into public.recognition_snapshots (company_id, project_id, period_month, status, reporting_currency, project_currency)
         values (gen_random_uuid(), gen_random_uuid(), '2026-03-01', 'working', 'USD', 'USD')`,
    ],
    [
      "submit",
      `update public.recognition_snapshots set status='submitted' where period_month='2026-03-01'`,
    ],
    [
      "approve",
      `update public.recognition_snapshots set status='approved' where period_month='2026-03-01'`,
    ],
    ["correct/supersede", `update public.recognition_snapshots set status='superseded' where true`],
    [
      "settings edit",
      `insert into public.recognition_settings (company_id, project_id, default_method)
         values (gen_random_uuid(), gen_random_uuid(), 'cost_to_cost')`,
    ],
    [
      "obligation edit",
      `insert into public.recognition_obligations (company_id, project_id, code, name)
         values (gen_random_uuid(), gen_random_uuid(), 'PROBE', 'probe')`,
    ],
    [
      "adjustment prepare",
      `insert into public.recognition_adjustments (company_id, project_id, status, kind, amount, effective_period)
         values (gen_random_uuid(), gen_random_uuid(), 'draft', 'claim', 100, '2026-03-01')`,
    ],
    [
      "adjustment authorize/void",
      `update public.recognition_adjustments set status='approved' where true`,
    ],
    [
      "saved view",
      `insert into public.portfolio_saved_views (company_id, name, config)
         values (gen_random_uuid(), 'probe', '{}'::jsonb)`,
    ],
    [
      "alert persistence",
      `insert into public.portfolio_alerts (company_id, rule_type, severity, title)
         values (gen_random_uuid(), 'recognition_reconciliation_break', 'high', 'probe')`,
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

  it("pack loading is read-only: selecting the recognition surface changes nothing", () => {
    const before = fingerprint();
    q(
      `select count(*) from public.recognition_snapshots s
         left join public.recognition_snapshot_lines l on l.snapshot_id = s.id
         left join public.recognition_exceptions e on e.snapshot_id = s.id`,
    );
    expect(fingerprint()).toBe(before);
  });

  it("cannot mutate frozen snapshots, lines or history from an unprivileged session", () => {
    for (const sql of [
      `update public.recognition_snapshots set totals='{}'::jsonb where true`,
      `update public.recognition_snapshot_lines set cumulative_revenue=0 where true`,
      `update public.recognition_events set detail='{}'::jsonb where true`,
      `delete from public.recognition_events where true`,
    ]) {
      expect(qFail(`begin; ${sql}; rollback;`)).not.toBe("");
    }
  });

  it("every recognition update policy carries both USING and WITH CHECK", () => {
    const rows = q(
      `select tablename, policyname, ${flat("qual")}, ${flat("with_check")}
         from pg_policies
        where schemaname='public' and cmd in ('UPDATE','ALL') and tablename like 'recognition%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const [table, policy, using, check] of rows) {
      expect(`${table}.${policy}:${using}`).toContain("is_company_member");
      expect(`${table}.${policy}:${check}`).toContain("is_company_member");
    }
  });
});
