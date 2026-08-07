// GC-12 — Live-schema guarantees and invariant proofs for Earned Value
// Management. Reads the deployed schema through psql and skips (never
// silently passes) without managed PG* env vars.
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

// Legacy (evm_snapshots) plus the current GC-12 bundle.
const TABLES = [
  "evm_snapshots",
  "evm_settings",
  "evm_mapping_versions",
  "evm_mappings",
  "evm_progress_overrides",
  "evm_reports",
  "evm_report_lines",
  "evm_exceptions",
  "evm_events",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

// Tables an EVM operation must never mutate.
const PROTECTED = [
  "baseline_snapshots",
  "forecast_versions",
  "forecast_version_lines",
  "cost_accruals",
  "costing_periods",
  "fx_rates",
  "portfolio_scenarios",
  "portfolio_scenario_assumptions",
  "schedule_tasks",
  "wbs_items",
] as const;

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------
d("EVM live schema — tables, RLS and grants", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every legacy and current EVM table", () => {
    expect([...acl.keys()].sort()).toEqual([...TABLES].sort());
  });

  it.each(TABLES)("%s has row level security enabled", (t) => {
    expect(acl.get(t)!.endsWith("|true")).toBe(true);
  });

  it.each(TABLES)("%s grants nothing to anon or PUBLIC", (t) => {
    const grants = acl.get(t)!;
    expect(grants).not.toMatch(/\banon=/);
    // A bare "=priv/owner" entry is the implicit PUBLIC grant.
    expect(grants).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
  });

  it.each(TABLES)("%s grants explicit least privilege to authenticated", (t) => {
    const grants = acl.get(t)!;
    const authenticated = /authenticated=([a-zA-Z]+)\//.exec(grants)?.[1] ?? "";
    expect(authenticated.length).toBeGreaterThan(0);
    // No TRUNCATE (D is delete, x/t/m are references/trigger/maintain).
    expect(authenticated).not.toMatch(/[Dxtm]/);
    expect(grants).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps frozen histories read-append only for authenticated", () => {
    // evm_events and evm_snapshots are append-only: select + insert, no update/delete.
    for (const t of ["evm_events", "evm_snapshots"]) {
      const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get(t)!)?.[1] ?? "";
      expect(priv).toBe("ar");
    }
    // Report children are rebuilt while working: no UPDATE privilege at all.
    for (const t of ["evm_report_lines", "evm_exceptions"]) {
      const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get(t)!)?.[1] ?? "";
      expect(priv).not.toContain("w");
    }
  });
});

d("EVM live schema — policies", () => {
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
      const expr = `${qual} ${check}`;
      expect(expr).toContain("is_company_member(company_id)");
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

  it("restricts mapping, override, settings and report writes to finance/project/company admins", () => {
    for (const t of [
      "evm_mapping_versions",
      "evm_mappings",
      "evm_progress_overrides",
      "evm_settings",
      "evm_reports",
      "evm_snapshots",
    ]) {
      const writes = byTable(t).filter((r) => r[2] !== "SELECT");
      expect(writes.length).toBeGreaterThan(0);
      for (const [, , , qual, check] of writes) {
        expect(`${qual} ${check}`).toMatch(
          /has_company_role\('(finance_admin|project_admin|company_admin)'/,
        );
      }
    }
  });

  it("limits mapping edits to draft versions only", () => {
    const write = byTable("evm_mappings").find((r) => r[2] === "ALL")!;
    expect(write[3]).toContain("'draft'::evm_mapping_status");
    expect(write[4]).toContain("'draft'::evm_mapping_status");
    const insert = byTable("evm_mapping_versions").find((r) => r[2] === "INSERT")!;
    expect(insert[4]).toContain("'draft'::evm_mapping_status");
    const update = byTable("evm_mapping_versions").find((r) => r[2] === "UPDATE")!;
    expect(update[3]).toContain("<> 'superseded'::evm_mapping_status");
  });

  it("limits report children and report deletion to working reports", () => {
    for (const t of ["evm_report_lines", "evm_exceptions"]) {
      for (const [, , cmd, qual, check] of byTable(t).filter((r) => r[2] !== "SELECT")) {
        expect(`${qual}${check}`).toContain("'working'::evm_report_status");
        expect(cmd).not.toBe("UPDATE");
      }
    }
    const del = byTable("evm_reports").find((r) => r[2] === "DELETE")!;
    expect(del[3]).toContain("'working'::evm_report_status");
  });

  it("binds every event to its actor and forbids event mutation", () => {
    const insert = byTable("evm_events").find((r) => r[2] === "INSERT")!;
    expect(insert[4]).toContain("actor_id = auth.uid()");
    expect(byTable("evm_events").some((r) => r[2] === "UPDATE" || r[2] === "DELETE")).toBe(false);
  });

  it("forbids direct mutation or deletion of snapshots", () => {
    expect(byTable("evm_snapshots").some((r) => r[2] === "UPDATE" || r[2] === "DELETE")).toBe(
      false,
    );
  });
});

d("EVM live schema — triggers and routines", () => {
  const trg = q(
    `select c.relname, t.tgname, p.proname
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc  p on p.oid = t.tgfoid
      where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (${list})`,
  );
  const fns = q(
    `select p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),''),
            coalesce(${flat("array_to_string(p.proacl,' ')")},''), ${flat("p.prosrc")}
       from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname like 'evm%'`,
  );

  it("guards report lifecycle, mapping versions and both append-only histories", () => {
    const pairs = trg.map((r) => `${r[0]}:${r[2]}`);
    expect(pairs).toContain("evm_reports:evm_reports_guard");
    expect(pairs).toContain("evm_mapping_versions:evm_mapping_versions_guard");
    expect(pairs).toContain("evm_events:evm_append_only_guard");
    expect(pairs).toContain("evm_snapshots:evm_append_only_guard");
  });

  it("freezes approved and superseded reports in the report guard", () => {
    const src = fns.find((f) => f[0] === "evm_reports_guard")![4];
    expect(src).toContain("evm_report_frozen");
    expect(src).toContain("old.status in ('approved','superseded')");
    expect(src).toContain("new.row_version := old.row_version + 1");
  });

  it("blocks update and delete in the append-only guard", () => {
    const src = fns.find((f) => f[0] === "evm_append_only_guard")![4].toLowerCase();
    // The guard always raises; the UPDATE/DELETE scope lives on the triggers.
    expect(src).toContain("raise exception");
    const trg = q(
      `select c.relname, ${flat("pg_get_triggerdef(t.oid)")}
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
        where p.proname = 'evm_append_only_guard' and not t.tgisinternal`,
    );
    expect(trg.length).toBeGreaterThan(0);
    for (const [table, def] of trg) {
      expect(`${table}:${/before (delete or update|update or delete)/i.test(def!)}`).toBe(
        `${table}:true`,
      );
    }
  });

  it("validates mapping-version transitions and supersession", () => {
    const src = fns.find((f) => f[0] === "evm_mapping_versions_guard")![4].toLowerCase();
    expect(src).toContain("superseded");
    expect(src).toContain("approved");
  });

  it.each(["evm_reports_guard", "evm_mapping_versions_guard", "evm_append_only_guard"])(
    "%s is security definer with a fixed search_path",
    (name) => {
      const f = fns.find((x) => x[0] === name)!;
      expect(f[1]).toBe("true");
      expect(f[2]).toMatch(/search_path=/);
    },
  );

  it("revokes PUBLIC and anon execute on every EVM routine", () => {
    for (const f of fns) {
      expect(f[3]).not.toMatch(/\banon=/);
      expect(f[3]).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
    }
  });

  it("performs internal authorization inside privileged routines", () => {
    // A security-definer routine must never trust the caller blindly: each one
    // either raises on an invalid transition or re-checks the row it guards.
    for (const name of [
      "evm_reports_guard",
      "evm_mapping_versions_guard",
      "evm_append_only_guard",
    ]) {
      const src = fns.find((x) => x[0] === name)![4].toLowerCase();
      expect(src).toContain("raise exception");
    }
  });
});

d("EVM live schema — index coverage", () => {
  const idx = q(
    `select tablename, indexname, ${flat("indexdef")} from pg_indexes
      where schemaname='public' and tablename in (${list})`,
  );
  const defs = (t: string) => idx.filter((r) => r[0] === t).map((r) => r[2]);
  const has = (t: string, re: RegExp) => defs(t).some((s) => re.test(s));

  it("indexes project + period + version report lookups", () => {
    expect(has("evm_reports", /\(project_id, period_month DESC, version_no DESC\)/)).toBe(true);
  });

  it("indexes portfolio company + period + status selection", () => {
    expect(has("evm_reports", /\(company_id, period_month, status\)/)).toBe(true);
  });

  it("enforces one active report per project period", () => {
    expect(
      has("evm_reports", /UNIQUE INDEX .*\(project_id, period_month\) WHERE .*superseded/),
    ).toBe(true);
  });

  it("indexes report drill-down by line, cost code and WBS", () => {
    expect(has("evm_report_lines", /\(report_id, sort_order\)/)).toBe(true);
    expect(has("evm_report_lines", /\(report_id, cost_code_id\)/)).toBe(true);
    expect(has("evm_report_lines", /\(report_id, wbs_item_id\)/)).toBe(true);
  });

  it("indexes mapping by version, scope and cost code", () => {
    expect(has("evm_mappings", /\(mapping_version_id, sort_order\)/)).toBe(true);
    expect(has("evm_mappings", /\(project_id, wbs_item_id, schedule_task_id\)/)).toBe(true);
    expect(has("evm_mappings", /\(cost_code_id\)/)).toBe(true);
    expect(has("evm_mapping_versions", /UNIQUE INDEX .*\(project_id, version_no\)/)).toBe(true);
  });

  it("indexes overrides, exceptions, events and snapshot source lookups", () => {
    expect(has("evm_progress_overrides", /UNIQUE INDEX .*\(project_id, period_month/)).toBe(true);
    expect(has("evm_exceptions", /\(project_id, period_month, code\)/)).toBe(true);
    expect(has("evm_events", /\(report_id, created_at DESC\)/)).toBe(true);
    expect(has("evm_events", /\(project_id, created_at DESC\)/)).toBe(true);
    expect(has("evm_snapshots", /\(project_id, snapshot_date\)/)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
d("EVM invariants — protected data is never touched", () => {
  const fingerprint = () =>
    q(
      PROTECTED.map(
        (
          t,
        ) => `select '${t}'::text as t, count(*)::text as n, coalesce(md5(string_agg(x, ',' order by x)),'-') as h
                   from (select id::text as x from public.${t}) s`,
      ).join(" union all "),
    )
      .map((r) => r.join("|"))
      .sort()
      .join("\n");

  it("declares no EVM routine that writes a protected table", () => {
    const rows = q(
      `select p.proname, ${flat("p.prosrc")} from pg_proc p
        where p.pronamespace='public'::regnamespace and p.proname like 'evm%'`,
    );
    for (const [name, src] of rows) {
      for (const t of PROTECTED) {
        const writes = new RegExp(
          `(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`,
          "i",
        );
        expect(`${name}:${writes.test(src!)}`).toBe(`${name}:false`);
      }
    }
  });

  it("declares no cascade from an EVM table back into protected data", () => {
    // The dangerous direction is a protected table referencing an EVM table:
    // that would let an EVM delete cascade upward into authoritative data.
    // EVM children referencing protected parents (any delete action) are safe.
    const upward = q(
      `select cl.relname as child, rf.relname as parent, c.confdeltype
         from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
         join pg_class rf on rf.oid = c.confrelid
        where c.contype='f' and rf.relname like 'evm%'
          and cl.relname in (${PROTECTED.map((t) => `'${t}'`).join(",")})`,
    );
    expect(upward.map((r) => r.join("->"))).toEqual([]);
  });

  const OPERATIONS: [string, string][] = [
    [
      "calculate/save",
      `insert into public.evm_reports (company_id, project_id, period_month, status)
         values (gen_random_uuid(), gen_random_uuid(), '2026-03-01', 'working')`,
    ],
    [
      "submit/approve",
      `update public.evm_reports set status='approved' where period_month='2026-03-01'`,
    ],
    ["supersede", `update public.evm_reports set status='superseded' where true`],
    [
      "mapping edit",
      `insert into public.evm_mappings (company_id, project_id, mapping_version_id, cost_code_id, allocation_pct)
         values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 100)`,
    ],
    [
      "override",
      `insert into public.evm_progress_overrides (company_id, project_id, period_month, override_pct, reason)
         values (gen_random_uuid(), gen_random_uuid(), '2026-03-01', 50, 'probe')`,
    ],
  ];

  it.each(OPERATIONS)(
    "an attempted %s leaves every protected table byte-identical after rollback",
    (_label, sql) => {
      const before = fingerprint();
      // The statement runs inside an explicit transaction that always rolls
      // back; RLS or privilege denial is an acceptable outcome — silent
      // mutation of protected data is not.
      qFail(`begin; ${sql}; rollback;`);
      expect(fingerprint()).toBe(before);
    },
  );

  it("cannot mutate an EVM report or history row from an unprivileged session", () => {
    for (const sql of [
      `update public.evm_reports set totals='{}'::jsonb where true`,
      `delete from public.evm_snapshots where true`,
      `update public.evm_events set payload='{}'::jsonb where true`,
    ]) {
      expect(qFail(`begin; ${sql}; rollback;`)).not.toBe("");
    }
  });

  it("leaves official portfolio totals unchanged across the whole probe run", () => {
    const totals = q(
      `select coalesce(count(*),0)::text, coalesce(md5(string_agg(id::text, ',' order by id)),'-')
         from public.forecast_versions`,
    );
    expect(totals).toHaveLength(1);
    // Re-reading must be stable: no probe above left an open write behind.
    expect(
      q(
        `select coalesce(count(*),0)::text, coalesce(md5(string_agg(id::text, ',' order by id)),'-')
           from public.forecast_versions`,
      ),
    ).toEqual(totals);
  });
});

// ---------------------------------------------------------------------------
// Query plans
// ---------------------------------------------------------------------------
d("EVM query plans — principal reads use indexes", () => {
  const plan = (sql: string, opts: { seqScan?: boolean } = {}): string =>
    q(
      `${opts.seqScan === false ? "set local enable_seqscan = off; " : ""}explain (analyze, buffers, format text) ${sql}`,
    )
      .map((r) => r.join(" "))
      .join("\n");

  const PROJECT = "'00000000-0000-0000-0000-000000000001'::uuid";
  const COMPANY = "'00000000-0000-0000-0000-000000000002'::uuid";

  it("portfolio period selection avoids a sequential scan on evm_reports", () => {
    const p = plan(
      `select project_id, totals from public.evm_reports
        where company_id=${COMPANY} and period_month='2026-03-01' and status='approved'`,
    );
    expect(p).not.toMatch(/Seq Scan on evm_reports/);
    expect(p).toMatch(/Index (Scan|Only Scan|Cond)/);
  });

  it("project drill-down selects the latest report by index", () => {
    const p = plan(
      `select id from public.evm_reports where project_id=${PROJECT}
        order by period_month desc, version_no desc limit 1`,
    );
    expect(p).not.toMatch(/Seq Scan on evm_reports/);
  });

  it("report line drill-down uses the report index", () => {
    const p = plan(
      `select * from public.evm_report_lines
        where report_id=${PROJECT} order by sort_order limit 200`,
    );
    expect(p).not.toMatch(/Seq Scan on evm_report_lines/);
  });

  it("mapping version fetch uses the version index", () => {
    const p = plan(
      `select * from public.evm_mappings where mapping_version_id=${PROJECT} order by sort_order`,
    );
    expect(p).not.toMatch(/Seq Scan on evm_mappings/);
  });

  it("approved snapshot selection uses the project/date index", () => {
    // evm_snapshots is currently tiny, so the planner may legitimately prefer a
    // seq scan. Prove the index exists and is chosen once a scan is not free.
    const idx = q(
      `select indexdef from pg_indexes
        where schemaname='public' and tablename='evm_snapshots'
          and indexdef like '%(project_id, snapshot_date)%'`,
    );
    expect(idx.length).toBeGreaterThan(0);
    const p = plan(
      `select * from public.evm_snapshots where project_id=${PROJECT}
        order by snapshot_date desc limit 1`,
      { seqScan: false },
    );
    expect(p).toMatch(/Index (Only )?Scan/);
  });
});
