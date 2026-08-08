// GC-16d/e — Live-schema guarantees for governed calendar policy administration
// and versioned observed-holiday sets. Reads the deployed schema through psql
// and skips (never silently passes) without managed PG* env vars.
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

function script(sql: string): string {
  return execFileSync("psql", ["-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    input: sql,
    maxBuffer: 32 * 1024 * 1024,
  });
}

const TABLES = [
  "calendar_holiday_sets",
  "calendar_holiday_dates",
  "calendar_policy_changes",
] as const;
const list = TABLES.map((t) => `'${t}'`).join(",");

const GUARDS = [
  "calendar_holiday_sets_guard",
  "calendar_holiday_dates_guard",
  "calendar_policy_changes_guard",
] as const;

// Authoritative sources a calendar-governance operation must never mutate.
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
  "recognition_snapshots",
  "recognition_snapshot_lines",
  "contract_claims",
  "contract_claim_valuations",
  "contract_claim_snapshots",
  "invoices",
  "payments",
];

// ---------------------------------------------------------------------------
// Structure, RLS and least privilege
// ---------------------------------------------------------------------------
d("GC-16d live schema — tables, RLS and least privilege", () => {
  const acl = new Map(
    q(
      `select relname, ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class
        where relnamespace='public'::regnamespace and relkind='r' and relname in (${list})`,
    ).map(([n, v]) => [n, v!]),
  );

  it("deploys every GC-16d table exactly once", () => {
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

  it("never lets an app caller delete governed policy-change history", () => {
    const priv = /authenticated=([a-zA-Z]+)\//.exec(acl.get("calendar_policy_changes")!)?.[1] ?? "";
    expect(priv).not.toMatch(/d/);
    const del = q(
      `select policyname from pg_policies
        where schemaname='public' and tablename='calendar_policy_changes' and cmd='DELETE'`,
    );
    expect(del).toEqual([]);
  });

  it.each(TABLES)("%s exposes policies only to authenticated", (t) => {
    const rows = q(
      `select policyname, roles::text from pg_policies
        where schemaname='public' and tablename='${t}'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const [, roles] of rows) {
      expect(roles).toBe("{authenticated}");
    }
  });
});

// ---------------------------------------------------------------------------
// Indexes, constraints and concurrency/idempotency support
// ---------------------------------------------------------------------------
d("GC-16d live schema — indexes and constraints", () => {
  const idx = q(
    `select tablename, indexname, ${flat("indexdef")} from pg_indexes
      where schemaname='public' and tablename in (${list})`,
  );

  it.each(TABLES)("%s has a primary key and at least one lookup index", (t) => {
    const own = idx.filter((r) => r[0] === t);
    expect(own.some((r) => r[1]!.endsWith("_pkey"))).toBe(true);
    expect(own.length).toBeGreaterThan(1);
  });

  it("indexes the governed lookup paths", () => {
    const names = idx.map((r) => r[1]);
    for (const n of [
      "calendar_holiday_sets_lookup_idx",
      "calendar_holiday_dates_set_idx",
      "calendar_policy_changes_queue_idx",
      "calendar_policy_changes_contract_idx",
    ]) {
      expect(names, `missing index ${n}`).toContain(n);
    }
  });

  const cons = q(
    `select conrelid::regclass::text, conname, ${flat("pg_get_constraintdef(oid)")}
       from pg_constraint where contype in ('u','c')
        and conrelid::regclass::text in (${list})`,
  );
  const defs = cons.map((r) => `${r[0]}:${r[2]}`);

  it("versions a holiday set uniquely per company, calendar and year", () => {
    expect(defs).toContain("calendar_holiday_sets:UNIQUE (company_id, calendar_id, year, version)");
  });

  it("keeps one observed date per set version", () => {
    expect(defs).toContain("calendar_holiday_dates:UNIQUE (set_id, observed_date)");
  });

  it("makes a policy change request idempotent per company", () => {
    expect(defs).toContain("calendar_policy_changes:UNIQUE (company_id, idempotency_key)");
  });

  it("constrains the governed vocabulary at the database boundary", () => {
    const all = defs.join(" ");
    for (const token of [
      "iso-std",
      "mena-jo",
      "mena-gulf",
      "mena-eg",
      "draft",
      "approved",
      "superseded",
      "public_holiday",
      "exceptional_closure",
      "pending",
      "rejected",
      "applied",
    ]) {
      expect(all, `missing constrained token ${token}`).toContain(token);
    }
  });

  it("forces a contract-scoped change to name its contract and a company-scoped one not to", () => {
    expect(
      defs.some(
        (x) =>
          x.startsWith("calendar_policy_changes:") &&
          x.includes("scope = 'company'") &&
          x.includes("contract_id IS NULL"),
      ),
    ).toBe(true);
  });

  it("carries an optimistic-concurrency row_version on every governed table", () => {
    const cols = q(
      `select table_name, column_name from information_schema.columns
        where table_schema='public' and column_name='row_version' and table_name in (${list})`,
    ).map((r) => r[0]);
    expect(cols).toContain("calendar_holiday_sets");
    expect(cols).toContain("calendar_policy_changes");
  });
});

// ---------------------------------------------------------------------------
// Guard routines
// ---------------------------------------------------------------------------
d("GC-16d guard routines", () => {
  const procs = new Map(
    q(
      `select proname, prosecdef::text || '|' || coalesce(array_to_string(proconfig,','),'')
         from pg_proc where pronamespace='public'::regnamespace
          and proname in (${GUARDS.map((g) => `'${g}'`).join(",")})`,
    ).map(([n, v]) => [n, v!]),
  );

  it.each(GUARDS)("%s is deployed", (g) => {
    expect(procs.has(g)).toBe(true);
  });

  it.each(GUARDS)("%s pins its search_path", (g) => {
    expect(procs.get(g)!).toMatch(/search_path=/);
  });

  it.each(TABLES)("%s has its guard trigger attached", (t) => {
    const rows = q(
      `select tgname from pg_trigger where tgrelid='public.${t}'::regclass and not tgisinternal`,
    ).map((r) => r[0]);
    expect(rows.some((n) => n!.includes("guard"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GC-16d provenance on deadlines
// ---------------------------------------------------------------------------
d("GC-16d deadline provenance", () => {
  const cols = new Map(
    q(
      `select column_name, is_nullable from information_schema.columns
        where table_schema='public' and table_name='contract_deadlines'`,
    ).map(([c, n]) => [c, n]),
  );

  it("records the folded holiday-set versions on every deadline", () => {
    expect(cols.get("holiday_set_versions")).toBe("NO");
  });

  it("flags a frozen deadline so recalculation can never move it", () => {
    expect(cols.get("calendar_frozen")).toBe("NO");
  });

  it("keeps calendar identity, version, source and timezone alongside it", () => {
    for (const c of ["calendar_id", "calendar_version", "calendar_source", "timezone"]) {
      expect(cols.has(c), `contract_deadlines.${c} must exist`).toBe(true);
    }
  });

  it("never leaves a persisted deadline without full calendar provenance", () => {
    const [[bad]] = q(
      `select count(*) from public.contract_deadlines
        where calendar_id is not null and (calendar_version is null or calendar_source is null)`,
    );
    expect(Number(bad)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Persisted-data invariants
// ---------------------------------------------------------------------------
d("GC-16d invariants — persisted data", () => {
  it("never orphans an observed date", () => {
    const [[n]] = q(
      `select count(*) from public.calendar_holiday_dates d
         left join public.calendar_holiday_sets s on s.id = d.set_id
        where s.id is null`,
    );
    expect(Number(n)).toBe(0);
  });

  it("records approval provenance on every approved set", () => {
    const [[n]] = q(
      `select count(*) from public.calendar_holiday_sets
        where status = 'approved' and (approved_by is null or approved_at is null)`,
    );
    expect(Number(n)).toBe(0);
  });

  it("keeps requester and approver distinct on every decided change (segregation of duties)", () => {
    const [[n]] = q(
      `select count(*) from public.calendar_policy_changes
        where decided_by is not null and decided_by = requested_by and material`,
    );
    expect(Number(n)).toBe(0);
  });

  it("has no decided change without a decision timestamp", () => {
    const [[n]] = q(
      `select count(*) from public.calendar_policy_changes
        where status in ('approved','rejected','applied')
          and (decided_by is null or decided_at is null)`,
    );
    expect(Number(n)).toBe(0);
  });

  it("carries a reason on every governed change", () => {
    const [[n]] = q(
      `select count(*) from public.calendar_policy_changes
        where coalesce(btrim(reason),'') = ''`,
    );
    expect(Number(n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Checksum invariant — calendar governance must not touch authoritative sources
// ---------------------------------------------------------------------------
d("GC-16d invariant — authoritative sources are untouched", () => {
  const before = `
    select t.tbl,
           coalesce(md5(string_agg(t.row_text, '|' order by t.row_text)), 'EMPTY') as sum
      from (
        ${PROTECTED.map(
          (t) => `select '${t}'::text as tbl, md5(x::text) as row_text from public.${t} x`,
        ).join(" union all ")}
      ) t
     group by t.tbl`;

  it("writes calendar governance rows without mutating any authoritative table", () => {
    const out = script(`
      begin isolation level repeatable read;
      create temp table gc16d_before on commit drop as ${before};
      savepoint gc16d;

      do $$
      declare v_company uuid;
      declare v_set uuid;
      begin
        select id into v_company from public.companies order by created_at limit 1;
        if v_company is null then raise exception 'no company'; end if;

        insert into public.calendar_holiday_sets
          (company_id, calendar_id, jurisdiction, year, version, label, status, source_reference)
        values (v_company, 'mena-jo', 'GC16D-INV', 2199, 'inv', 'GC16D invariant probe',
                'draft', 'invariant-probe')
        returning id into v_set;

        insert into public.calendar_holiday_dates
          (set_id, company_id, observed_date, label_en, label_ar, kind)
        values (v_set, v_company, '2199-03-20', 'GC16D probe', 'اختبار', 'public_holiday');

        insert into public.calendar_policy_changes
          (company_id, scope, contract_id, to_calendar_id, to_timezone, material,
           status, reason, idempotency_key)
        values (v_company, 'company', null, 'mena-jo', 'Asia/Amman', true,
                'pending', 'GC16D invariant probe', 'GC16D-INV-' || gen_random_uuid()::text);
      end $$;

      select 'PROBE:' || (select count(*)::text from public.calendar_holiday_sets
                           where jurisdiction = 'GC16D-INV');

      rollback to savepoint gc16d;

      select b.tbl
        from gc16d_before b
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
    expect(Number(probe!.slice(6)), "probe wrote no holiday sets").toBeGreaterThan(0);
    const mutated = lines.filter((l) => !l.startsWith("PROBE:"));
    expect(mutated, `mutated authoritative tables: ${mutated.join(", ")}`).toEqual([]);
  });

  it("leaves zero GC-16d residue behind after the rolled-back probe", () => {
    const [[sets]] = q(
      `select count(*) from public.calendar_holiday_sets where jurisdiction = 'GC16D-INV'`,
    );
    expect(Number(sets)).toBe(0);
    const [[changes]] = q(
      `select count(*) from public.calendar_policy_changes where idempotency_key like 'GC16D-INV-%'`,
    );
    expect(Number(changes)).toBe(0);
  });
});
