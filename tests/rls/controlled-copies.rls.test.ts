// P-266 — Controlled-copy discipline: live-schema behaviour probes.
//
// Exercised as the sandbox exec role against the real database: copy
// auto-numbering, recall-due flagging on supersede, and the typed 409 on
// issuing against a stale revision. Authorization is asserted from the
// routine sources + grants (auth.uid() is null in a raw psql session).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = `
set client_min_messages to notice;
do $$
declare
  v_company uuid;
  v_a uuid;
  v_b uuid;
  v_copy_1 uuid;
  v_copy_2 uuid;
  v_num integer;
  v_due timestamptz;
  v_err text;
begin
  select id into v_company from public.companies order by created_at limit 1;

  insert into public.document_register
    (company_id, doc_type, title, current_revision, status)
  values (v_company, 'p266_probe', 'P-266 probe', 'A', 'issued')
  returning id into v_a;

  -- two copies, sequential numbering per document
  insert into public.controlled_copies
    (company_id, document_id, copy_number, revision_pinned, holder_name, issue_date, status)
  values (v_company, v_a, coalesce((select max(copy_number) from public.controlled_copies where document_id = v_a), 0) + 1,
          'A', 'Site office', current_date, 'issued')
  returning id into v_copy_1;

  insert into public.controlled_copies
    (company_id, document_id, copy_number, revision_pinned, holder_name, issue_date, status)
  values (v_company, v_a, coalesce((select max(copy_number) from public.controlled_copies where document_id = v_a), 0) + 1,
          'A', 'QA lead', current_date, 'issued')
  returning id into v_copy_2;

  select copy_number into v_num from public.controlled_copies where id = v_copy_2;
  raise notice 'CHECK|copy_number_seq|%', v_num;

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

  -- issuing against the superseded revision raises the typed 409
  begin
    perform public.issue_controlled_copy(v_a, null, null, 'Late holder');
    v_err := 'accepted';
  exception when others then v_err := SQLERRM;
  end;
  raise notice 'CHECK|stale_issue|%', v_err;

  -- the current revision carries no recall-due copies yet
  raise notice 'CHECK|current_due|%',
    (select count(*) from public.controlled_copies
      where document_id = v_b and recall_due_at is not null);

  delete from public.controlled_copies where document_id in (v_a, v_b);
  delete from public.document_register where id = v_b;
  delete from public.document_register where id = v_a;
end $$;
`;

const checks: Record<string, string> = {};

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

  it("flags outstanding copies as recall-due when the document is superseded", () => {
    expect(checks.recall_due_set).toBe("true");
    expect(checks.recall_reason).toBe("document_superseded");
    expect(checks.due_count).toBe("2");
  });

  it("leaves the current revision's copies untouched", () => {
    expect(checks.current_due).toBe("0");
  });

  it("raises the typed doc_not_current 409 for a stale issue", () => {
    expect(checks.stale_issue).toMatch(/doc_not_current/);
  });

  it("keeps the copy routines definer-guarded and authenticated-only", () => {
    const out = execFileSync(
      "psql",
      [
        "-At",
        "-c",
        `select p.proname || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proacl, ','), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('issue_controlled_copy','recall_controlled_copy','controlled_copy_queue','controlled_copy_completeness')`,
      ],
      { encoding: "utf8" },
    ).trim();
    const lines = out.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toContain("|t|"); // security definer
      expect(line).toContain("authenticated=X");
      expect(line).not.toMatch(/(^|,)anon=X/);
    }
    const src = execFileSync(
      "psql",
      ["-At", "-c", "select prosrc from pg_proc where proname = 'issue_controlled_copy'"],
      { encoding: "utf8" },
    );
    expect(src).toContain("is_external_viewer");
    expect(src).toContain("doc_not_current");
  });
});
