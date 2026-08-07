// GC-10 — live-schema guarantees for portfolio finance alerts.
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

const TABLES = ["portfolio_alerts", "portfolio_alert_configs", "portfolio_alert_events"] as const;

function acl(table: string): string {
  return (
    q(
      `select ${flat("array_to_string(relacl,' ')")} || '|' || relrowsecurity
         from pg_class where relnamespace='public'::regnamespace and relname = '${table}'`,
    )[0]?.[0] ?? ""
  );
}

function policies(
  table: string,
): Map<string, { cmd: string; using: string; check: string; roles: string }> {
  const out = new Map<string, { cmd: string; using: string; check: string; roles: string }>();
  for (const [row] of q(
    `select polname || '\u0002' || polcmd::text || '\u0002' || ${flat("pg_get_expr(polqual, polrelid)")}
            || '\u0002' || ${flat("pg_get_expr(polwithcheck, polrelid)")}
            || '\u0002' || ${flat("array_to_string(polroles::regrole[], ',')")}
       from pg_policy where polrelid = 'public.${table}'::regclass`,
  )) {
    const [name, cmd, using, check, roles] = row!.split("\u0002");
    out.set(name!, { cmd: cmd!, using: using!, check: check!, roles: roles! });
  }
  return out;
}

d("portfolio alert tables — grants and RLS", () => {
  for (const table of TABLES) {
    it(`${table} exists with RLS enabled`, () => {
      expect(acl(table).endsWith("|true")).toBe(true);
    });

    it(`${table} grants nothing to anon or PUBLIC`, () => {
      const a = acl(table);
      expect(a).not.toMatch(/\banon=/);
      expect(a).not.toMatch(/(^|\s)=[a-zA-Z]+\//);
    });

    it(`${table} grants explicit privileges to authenticated and service_role`, () => {
      const a = acl(table);
      expect(a).toMatch(/authenticated=[a-zA-Z]+\//);
      expect(a).toMatch(/service_role=[a-zA-Z]+\//);
    });

    it(`${table} applies every policy to authenticated only`, () => {
      const ps = policies(table);
      expect(ps.size).toBeGreaterThan(0);
      for (const p of ps.values()) {
        expect(p.roles).toBe("authenticated");
      }
    });

    it(`${table} scopes every policy to the caller's company`, () => {
      for (const p of policies(table).values()) {
        expect(`${p.using} ${p.check}`).toContain("is_company_member(company_id)");
      }
    });
  }
});

d("portfolio_alerts — visibility and write authority", () => {
  const ps = policies("portfolio_alerts");

  it("lets finance leadership, the owner or a project member read", () => {
    const p = ps.get("pal_select")!;
    expect(p.using).toContain("has_company_role('finance_admin'::app_role)");
    expect(p.using).toContain("has_company_role('company_admin'::app_role)");
    expect(p.using).toContain("owner_id = auth.uid()");
    expect(p.using).toContain("project_members");
  });

  it("restricts inserts to finance leadership", () => {
    const p = ps.get("pal_insert")!;
    expect(p.check).toContain("has_company_role('finance_admin'::app_role)");
    expect(p.check).not.toContain("project_members");
  });

  it("has both USING and WITH CHECK on update", () => {
    const p = ps.get("pal_update")!;
    expect(p.using.length).toBeGreaterThan(0);
    expect(p.check.length).toBeGreaterThan(0);
    expect(p.check).toContain("is_company_member(company_id)");
  });

  it("exposes no DELETE policy — the register is never silently purged", () => {
    expect([...ps.values()].some((p) => p.cmd === "d")).toBe(false);
  });

  it("deduplicates conditions with a unique fingerprint per company", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='portfolio_alerts'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /UNIQUE.*\(company_id, fingerprint\)/.test(i))).toBe(true);
  });

  it("indexes the inbox, period, project, owner and SLA queries", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='portfolio_alerts'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /company_id, status, severity, last_seen_at DESC/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, period_month, rule_type/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, project_id, status/.test(i))).toBe(true);
    expect(idx.some((i) => /owner_id, status/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, ack_due_at/.test(i))).toBe(true);
  });

  it("uses an index for the principal inbox query", () => {
    const plan = q(
      `explain (costs off) select id from public.portfolio_alerts
         where company_id = '00000000-0000-0000-0000-000000000000'
           and status = 'open'
         order by severity, last_seen_at desc limit 50`,
    )
      .map(([p]) => p!)
      .join(" ");
    expect(plan).not.toMatch(/Seq Scan on portfolio_alerts/);
  });

  it("uses an index for the SLA-overdue escalation sweep", () => {
    const plan = q(
      `explain (costs off) select id from public.portfolio_alerts
         where company_id = '00000000-0000-0000-0000-000000000000'
           and status = 'open' and ack_due_at < now()`,
    )
      .map(([p]) => p!)
      .join(" ");
    expect(plan).not.toMatch(/Seq Scan on portfolio_alerts/);
  });
});

d("portfolio_alert_events — immutable, company-scoped history", () => {
  const ps = policies("portfolio_alert_events");

  it("has no UPDATE or DELETE policy", () => {
    const cmds = [...ps.values()].map((p) => p.cmd);
    expect(cmds).not.toContain("w");
    expect(cmds).not.toContain("d");
  });

  it("grants no UPDATE or DELETE privilege to authenticated", () => {
    const grants = q(
      `select a.privilege_type from pg_class c,
              aclexplode(c.relacl) a
         where c.relnamespace = 'public'::regnamespace
           and c.relname = 'portfolio_alert_events'
           and a.grantee = 'authenticated'::regrole`,
    ).map(([p]) => p!);
    expect(grants).toContain("SELECT");
    expect(grants).toContain("INSERT");
    expect(grants).not.toContain("UPDATE");
    expect(grants).not.toContain("DELETE");
  });

  it("ties every inserted event to an alert in the same company", () => {
    const p = ps.get("pae_insert")!;
    expect(p.check).toContain("portfolio_alerts a");
    expect(p.check).toContain("a.company_id = portfolio_alert_events.company_id");
  });

  it("lets finance leadership or the alert owner read the history", () => {
    const p = ps.get("pae_select")!;
    expect(p.using).toContain("has_company_role('finance_admin'::app_role)");
    expect(p.using).toContain("a.owner_id = auth.uid()");
  });

  it("indexes history lookups per alert and per company", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='portfolio_alert_events'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /alert_id, created_at DESC/.test(i))).toBe(true);
    expect(idx.some((i) => /company_id, created_at DESC/.test(i))).toBe(true);
  });
});

d("portfolio_alert_configs — finance-only tuning", () => {
  const ps = policies("portfolio_alert_configs");

  it("lets any company member read the thresholds in force", () => {
    expect(ps.get("pac_select")!.using).toContain("is_company_member(company_id)");
  });

  it("restricts every write to finance or company admins", () => {
    const p = ps.get("pac_write")!;
    expect(p.using).toContain("has_company_role('finance_admin'::app_role)");
    expect(p.check).toContain("has_company_role('company_admin'::app_role)");
  });

  it("keeps one configuration row per company and rule", () => {
    const idx = q(
      `select indexdef from pg_indexes where schemaname='public' and tablename='portfolio_alert_configs'`,
    ).map(([i]) => i!);
    expect(idx.some((i) => /UNIQUE.*\(company_id, rule_type\)/.test(i))).toBe(true);
  });

  it("has no duplicate rule rows in live data", () => {
    const bad = q(
      `select count(*) from (select company_id, rule_type from public.portfolio_alert_configs
         group by 1,2 having count(*) > 1) x`,
    )[0]![0];
    expect(bad).toBe("0");
  });
});

d("portfolio_alerts_try_lock — concurrency guard", () => {
  const [row] = q(
    `select ${flat("array_to_string(proconfig,' ')")} || '\u0002' || ${flat("proacl")}
       || '\u0002' || prosecdef::text || '\u0002' || ${flat("pg_get_functiondef(oid)")}
       from pg_proc where proname = 'portfolio_alerts_try_lock'`,
  );

  it("exists as a security-definer routine with a pinned search_path", () => {
    expect(row).toBeDefined();
    const [cfg, , secdef] = row![0]!.split("\u0002");
    expect(cfg).toContain("search_path=public");
    expect(secdef).toBe("true");
  });

  it("is not executable by PUBLIC, anon or authenticated", () => {
    const a = row![0]!.split("\u0002")[1]!;
    expect(a).not.toMatch(/(^|\{|,)=X\//);
    expect(a).not.toMatch(/anon=X/);
    expect(a).not.toMatch(/authenticated=X/);
    expect(a).toMatch(/service_role=X/);
  });

  it("uses a transaction-scoped advisory lock so overlapping runs cannot double-write", () => {
    const def = row![0]!.split("\u0002")[3]!;
    expect(def).toContain("pg_try_advisory_xact_lock");
  });
});
