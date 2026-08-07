// P-266 — Controlled-copy discipline: live-schema behaviour probes.
//
// The probe session runs as the platform's restricted exec role, which by
// design holds NO EXECUTE on database routines — and must never be granted
// any (grants to that role are reset by the platform, so a grant workaround is
// both non-persistent and wrong). Behaviour that lives in triggers is
// therefore exercised for real against the database; behaviour that lives
// inside issue_controlled_copy() is pinned by source + grant parity checks,
// and the numbering/authorization rules additionally by the constraints that
// back them.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = `
set client_min_messages to notice;
begin;
do $$
declare
  v_company uuid;
  v_a uuid;
  v_b uuid;
  v_copy_1 uuid;
  v_copy_2 uuid;
  v_num integer;
  v_due timestamptz;
  v_actor uuid;
  v_err text;
begin
  select ur.company_id, ur.user_id into v_company, v_actor
    from public.user_roles ur
   where ur.role = 'company_admin'::public.app_role
   order by ur.created_at
   limit 1;
  if v_company is null then
    raise notice 'CHECK|skip|no company_admin';
    return;
  end if;

  insert into public.document_register
    (company_id, doc_type, title, current_revision, status)
  values (v_company, 'p266_probe', 'P-266 probe', 'A', 'issued')
  returning id into v_a;

  -- two copies of the same document, numbered the way the issue routine
  -- numbers them: max(copy_number) + 1 scoped to the document.
  insert into public.controlled_copies
    (company_id, document_id, copy_number, revision_pinned, holder_name, location,
     issue_date, status, created_by)
  values (v_company, v_a,
          (select coalesce(max(copy_number), 0) + 1 from public.controlled_copies
            where document_id = v_a),
          'A', 'Site office', 'Site office', current_date,
          'issued'::public.controlled_copy_status, v_actor)
  returning id into v_copy_1;

  insert into public.controlled_copies
    (company_id, document_id, copy_number, revision_pinned, holder_name, location,
     issue_date, status, created_by)
  values (v_company, v_a,
          (select coalesce(max(copy_number), 0) + 1 from public.controlled_copies
            where document_id = v_a),
          'A', 'QA lead', 'QA office', current_date,
          'issued'::public.controlled_copy_status, v_actor)
  returning id into v_copy_2;

  select copy_number into v_num from public.controlled_copies where id = v_copy_2;
  raise notice 'CHECK|copy_number_seq|%', v_num;

  -- reusing a copy number on the same document must be rejected outright
  begin
    insert into public.controlled_copies
      (company_id, document_id, copy_number, revision_pinned, holder_name,
       issue_date, status, created_by)
    values (v_company, v_a, v_num, 'A', 'Duplicate holder', current_date,
            'issued'::public.controlled_copy_status, v_actor);
    v_err := 'accepted';
  exception when others then v_err := SQLSTATE;
  end;
  raise notice 'CHECK|copy_number_unique|%', v_err;

  -- register revision B: A flips to superseded, its outstanding copies become recall-due
  insert into public.document_register
    (company_id, doc_type, title, current_revision, status, supersedes_id, change_summary)
  values (v_company, 'p266_probe', 'P-266 probe', 'B', 'issued', v_a, 'Revision B for recall probe')
  returning id into v_b;

  select recall_due_at into v_due from public.controlled_copies where id = v_copy_1;
  raise notice 'CHECK|recall_due_set|%', (v_due is not null);
  raise notice 'CHECK|recall_reason|%',
    (select recall_reason from public.controlled_copies where id = v_copy_1);
  raise notice 'CHECK|due_count|%',
    (select count(*) from public.controlled_copies
      where document_id = v_a and status = 'issued' and recall_due_at is not null);

  -- the superseded revision is exactly what the issue routine refuses to serve
  raise notice 'CHECK|stale_status|%',
    (select status::text from public.document_register where id = v_a);

  -- the current revision carries no recall-due copies yet
  raise notice 'CHECK|current_due|%',
    (select count(*) from public.controlled_copies
      where document_id = v_b and recall_due_at is not null);
end $$;
rollback;
`;

const checks: Record<string, string> = {};

function psql(sql: string): string {
  return execFileSync("psql", ["-At", "-c", sql], { encoding: "utf8" });
}

beforeAll(() => {
  const file = join(tmpdir(), "p266-controlled-copies.sql");
  writeFileSync(file, SCRIPT, "utf8");
  const raw = execFileSync("bash", ["-c", `psql -At -f ${file} 2>&1`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  for (const line of raw.split("\n")) {
    const m = /CHECK\|([a-z_]+)\|(.*)$/.exec(line);
    if (m) checks[m[1]] = m[2].trim();
  }
  if (Object.keys(checks).length === 0) throw new Error(`probe produced no checks:\n${raw}`);
});

describe("controlled copy discipline (live schema)", () => {
  it("numbers copies sequentially per document", () => {
    expect(checks.copy_number_seq).toBe("2");
  });

  it("refuses a duplicate copy number on the same document", () => {
    // 23505 unique_violation — the constraint that makes max+1 numbering safe.
    expect(checks.copy_number_unique).toBe("23505");
  });

  it("flags outstanding copies as recall-due when the document is superseded", () => {
    expect(checks.recall_due_set).toBe("t");
    expect(checks.recall_reason).toBe("document_superseded");
    expect(checks.due_count).toBe("2");
  });

  it("leaves the current revision's copies untouched", () => {
    expect(checks.current_due).toBe("0");
  });

  it("marks the outdated revision superseded, which is what blocks a stale issue", () => {
    expect(checks.stale_status).toBe("superseded");
  });

  it("raises the typed doc_not_current 409 for a stale issue", () => {
    // Source parity: the routine cannot be invoked from the restricted probe
    // role, so the guard is pinned to its shipped implementation.
    const src = psql("select prosrc from pg_proc where proname = 'issue_controlled_copy'");
    expect(src).toMatch(/status in \('superseded'::public\.document_register_status/);
    expect(src).toMatch(/'obsolete'::public\.document_register_status\)/);
    expect(src).toMatch(/raise exception 'doc_not_current'/);
    expect(src).toMatch(/errcode = 'P0409'/);
  });

  it("numbers copies with max\\(copy_number\\)+1 scoped to the document", () => {
    const src = psql("select prosrc from pg_proc where proname = 'issue_controlled_copy'");
    expect(src).toMatch(/coalesce\(max\(copy_number\), 0\) \+ 1/);
    expect(src).toMatch(/where document_id = p_document_id/);
  });

  it("keeps the copy routines definer-guarded and authenticated-only", () => {
    const lines = psql(
      `select p.oid::regprocedure::text || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proacl, ','), '')
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('issue_controlled_copy','recall_controlled_copy','controlled_copy_queue','controlled_copy_completeness')`,
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toContain("|true|"); // security definer
      expect(line).toContain("authenticated=X");
      expect(line).not.toMatch(/(^|,)anon=X/);
      expect(line).not.toMatch(/(,|=)\s*=X\//); // no PUBLIC execute
    }
    const src = psql("select prosrc from pg_proc where proname = 'issue_controlled_copy'");
    expect(src).toContain("is_external_viewer");
    expect(src).toContain("doc_not_current");
  });
});
