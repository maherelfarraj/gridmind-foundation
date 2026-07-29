// P-268 — Document control RLS: static policy shape (live schema, via psql)
// plus live probes against a throw-away two-tenant fixture.
//
// Tables of the module:
//   document_register · transmittals · transmittal_items · controlled_copies
//
// Doctrine proved here (Batch 35 reference):
//   1. every client-facing policy is company-scoped   → cross-tenant isolation
//   2. external viewers are excluded everywhere       → NOT is_external_viewer()
//   3. writes are role-gated, never merely membership
//   4. controlled copies are narrower than the register (no procurement/legal)
//   5. deletes are company_admin-only on register + copies
//   6. an issued transmittal's items are frozen        → draft-only edits/deletes
//   7. anon holds no privileges

import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anonClient,
  insertOne,
  isSupabaseUp,
  rpc,
  setupDocumentFixture,
  type DocumentFixture,
} from "../documents/fixtures";

const HAS_DB = Boolean(process.env.PGHOST);

function q(sql: string): string[][] {
  const out = execFileSync("psql", ["-At", "-F", "\u0001", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\u0001"));
}

const TABLES = [
  "document_register",
  "transmittals",
  "transmittal_items",
  "controlled_copies",
] as const;
const TABLE_LIST = TABLES.map((t) => `'${t}'`).join(",");

const COMPANY_SCOPE = /is_company_member\(|is_company_admin\(|has_company_role\(|company_id\s*=/;

describe.skipIf(!HAS_DB)("P-268 · document tables — policy shape (live schema)", () => {
  const policies = q(
    `select tablename, policyname, cmd,
            replace(coalesce(qual,'')||' '||coalesce(with_check,''), chr(10), ' '), roles::text
       from pg_policies
      where schemaname='public' and tablename in (${TABLE_LIST})
      order by 1,2`,
  ).map(([table, name, cmd, expr, roles]) => ({ table, name, cmd, expr, roles }));

  it("all four tables exist with RLS enabled and at least one policy each", () => {
    const rows = q(
      `select cl.relname, cl.relrowsecurity::text
         from pg_class cl join pg_namespace n on n.oid=cl.relnamespace and n.nspname='public'
        where cl.relkind='r' and cl.relname in (${TABLE_LIST})`,
    );
    expect(rows.map(([name]) => name).sort()).toEqual([...TABLES].sort());
    expect(rows.filter(([, rls]) => !/^t/.test(rls))).toEqual([]);
    for (const t of TABLES) {
      expect(policies.filter((p) => p.table === t).length, `${t} has no policies`).toBeGreaterThan(
        0,
      );
    }
  });

  it("every client-facing policy is company-scoped", () => {
    const offenders = policies
      .filter((p) => /anon|authenticated|public/.test(p.roles) && !COMPANY_SCOPE.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `unscoped policy:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every policy excludes external portal viewers", () => {
    const offenders = policies
      .filter((p) => !/NOT is_external_viewer\(\)/.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `external viewer reachable:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every write policy is role-gated, not merely membership-gated", () => {
    const offenders = policies
      .filter((p) => /INSERT|UPDATE|DELETE|ALL/i.test(p.cmd))
      .filter((p) => !/has_company_role\(|is_company_admin\(/.test(p.expr))
      .map((p) => `${p.table}.${p.name} [${p.cmd}]`);
    expect(offenders, `write policy without a role gate:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("controlled-copy writes exclude procurement and legal", () => {
    const writes = policies.filter(
      (p) => p.table === "controlled_copies" && /INSERT|UPDATE|ALL/i.test(p.cmd),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const p of writes) {
      expect(p.expr, `${p.name} admits procurement`).not.toMatch(/procurement_admin/);
      expect(p.expr, `${p.name} admits legal`).not.toMatch(/legal_admin/);
    }
  });

  it("deletes on the register and on controlled copies are company_admin-only", () => {
    for (const table of ["document_register", "controlled_copies"] as const) {
      const del = policies.filter((p) => p.table === table && /DELETE|ALL/i.test(p.cmd));
      expect(del.length, `${table} has no delete policy`).toBeGreaterThan(0);
      for (const p of del) {
        expect(p.expr, `${table}.${p.name} is not admin-only`).toMatch(
          /has_company_role\('company_admin'/,
        );
        expect(p.expr).not.toMatch(/engineering_admin|project_admin|procurement_admin/);
      }
    }
  });

  it("anon holds no privileges on any of the four tables", () => {
    const grants = q(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema='public' and grantee='anon' and table_name in (${TABLE_LIST})`,
    ).map((r) => r.join("."));
    expect(grants, `anon grants:\n${grants.join("\n")}`).toEqual([]);
  });

  it("the document routines are SECURITY DEFINER with a pinned search_path", () => {
    const rows = q(
      `select p.proname, p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),'')
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
        where p.proname in ('issue_controlled_copy','recall_controlled_copy',
                            'controlled_copy_completeness','search_documents',
                            'document_history','document_current_in_lineage',
                            'register_turnover_dossier')`,
    );
    expect(rows).toHaveLength(7);
    for (const [name, secdef, cfg] of rows) {
      expect(secdef, `${name} is not SECURITY DEFINER`).toMatch(/^t/);
      expect(cfg, `${name} has a mutable search_path`).toMatch(/search_path/);
    }
  });
});

// ---------------------------------------------------------------------------
// Live probes
// ---------------------------------------------------------------------------
const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

d("P-268 · document tables — live isolation probes", () => {
  let fx: DocumentFixture;
  let docId = "";
  let transmittalId = "";
  let copyId = "";

  beforeAll(async () => {
    fx = await setupDocumentFixture();
    const A = fx.admin.client;

    const { data, error } = await A.from("document_register")
      .insert({
        company_id: fx.companyId,
        project_id: fx.projectId,
        doc_type: "p268_rls",
        title: `RLS probe ${fx.token}`,
        current_revision: "A",
        status: "issued",
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`probe doc: ${error?.message}`);
    docId = (data as { id: string }).id;

    const tr = await insertOne<{ id: string }>(A, "transmittals", {
      company_id: fx.companyId,
      project_id: fx.projectId,
      subject: `RLS transmittal ${fx.token}`,
      purpose: "for_information",
      status: "draft",
      created_by: fx.admin.userId,
    });
    transmittalId = tr.id;
    const { error: itemErr } = await A.from("transmittal_items").insert({
      company_id: fx.companyId,
      transmittal_id: transmittalId,
      document_id: docId,
      line_no: 1,
      revision_pinned: "A",
    } as never);
    if (itemErr) throw new Error(`probe item: ${itemErr.message}`);

    const copy = await rpc(A)("issue_controlled_copy", {
      p_document_id: docId,
      p_holder_name: "RLS holder",
    });
    if (copy.error) throw new Error(`probe copy: ${copy.error.message}`);
    copyId = (Array.isArray(copy.data) ? copy.data[0] : (copy.data as { id: string })).id;
  }, 300_000);

  afterAll(async () => {
    await fx?.cleanup();
  }, 180_000);

  it("a foreign tenant's admin reads nothing from any of the four tables", async () => {
    for (const table of TABLES) {
      const { data, error } = await fx.other.client.from(table as never).select("id");
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect((data ?? []).length, `${table} leaked rows cross-tenant`).toBe(0);
    }
  });

  it("a foreign tenant's admin cannot write into the fixture tenant", async () => {
    const { error } = await fx.other.client.from("document_register").insert({
      company_id: fx.companyId,
      doc_type: "p268_rls",
      title: "cross-tenant insert",
    } as never);
    expect(error).not.toBeNull();
  });

  it("an external viewer reads nothing and is refused by the definers", async () => {
    for (const table of TABLES) {
      const { data } = await fx.viewer.client.from(table as never).select("id");
      expect((data ?? []).length, `${table} exposed to an external viewer`).toBe(0);
    }
    const search = await rpc(fx.viewer.client)("search_documents", { p_query: fx.token });
    expect(search.error?.message ?? "").toMatch(/forbidden/);
    const issue = await rpc(fx.viewer.client)("issue_controlled_copy", {
      p_document_id: docId,
      p_holder_name: "viewer",
    });
    expect(issue.error?.message ?? "").toMatch(/not_authorized/);
  });

  it("anon reads nothing and writes nothing", async () => {
    const anon = anonClient();
    for (const table of TABLES) {
      const { data } = await anon.from(table as never).select("id");
      expect((data ?? []).length, `${table} readable by anon`).toBe(0);
    }
    const { error } = await anon.from("document_register").insert({
      company_id: fx.companyId,
      doc_type: "p268_rls",
      title: "anon",
    } as never);
    expect(error).not.toBeNull();
  });

  it("procurement may register documents but not issue controlled copies", async () => {
    const P = fx.procurement.client;
    const { data: reads } = await P.from("document_register").select("id").eq("id", docId);
    expect(((reads ?? []) as unknown[]).length).toBe(1);

    const { data: created, error: createErr } = await P.from("document_register")
      .insert({
        company_id: fx.companyId,
        doc_type: "p268_contract",
        title: `Procurement doc ${fx.token}`,
      } as never)
      .select("id")
      .single();
    expect(createErr).toBeNull();

    const { error: copyErr } = await P.from("controlled_copies").insert({
      company_id: fx.companyId,
      document_id: docId,
      copy_number: 99,
      revision_pinned: "A",
      holder_name: "procurement",
    } as never);
    expect(copyErr, "procurement wrote a controlled copy").not.toBeNull();

    const viaRpc = await rpc(P)("issue_controlled_copy", {
      p_document_id: docId,
      p_holder_name: "procurement",
    });
    expect(viaRpc.error?.message ?? "").toMatch(/not_authorized/);

    // ...and may not delete, even the row it created.
    const { error: delErr } = await P.from("document_register")
      .delete()
      .eq("id", (created as { id: string }).id);
    const { data: still } = await fx.admin.client
      .from("document_register")
      .select("id")
      .eq("id", (created as { id: string }).id);
    expect(delErr !== null || ((still ?? []) as unknown[]).length === 1).toBe(true);
  });

  it("engineering may issue and recall controlled copies", async () => {
    const E = fx.engineer.client;
    const issued = await rpc(E)("issue_controlled_copy", {
      p_document_id: docId,
      p_holder_name: "Engineering",
    });
    expect(issued.error).toBeNull();
    const id = (Array.isArray(issued.data) ? issued.data[0] : (issued.data as { id: string })).id;
    const recalled = await rpc(E)("recall_controlled_copy", {
      p_copy_id: id,
      p_disposition: "recalled",
    });
    expect(recalled.error).toBeNull();
  });

  it("only company_admin deletes a controlled copy", async () => {
    const { error } = await fx.engineer.client.from("controlled_copies").delete().eq("id", copyId);
    const { data: survived } = await fx.admin.client
      .from("controlled_copies")
      .select("id")
      .eq("id", copyId);
    expect(error !== null || ((survived ?? []) as unknown[]).length === 1).toBe(true);

    const { error: adminErr } = await fx.admin.client
      .from("controlled_copies")
      .delete()
      .eq("id", copyId);
    expect(adminErr).toBeNull();
    const { data: gone } = await fx.admin.client
      .from("controlled_copies")
      .select("id")
      .eq("id", copyId);
    expect(((gone ?? []) as unknown[]).length).toBe(0);
  });

  it("transmittal items are editable while draft and frozen once issued", async () => {
    const A = fx.admin.client;
    const { error: draftEdit } = await A.from("transmittal_items")
      .update({ note: "draft edit" } as never)
      .eq("transmittal_id", transmittalId);
    expect(draftEdit).toBeNull();

    const { error: issueErr } = await A.from("transmittals")
      .update({ status: "issued" } as never)
      .eq("id", transmittalId);
    expect(issueErr).toBeNull();

    const { error: frozenEdit } = await A.from("transmittal_items")
      .update({ note: "late edit" } as never)
      .eq("transmittal_id", transmittalId);
    expect(frozenEdit?.message ?? "").toMatch(/transmittal_items_frozen/);

    // Deleting an issued transmittal cascades into its frozen items → refused.
    const { error: delIssued } = await A.from("transmittals").delete().eq("id", transmittalId);
    expect(delIssued?.message ?? "").toMatch(/transmittal_items_frozen/);

    // A draft transmittal deletes cleanly — draft-only deletion.
    const draft = await insertOne<{ id: string }>(A, "transmittals", {
      company_id: fx.companyId,
      project_id: fx.projectId,
      subject: `Draft transmittal ${fx.token}`,
      purpose: "for_information",
      status: "draft",
      created_by: fx.admin.userId,
    });
    const { error: itemErr } = await A.from("transmittal_items").insert({
      company_id: fx.companyId,
      transmittal_id: draft.id,
      document_id: docId,
      line_no: 1,
      revision_pinned: "A",
    } as never);
    expect(itemErr).toBeNull();
    const { error: delDraft } = await A.from("transmittals").delete().eq("id", draft.id);
    expect(delDraft).toBeNull();
  });
});
