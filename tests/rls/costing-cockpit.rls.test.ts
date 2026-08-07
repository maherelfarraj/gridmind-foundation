// GC-07 — live-schema guarantees for the Period Close Cockpit (checklists,
// exceptions, evidence). Reads the deployed schema through psql and skips
// (never silently passes) without managed PG* env vars.
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
  "costing_checklist_templates",
  "costing_checklist_template_items",
  "costing_checklist_runs",
  "costing_checklist_items",
  "costing_checklist_evidence",
  "costing_exceptions",
] as const;

/** Period artefacts whose lifecycle is RPC-only for authenticated callers. */
const RPC_ONLY = [
  "costing_checklist_runs",
  "costing_checklist_items",
  "costing_exceptions",
] as const;

const RPCS = [
  "ensure_costing_checklist_template",
  "ensure_costing_checklist",
  "update_costing_checklist_item",
  "upsert_costing_exception",
  "resolve_costing_exception",
  "costing_close_blockers",
] as const;

const list = TABLES.map((t) => `'${t}'`).join(",");

d("close cockpit tables — grants and RLS", () => {
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

  it.each(RPC_ONLY)("%s is read-only for authenticated (lifecycle is RPC-only)", (t) => {
    expect(acl.get(t)!).toMatch(/authenticated=r\//);
  });

  it("lets users attach and detach evidence, but never rewrite a link", () => {
    const grants = acl.get("costing_checklist_evidence")!;
    expect(grants).toMatch(/authenticated=ar?d?/);
    expect(grants).not.toMatch(/authenticated=[a-v x-z]*w/);
  });
});

d("close cockpit tables — policy shape", () => {
  const policies = q(
    `select tablename, policyname, cmd, ${flat("qual")}, ${flat("with_check")}
       from pg_policies where schemaname='public' and tablename in (${list})`,
  ).map(([table, name, cmd, qual, check]) => ({ table, name, cmd, qual, check }));

  it.each(TABLES)("%s scopes every policy to the caller's company", (t) => {
    const rows = policies.filter((p) => p.table === t);
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      expect(`${p.qual} ${p.check}`, `${p.table}.${p.name}`).toMatch(/is_company_member\(/);
    }
  });

  it.each(TABLES)("%s exposes a SELECT policy", (t) => {
    expect(
      policies.filter((p) => p.table === t).some((p) => ["SELECT", "ALL"].includes(p.cmd)),
    ).toBe(true);
  });

  it("gives every UPDATE policy both a USING and a WITH CHECK clause", () => {
    const updates = policies.filter((p) => p.cmd === "UPDATE" || p.cmd === "ALL");
    for (const p of updates) {
      expect(p.qual.trim(), `${p.table}.${p.name} USING`).not.toBe("");
      expect(p.check.trim(), `${p.table}.${p.name} WITH CHECK`).not.toBe("");
    }
  });

  it("restricts template and evidence writes to admins", () => {
    const writes = policies.filter(
      (p) =>
        ["INSERT", "UPDATE", "DELETE", "ALL"].includes(p.cmd) &&
        p.table !== "costing_checklist_evidence",
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const p of writes) {
      expect(`${p.qual} ${p.check}`, `${p.table}.${p.name}`).toMatch(/has_company_role\(/);
    }
  });

  it("ties an evidence row to a checklist item in the SAME company", () => {
    const rows = policies.filter(
      (p) => p.table === "costing_checklist_evidence" && p.cmd === "INSERT",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      expect(`${p.qual} ${p.check}`).toMatch(/company_id = costing_checklist_evidence\.company_id/);
    }
  });
});

d("close cockpit — immutability triggers", () => {
  const triggers = q(
    `select c.relname, t.tgname, ${flat("pg_get_triggerdef(t.oid)")}
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace='public'::regnamespace and not t.tgisinternal
        and c.relname in (${list})`,
  ).map(([table, name, def]) => ({ table, name, def }));

  it("guards checklist items and exceptions against post-close edits", () => {
    for (const table of ["costing_checklist_items", "costing_exceptions"]) {
      const guard = triggers.find(
        (t) => t.table === table && /costing_close_artifact_guard\(\)/.test(t.def),
      );
      expect(guard, `${table} artifact guard`).toBeDefined();
      expect(guard!.def).toMatch(/BEFORE (INSERT OR )?DELETE OR UPDATE/);
    }
  });

  it("guards evidence links through their parent item", () => {
    const guard = triggers.find(
      (t) => t.table === "costing_checklist_evidence" && /costing_evidence_guard\(\)/.test(t.def),
    );
    expect(guard).toBeDefined();
    expect(guard!.def).toMatch(/BEFORE INSERT OR DELETE OR UPDATE/);
  });

  it("stamps updated_at on every mutable cockpit table", () => {
    for (const table of TABLES.filter((t) => t !== "costing_checklist_evidence")) {
      expect(
        triggers.some((t) => t.table === table && /update_updated_at_column\(\)/.test(t.def)),
        `${table} updated_at trigger`,
      ).toBe(true);
    }
  });
});

d("close cockpit — security definer routines", () => {
  const fns = q(
    `select p.proname, p.prosecdef::text, ${flat("array_to_string(p.proconfig,' ')")},
            ${flat("array_to_string(p.proacl,' ')")}
       from pg_proc p
      where p.pronamespace='public'::regnamespace
        and p.proname in (${RPCS.map((f) => `'${f}'`).join(",")}, 'transition_costing_period')`,
  ).map(([name, secdef, config, acl]) => ({ name, secdef, config, acl }));

  it.each([...RPCS, "transition_costing_period"])("%s is a pinned security definer", (name) => {
    const rows = fns.filter((f) => f.name === name);
    expect(rows.length, `${name} missing`).toBeGreaterThan(0);
    for (const f of rows) {
      expect(f.secdef, `${name} security definer`).toBe("true");
      expect(f.config, `${name} search_path`).toMatch(/search_path=public/);
    }
  });

  it.each([...RPCS, "transition_costing_period"])("%s revokes PUBLIC execute", (name) => {
    for (const f of fns.filter((x) => x.name === name)) {
      expect(f.acl, `${name} acl`).toMatch(/authenticated=X\//);
      expect(f.acl, `${name} public execute`).not.toMatch(/(^|\s)=X\//);
    }
  });

  it("evaluates blockers inside the hard-close transition", () => {
    const [[src]] = q(
      `select ${flat("pg_get_functiondef(p.oid)")} from pg_proc p
        where p.pronamespace='public'::regnamespace and p.proname='transition_costing_period'`,
    );
    expect(src).toMatch(/costing_close_blockers\(/);
    expect(src).toMatch(/ensure_costing_checklist\(/);
  });
});

d("close cockpit — query indexes", () => {
  const idx = q(
    `select ${flat("indexdef")} from pg_indexes where schemaname='public' and tablename in (${list})`,
  ).map(([s]) => s);
  const has = (re: RegExp) => idx.some((s) => re.test(s));

  it("indexes every period lookup the cockpit runs", () => {
    expect(has(/costing_checklist_runs_period_idx/)).toBe(true);
    expect(has(/costing_checklist_items_period_idx/)).toBe(true);
    expect(has(/costing_exceptions_period_idx/)).toBe(true);
    expect(has(/costing_checklist_evidence_item_idx/)).toBe(true);
  });

  it("indexes the open-work and ownership filters", () => {
    expect(has(/costing_checklist_items_open_idx/)).toBe(true);
    expect(has(/costing_checklist_items_assignee_idx/)).toBe(true);
    expect(has(/costing_exceptions_unresolved_idx/)).toBe(true);
    expect(has(/costing_exceptions_owner_idx/)).toBe(true);
  });

  it("keeps at most one active checklist template per company", () => {
    expect(has(/UNIQUE INDEX costing_checklist_templates_one_active/)).toBe(true);
  });

  it("deduplicates exceptions on their fingerprint", () => {
    expect(has(/UNIQUE INDEX .*costing_exceptions .*fingerprint/s)).toBe(true);
  });
});
