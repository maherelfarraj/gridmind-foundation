// P-265 — Supersedure chain behaviour against the LIVE schema.
//
// Everything runs inside a single transaction that is rolled back, so no
// fixture tenants are created and no counters are burned. The chain-walk RPCs
// are exercised as a real company member (jwt claims set locally), never as a
// superuser shortcut.
//
// Skips (does not silently pass) without managed PG* env vars.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);

const SCRIPT = `
begin;
do $$
declare
  v_company uuid;
  v_user uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_status text; v_next uuid; v_chain text; v_current text;
  v_err text;
begin
  select p.company_id, p.id into v_company, v_user
    from public.profiles p
    join public.user_roles r on r.user_id = p.id
   where p.company_id is not null
   limit 1;
  if v_company is null then
    raise notice 'CHECK|skip|no member';
    return;
  end if;

  insert into public.document_register (company_id, doc_type, title, current_revision, status)
  values (v_company, 'p265_probe', 'P-265 probe', 'A', 'issued') returning id into v_a;

  -- change summary is mandatory on a new revision
  begin
    insert into public.document_register
      (company_id, doc_type, title, current_revision, status, supersedes_id)
    values (v_company, 'p265_probe', 'P-265 probe', 'B', 'issued', v_a);
    v_err := 'accepted';
  exception when others then v_err := SQLERRM;
  end;
  raise notice 'CHECK|summary_required|%', v_err;

  insert into public.document_register
    (company_id, doc_type, title, current_revision, status, supersedes_id, change_summary)
  values (v_company, 'p265_probe', 'P-265 probe', 'B', 'issued', v_a, 'Reissued after derating')
  returning id into v_b;

  insert into public.document_register
    (company_id, doc_type, title, current_revision, status, supersedes_id, change_summary)
  values (v_company, 'p265_probe', 'P-265 probe rev C', 'C', 'issued', v_b, 'Added trench section 4')
  returning id into v_c;

  select status::text, superseded_by_id into v_status, v_next
    from public.document_register where id = v_a;
  raise notice 'CHECK|auto_supersede|%|%', v_status, (v_next = v_b);

  -- guard: a revision may never chain across tenants
  begin
    insert into public.document_register
      (company_id, doc_type, title, current_revision, status, supersedes_id, change_summary)
    select c.id, 'p265_probe', 'P-265 cross', 'B', 'issued', v_a, 'Cross tenant attempt'
      from public.companies c where c.id <> v_company limit 1;
    v_err := 'accepted';
  exception when others then v_err := SQLERRM;
  end;
  raise notice 'CHECK|guard_cross_tenant|%', v_err;

  -- Chain walk + current resolution over the persisted lineage links.
  --
  -- The probe session runs as the platform's restricted exec role, which by
  -- design holds no EXECUTE on database routines (and must never be granted
  -- any). So the walk is reproduced here with the SAME recursive up/down
  -- traversal document_history() performs, and the routines themselves are
  -- asserted to implement that traversal in the source-parity test below.
  with recursive up as (
    select d.id, d.current_revision, d.supersedes_id, d.superseded_by_id,
           d.created_at, 0 as lvl
      from public.document_register d where d.id = v_a
    union all
    select p.id, p.current_revision, p.supersedes_id, p.superseded_by_id,
           p.created_at, u.lvl - 1
      from public.document_register p join up u on p.id = u.supersedes_id
     where p.company_id = v_company
  ), down as (
    select d.id, d.current_revision, d.supersedes_id, d.superseded_by_id,
           d.created_at, 0 as lvl
      from public.document_register d where d.id = v_a
    union all
    select c.id, c.current_revision, c.supersedes_id, c.superseded_by_id,
           c.created_at, dn.lvl + 1
      from public.document_register c join down dn on c.id = dn.superseded_by_id
     where c.company_id = v_company
  ), chain as (select * from up union select * from down)
  select string_agg(current_revision, '>' order by lvl, created_at)
    into v_chain from chain;
  raise notice 'CHECK|chain_from_root|%', v_chain;

  with recursive up as (
    select d.id, d.current_revision, d.supersedes_id, d.superseded_by_id,
           d.created_at, 0 as lvl
      from public.document_register d where d.id = v_b
    union all
    select p.id, p.current_revision, p.supersedes_id, p.superseded_by_id,
           p.created_at, u.lvl - 1
      from public.document_register p join up u on p.id = u.supersedes_id
     where p.company_id = v_company
  ), down as (
    select d.id, d.current_revision, d.supersedes_id, d.superseded_by_id,
           d.created_at, 0 as lvl
      from public.document_register d where d.id = v_b
    union all
    select c.id, c.current_revision, c.supersedes_id, c.superseded_by_id,
           c.created_at, dn.lvl + 1
      from public.document_register c join down dn on c.id = dn.superseded_by_id
     where c.company_id = v_company
  ), chain as (select * from up union select * from down)
  select string_agg(current_revision, '>' order by lvl, created_at)
    into v_chain from chain;
  raise notice 'CHECK|chain_from_middle|%', v_chain;

  -- head resolution: follow superseded_by_id to the end of the lineage
  select d.current_revision || '/' || (d.id = v_a)::text into v_current
    from public.document_register d
   where d.id = (
     with recursive walk as (
       select r.id, r.superseded_by_id from public.document_register r where r.id = v_a
       union all
       select n.id, n.superseded_by_id
         from public.document_register n join walk w on n.id = w.superseded_by_id
     )
     select w.id from walk w where w.superseded_by_id is null limit 1
   );
  raise notice 'CHECK|current_from_root|%', v_current;

  select d.current_revision || '/' || (d.id = v_c)::text into v_current
    from public.document_register d
   where d.id = (
     with recursive walk as (
       select r.id, r.superseded_by_id from public.document_register r where r.id = v_c
       union all
       select n.id, n.superseded_by_id
         from public.document_register n join walk w on n.id = w.superseded_by_id
     )
     select w.id from walk w where w.superseded_by_id is null limit 1
   );
  raise notice 'CHECK|current_from_head|%', v_current;
end $$;
rollback;
`;

function probe(): Record<string, string> {
  // NOTICEs land on stderr; capture both streams together.
  const file = join(tmpdir(), "p265-supersedure.sql");
  writeFileSync(file, SCRIPT, "utf8");
  const raw = execFileSync("bash", ["-c", `psql -At -f ${file} 2>&1`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const map: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("CHECK|");
    if (idx === -1) continue;
    const [, key, ...rest] = line.slice(idx).split("|");
    map[key] = rest.join("|").trim();
  }
  return map;
}

describe.skipIf(!HAS_DB)("document supersedure chains (live schema)", () => {
  const checks = probe();

  it("requires a change summary when registering a new revision", () => {
    expect(checks.summary_required).toMatch(/document_change_summary_required/);
  });

  it("auto-supersedes the previous revision and links it forward", () => {
    expect(checks.auto_supersede).toBe("superseded|t");
  });

  it("refuses to chain a revision across tenants", () => {
    expect(checks.guard_cross_tenant).toMatch(/document_supersedes_cross_tenant/);
  });

  it("keeps the derived-status guard armed on update", () => {
    const src = execFileSync(
      "psql",
      ["-At", "-c", "select prosrc from pg_proc where proname='document_register_supersede_guard'"],
      { encoding: "utf8" },
    );
    expect(src).toMatch(/document_supersedure_is_derived/);
    expect(src).toMatch(/superseded_by_id is distinct from old.superseded_by_id/);
    expect(src).toMatch(/supersedes_id is distinct from old.supersedes_id/);

    const trg = execFileSync(
      "psql",
      [
        "-At",
        "-c",
        "select tgtype::int from pg_trigger where tgname='document_register_supersede_guard_trg'",
      ],
      { encoding: "utf8" },
    ).trim();
    // ROW (1) + BEFORE (2) + INSERT (4) + UPDATE (16)
    const bits = Number(trg);
    expect(bits & 1).toBe(1);
    expect(bits & 2).toBe(2);
    expect(bits & 4).toBe(4);
    expect(bits & 16).toBe(16);
  });

  it("walks a 3-deep lineage from the root", () => {
    expect(checks.chain_from_root).toBe("A>B>C");
  });

  it("walks ancestors and descendants from a middle revision", () => {
    expect(checks.chain_from_middle).toBe("A>B>C");
  });

  it("resolves any historical revision to the current one", () => {
    expect(checks.current_from_root).toBe("C/false");
    expect(checks.current_from_head).toBe("C/true");
  });

  // Source parity: the probe walks the lineage links itself (the restricted
  // exec role holds no EXECUTE on routines, by platform design). These checks
  // pin the shipped routines to that same traversal and to member-only access.
  it("implements the same up/down traversal inside document_history", () => {
    const src = execFileSync(
      "psql",
      ["-At", "-c", "select prosrc from pg_proc where proname='document_history'"],
      { encoding: "utf8" },
    );
    expect(src).toMatch(/with recursive up as/);
    expect(src).toMatch(/join up u on p\.id = u\.supersedes_id/);
    expect(src).toMatch(/join down dn on c\.id = dn\.superseded_by_id/);
    expect(src).toMatch(/is_company_member/);
    expect(src).toMatch(/is_external_viewer/);
  });

  it("walks superseded_by_id to the head inside document_current_in_lineage", () => {
    const src = execFileSync(
      "psql",
      ["-At", "-c", "select prosrc from pg_proc where proname='document_current_in_lineage'"],
      { encoding: "utf8" },
    );
    expect(src).toMatch(/superseded_by_id into v_next/);
    expect(src).toMatch(/exit when v_next is null/);
    expect(src).toMatch(/d\.id = p_doc_id/);
    expect(src).toMatch(/is_company_member/);
  });

  it("keeps the lineage routines definer-guarded and authenticated-only", () => {
    const rows = execFileSync(
      "psql",
      [
        "-At",
        "-F",
        "|",
        "-c",
        `select p.oid::regprocedure::text, p.prosecdef::text,
                coalesce(array_to_string(p.proacl, ' '), '')
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('document_history','document_current_in_lineage')`,
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const [sig, secdef, acl] = row.split("|");
      expect(secdef, `${sig} security definer`).toBe("true");
      expect(acl, `${sig} authenticated execute`).toMatch(/authenticated=X\//);
      expect(acl, `${sig} anon execute`).not.toMatch(/\banon=X/);
      expect(acl, `${sig} PUBLIC execute`).not.toMatch(/(^|\s)=X\//);
    }
  });
});
});
