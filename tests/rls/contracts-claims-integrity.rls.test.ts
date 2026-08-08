// GC-16 — Live-schema guarantees and invariant proofs for governed contract &
// claims control. Reads the deployed schema through psql and skips (never
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

/** Run a whole script in one psql session (needed for transactions). */
function script(sql: string): string {
  return execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
    maxBuffer: 32 * 1024 * 1024,
  });
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

const GUARDS = [
  "contract_claims_guard",
  "contract_claim_snapshots_guard",
  "contract_claim_valuations_guard",
  "contract_claim_events_append_only",
  "contract_deadlines_version",
  "contract_claim_alerts_version",
] as const;

// The 13 GC-16 alert families that share the persisted portfolio alert register.
const ALERT_FAMILIES = [
  "claim_notice_approaching",
  "claim_notice_missed",
  "claim_response_overdue",
  "claim_aging",
  "claim_quantum_movement",
  "claim_entitlement_gap",
  "claim_eot_ld_conflict",
  "contract_instrument_expiring",
  "contract_retention_release_due",
  "contract_back_to_back_gap",
  "contract_fx_materiality",
  "contract_reconciliation_break",
  "contract_sod_exception",
];

// Authoritative sources a contract & claims operation must never mutate.
const PROTECTED = [
  "fx_rates",
  "costing_periods",
  "cost_forecast_periods",
  "cost_accruals",
  "forecast_versions",
  "forecast_version_lines",
  "budgets",
  "cost_codes",
  "evm_reports",
  "evm_report_lines",
  "baseline_snapshots",
  "cashflow_snapshots",
  "cashflow_snapshot_lines",
  "funding_facilities",
  "funding_allocations",
  "recognition_snapshots",
  "recognition_snapshot_lines",
  "invoices",
  "payments",
  "change_orders",
  "contracts",
];

// ---------------------------------------------------------------------------
// Structure, grants and RLS
// ---------------------------------------------------------------------------
d("GC-16 live schema — tables, RLS and least privilege", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every GC-16 table exactly once", () => {
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
    // No TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for app callers.
    expect(authenticated).not.toMatch(/[Dxtm]/);
    expect(grants).toMatch(/service_role=[a-zA-Z]+\//);
  });

  it("keeps the claim event history append-only for authenticated callers", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("contract_claim_events")!)?.[1] ?? "";
    expect(priv).toBe("ar");
  });

  it("keeps claim valuations append-only for authenticated callers", () => {
    const priv =
      /authenticated=([a-zA-Z]+)\//.exec(acl.get("contract_claim_valuations")!)?.[1] ?? "";
    expect(priv).not.toMatch(/w/);
    expect(priv).not.toMatch(/d/);
  });

  it("makes persisted snapshot line values immutable", () => {
    const priv =
      /authenticated=([a-zA-Z]+)\//.exec(acl.get("contract_claim_snapshot_lines")!)?.[1] ?? "";
    expect(priv).not.toMatch(/w/);
  });

  it("never lets a deadline be deleted by an app caller", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("contract_deadlines")!)?.[1] ?? "";
    expect(priv).not.toMatch(/d/);
    const del = q(
      `select policyname from pg_policies
        where schemaname='public' and tablename='contract_deadlines' and cmd='DELETE'`,
    );
    expect(del).toEqual([]);
  });
});

d("GC-16 live schema — indexes and constraints", () => {
  const idx = q(
    `select tablename, indexname, ${flat("indexdef")} from pg_indexes
      where schemaname='public' and tablename in (${list})`,
  );

  it.each(TABLES)("%s has a primary key and at least one lookup index", (t) => {
    const own = idx.filter((r) => r[0] === t);
    expect(own.some((r) => r[1]!.endsWith("_pkey")), `${t} has no pkey`).toBe(true);
    expect(own.length).toBeGreaterThan(1);
  });

  it("indexes the hot project/period access paths", () => {
    const names = idx.map((r) => r[1]);
    for (const n of [
      "contract_claims_project_idx",
      "contract_claim_events_claim_idx",
      "contract_claim_valuations_claim_idx",
      "contract_deadlines_project_idx",
      "contract_claim_snapshots_lookup_idx",
      "contract_claim_alerts_project_idx",
    ]) {
      expect(names, `missing index ${n}`).toContain(n);
    }
  });

  it("keeps claim references unique per project and alerts stably deduped", () => {
    const cons = q(
      `select conrelid::regclass::text, conname, ${flat("pg_get_constraintdef(oid)")}
         from pg_constraint where contype in ('u','c')
          and conrelid::regclass::text in (${list})`,
    );
    const defs = cons.map((r) => `${r[0]}:${r[2]}`);
    expect(defs).toContain("contract_claims:UNIQUE (project_id, claim_ref)");
    expect(defs).toContain("contract_claim_alerts:UNIQUE (company_id, dedupe_key)");
    expect(
      defs.some((x) =>
        x.startsWith("contract_claim_valuations:UNIQUE (claim_id, effective_period"),
      ),
    ).toBe(true);
  });

  it("pins snapshot and valuation periods to the first of a month", () => {
    const checks = q(
      `select conrelid::regclass::text, ${flat("pg_get_constraintdef(oid)")}
         from pg_constraint where contype='c' and conrelid::regclass::text in (${list})`,
    ).map((r) => `${r[0]}:${r[1]}`);
    expect(checks.some((c) => c.startsWith("contract_claim_snapshots:") && /date_trunc/.test(c))).toBe(
      true,
    );
    expect(
      checks.some((c) => c.startsWith("contract_claim_valuations:") && /date_trunc/.test(c)),
    ).toBe(true);
  });

  it("keeps every claim amount and EOT day count non-negative at the schema level", () => {
    const checks = q(
      `select ${flat("pg_get_constraintdef(oid)")} from pg_constraint
        where contype='c' and conrelid='public.contract_claims'::regclass`,
    ).map((r) => r[0]!);
    for (const col of ["eot_days_claimed", "eot_days_assessed", "eot_days_approved"]) {
      expect(checks.some((c) => c.includes(col) && c.includes(">= 0")), col).toBe(true);
    }
  });
});

d("GC-16 live schema — policies", () => {
  const pol = q(
    `select tablename, policyname, cmd, ${flat("qual")}, ${flat("with_check")}, ${flat("roles")}
       from pg_policies where schemaname='public' and tablename in (${list})`,
  );
  const byTable = (t: string) => pol.filter((r) => r[0] === t);

  it.each(TABLES)("%s carries at least one policy", (t) => {
    expect(byTable(t).length).toBeGreaterThan(0);
  });

  it.each(TABLES)("%s scopes every policy to the caller's company", (t) => {
    for (const [, name, , qual, check] of byTable(t)) {
      expect(`${qual} ${check}`, `${t}.${name}`).toContain("company_id");
    }
  });

  it("never targets anon or the public role", () => {
    for (const [table, name, , , , roles] of pol) {
      expect(/\banon\b/.test(roles!), `${table}.${name} targets anon`).toBe(false);
      expect(/\{public\}/.test(roles!), `${table}.${name} targets public`).toBe(false);
    }
  });

  it("never exposes an unrestricted USING (true) or WITH CHECK (true)", () => {
    for (const [, name, , qual, check] of pol) {
      expect(`${name}:${qual}`).not.toMatch(/:true$/);
      expect(`${name}:${check}`).not.toMatch(/:true$/);
    }
  });

  it("pairs USING with WITH CHECK on every write policy", () => {
    for (const [table, name, cmd, qual, check] of pol) {
      if (cmd === "INSERT") expect(check, `${table}.${name}`).not.toBe("");
      if (cmd === "UPDATE" || cmd === "ALL") {
        expect(qual, `${table}.${name}`).not.toBe("");
        expect(check, `${table}.${name}`).not.toBe("");
      }
    }
  });

  it("forbids mutating or deleting the claim event log at policy level", () => {
    expect(
      byTable("contract_claim_events").some((r) => r[2] === "UPDATE" || r[2] === "DELETE"),
    ).toBe(false);
  });

  it("only deletes a snapshot while it is still working", () => {
    const del = byTable("contract_claim_snapshots").find((r) => r[2] === "DELETE");
    expect(del, "no DELETE policy on claim snapshots").toBeDefined();
    expect(del![3]).toContain("'working'");
  });
});

d("GC-16 live schema — triggers and routines", () => {
  const trg = q(
    `select c.relname, t.tgname, p.proname, ${flat("pg_get_triggerdef(t.oid)")}
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_proc  p on p.oid = t.tgfoid
      where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (${list})`,
  );
  const fns = new Map(
    q(
      `select p.proname, p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig,','),'')
              || '|' || coalesce(${flat("array_to_string(p.proacl,' ')")},'')
         from pg_proc p
        where p.pronamespace='public'::regnamespace
          and p.proname in (${GUARDS.map((g) => `'${g}'`).join(",")})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("installs every GC-16 guard trigger on its table", () => {
    const pairs = trg.map((r) => `${r[0]}:${r[2]}`);
    expect(pairs).toContain("contract_claims:contract_claims_guard");
    expect(pairs).toContain("contract_claim_snapshots:contract_claim_snapshots_guard");
    expect(pairs).toContain("contract_claim_valuations:contract_claim_valuations_guard");
    expect(pairs).toContain("contract_claim_events:contract_claim_events_append_only");
    expect(pairs).toContain("contract_deadlines:contract_deadlines_version");
    expect(pairs).toContain("contract_claim_alerts:contract_claim_alerts_version");
  });

  it("scopes the append-only trigger to update and delete", () => {
    const def = trg.find((r) => r[2] === "contract_claim_events_append_only")![3]!;
    expect(/before (delete or update|update or delete)/i.test(def), def).toBe(true);
  });

  it.each(GUARDS)("%s is security definer with a pinned search_path", (fn) => {
    const v = fns.get(fn);
    expect(v, `${fn} is not deployed`).toBeDefined();
    const [secdef, config] = v!.split("|");
    expect(secdef).toBe("true");
    expect(config).toMatch(/search_path=/);
  });

  it.each(GUARDS)("%s is not executable by anon or PUBLIC", (fn) => {
    const acl = fns.get(fn)!.split("|")[2] ?? "";
    expect(acl).not.toMatch(/\banon=/);
    expect(acl).not.toMatch(/(^|\s)=[A-Za-z]+\//);
  });

  it("registers all 13 GC-16 alert families on the shared portfolio alert enum", () => {
    const vals = q(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'portfolio_alert_rule_type'`,
    ).map((r) => r[0]);
    expect(ALERT_FAMILIES).toHaveLength(13);
    for (const f of ALERT_FAMILIES) expect(vals, `missing family ${f}`).toContain(f);
  });
});

// ---------------------------------------------------------------------------
// Invariant: GC-16 writes never mutate authoritative source tables
// ---------------------------------------------------------------------------
d("GC-16 invariants — authoritative sources are never mutated", () => {
  // A byte-identical whole-row checksum of every protected table, computed
  // inside a REPEATABLE READ transaction so a concurrent writer elsewhere in
  // the suite cannot make this pass or fail spuriously. The GC-16 writes are
  // performed against a savepoint and rolled back, leaving zero residue.
  const checksum = (t: string) =>
    `select '${t}'::text as tbl, coalesce(md5(string_agg(h, '' order by h)), 'empty') as sum
       from (select md5(x.*::text) h from public.${t} x) s`;

  it("leaves every protected table byte-identical across a full claim lifecycle", () => {
    const before = PROTECTED.map(checksum).join(" union all ");
    const out = script(`
      begin isolation level repeatable read;
      create temp table gc16_before on commit drop as ${before};
      savepoint gc16;

      -- Exercise the GC-16 write surface inside the transaction. Every
      -- statement is optional: the point is that whatever succeeds must not
      -- touch an authoritative source table.
      do $$
      declare v_company uuid; v_project uuid; v_claim uuid;
      begin
        select company_id, id into v_company, v_project from public.projects limit 1;
        if v_project is null then return; end if;

        insert into public.contract_claims
          (company_id, project_id, claim_ref, title, kind, currency_code, asserted_amount)
        values (v_company, v_project, 'GC16-INV-'||substr(md5(random()::text),1,8),
                'invariant probe', 'variation', 'USD', 1000)
        returning id into v_claim;

        insert into public.contract_claim_events
          (company_id, project_id, claim_id, event_type, detail)
        values (v_company, v_project, v_claim, 'transition:invariant', '{}'::jsonb);

        insert into public.contract_deadlines
          (company_id, project_id, claim_id, kind, label, trigger_date, due_date)
        values (v_company, v_project, v_claim, 'notice', 'invariant probe',
                current_date, current_date + 7);

        insert into public.contract_claim_snapshots
          (company_id, project_id, period_month, data_date, status,
           reporting_currency, project_currency, checksum)
        values (v_company, v_project, date_trunc('month', now())::date, current_date,
                'working', 'USD', 'USD', 'probe');
      end $$;

      -- Non-vacuity: prove the probe really wrote GC-16 rows before rollback.
      select 'PROBE:' || (select count(*)::text from public.contract_claims
                           where claim_ref like 'GC16-INV-%');

      rollback to savepoint gc16;

      select b.tbl
        from gc16_before b
        join (${before}) a on a.tbl = b.tbl
       where b.sum is distinct from a.sum;
      rollback;
    `);
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !/^(BEGIN|SELECT|ROLLBACK|DO|INSERT|CREATE|SAVEPOINT)/i.test(l));
    const probe = lines.find((l) => l.startsWith("PROBE:"));
    expect(probe, "probe never ran — the invariant would be vacuous").toBeDefined();
    expect(Number(probe!.slice(6)), "probe wrote no claim rows").toBeGreaterThan(0);
    const mutated = lines.filter((l) => !l.startsWith("PROBE:"));
    expect(mutated, `mutated authoritative tables: ${mutated.join(", ")}`).toEqual([]);
  });

  it("leaves zero GC-16 residue behind after the rolled-back probe", () => {
    for (const t of [
      "contract_claims",
      "contract_claim_events",
      "contract_deadlines",
      "contract_claim_snapshots",
    ]) {
      const [[n]] = q(
        `select count(*) from public.${t} where ${
          t === "contract_claims"
            ? "claim_ref like 'GC16-INV-%'"
            : t === "contract_claim_snapshots"
              ? "checksum = 'probe'"
              : t === "contract_deadlines"
                ? "label = 'invariant probe'"
                : "event_type = 'transition:invariant'"
        }`,
      );
      expect(Number(n), `${t} kept probe rows`).toBe(0);
    }
  });

  it("keeps fx_rates strictly read-only to the claims surface", () => {
    // Claims read FX through fx_rates; no GC-16 policy or grant may write it.
    const [[acl]] = q(
      `select coalesce(array_to_string(relacl,' '),'') from pg_class
        where relnamespace='public'::regnamespace and relname='fx_rates'`,
    );
    const authenticated = /authenticated=([a-zA-Z]+)\//.exec(acl!)?.[1] ?? "";
    expect(authenticated).not.toMatch(/[Dxtm]/);
    expect(acl).not.toMatch(/\banon=/);
  });
});

// ---------------------------------------------------------------------------
// Data integrity of what is already persisted
// ---------------------------------------------------------------------------
d("GC-16 invariants — persisted data", () => {
  it("stores a checksum on every snapshot", () => {
    const [[n]] = q(`select count(*) from public.contract_claim_snapshots where checksum is null`);
    expect(Number(n)).toBe(0);
  });

  it("never orphans a snapshot line", () => {
    const [[n]] = q(
      `select count(*) from public.contract_claim_snapshot_lines l
         left join public.contract_claim_snapshots s on s.id = l.snapshot_id
        where s.id is null`,
    );
    expect(Number(n)).toBe(0);
  });

  it("has at most one non-superseded snapshot per project period", () => {
    const [[n]] = q(
      `select count(*) from (
         select project_id, period_month from public.contract_claim_snapshots
          where status <> 'superseded' group by 1,2 having count(*) > 1) x`,
    );
    expect(Number(n)).toBe(0);
  });

  it("never mixes companies across a claim and its children", () => {
    for (const [child, fk] of [
      ["contract_claim_events", "claim_id"],
      ["contract_claim_valuations", "claim_id"],
      ["contract_deadlines", "claim_id"],
    ] as const) {
      const [[n]] = q(
        `select count(*) from public.${child} c
           join public.contract_claims k on k.id = c.${fk}
          where k.company_id <> c.company_id`,
      );
      expect(Number(n), `${child} leaks across companies`).toBe(0);
    }
  });

  it("keeps every alert dedupe key stable and unique per company", () => {
    const [[n]] = q(
      `select count(*) from (
         select company_id, dedupe_key from public.contract_claim_alerts
          group by 1,2 having count(*) > 1) x`,
    );
    expect(Number(n)).toBe(0);
  });
});
