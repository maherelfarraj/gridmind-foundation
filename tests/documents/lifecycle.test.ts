// P-268 — Batch 35 finale: the document-control lifecycle, end to end.
//
// One fixture tenant walks the whole doctrine in order:
//
//   register → revisions → 3-deep supersedure chain → transmittal with pinned
//   items → controlled copies → recall flow → retention classes → dossier
//   generation with a gap and without.
//
// Every expectation below is hand-computed (see EXPECTED in fixtures.ts):
// chain order A>B>C, copy numbers 1..3, recall counts after supersede, gap
// lists. The search sanity pass (P-264 RPC) runs against the SAME corpus —
// search_vector is a GENERATED column, so it regenerates deterministically
// from the rows this suite writes and cannot drift against the lifecycle.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  detectGaps,
  emptyChapters,
  gapCount,
  isComplete,
  GAP_REASON,
  type DossierChapter,
} from "@/lib/turnover-dossier.rules";

import { EXPECTED, insertOne, isSupabaseUp, rpc, setupDocumentFixture } from "./fixtures";

/** PostgREST returns a bare object for scalar-row RPCs and an array for TABLE ones. */
const firstRow = <T>(data: unknown): T => (Array.isArray(data) ? (data[0] as T) : (data as T));
import type { DocumentFixture, Svc } from "./fixtures";

const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

interface Registered {
  id: string;
  doc_number: string;
  revision: string;
}

d("P-268 · document control lifecycle", () => {
  let fx: DocumentFixture;
  let A: Svc;

  // Lifecycle artefacts, filled in beforeAll.
  const revs: Registered[] = [];
  let standalone: Registered;
  let transmittalId = "";
  let pinnedRevisionAfterSupersede = "";
  const frozenErrors: string[] = [];
  const copyNumbers: number[] = [];
  let completenessAfterReturn = { total: 0, outstanding: 0, closed: 0, recallDue: 0 };
  let recallDueAfterSupersede = 0;
  let staleIssueError = "";
  let doubleRecallError = "";
  let firstCopyOnCurrent = 0;
  let transientDays = 0;
  let permanentExpiry: string | null = "unset";
  let dossierWithGap: { doc_number: string; gap_count: number; complete: boolean } | null = null;
  let dossierClean: { doc_number: string; gap_count: number; complete: boolean } | null = null;
  let dossierRetentionClass = "";

  const register = async (payload: Record<string, unknown>): Promise<Registered> => {
    const { data, error } = await A.from("document_register")
      .insert(payload as never)
      .select("id, doc_number, current_revision")
      .single();
    if (error || !data) throw new Error(`register: ${error?.message}`);
    const row = data as { id: string; doc_number: string; current_revision: string };
    return { id: row.id, doc_number: row.doc_number, revision: row.current_revision };
  };

  beforeAll(async () => {
    fx = await setupDocumentFixture();
    A = fx.admin.client;
    const base = {
      company_id: fx.companyId,
      project_id: fx.projectId,
      doc_type: "p268_drawing",
      discipline: "electrical",
      title: `Trench layout ${fx.token}`,
      retention_class: "transient" as const,
      content_text: `Cable trench schedule ${fx.token} for the east feeder run.`,
    };

    // 1 — register + revisions + 3-deep supersedure chain
    revs.push(await register({ ...base, current_revision: "A", status: "issued" }));
    revs.push(
      await register({
        ...base,
        current_revision: "B",
        status: "issued",
        supersedes_id: revs[0].id,
        change_summary: "Rerouted around the substation apron",
      }),
    );
    revs.push(
      await register({
        ...base,
        current_revision: "C",
        status: "issued",
        supersedes_id: revs[1].id,
        change_summary: "Added trench section 4",
      }),
    );

    standalone = await register({
      company_id: fx.companyId,
      project_id: fx.projectId,
      doc_type: "p268_certificate",
      discipline: "quality",
      title: `Megger certificate ${fx.token}`,
      current_revision: "A",
      status: "issued",
      retention_class: "permanent",
    });

    // 2 — transmittal with pinned items, then issued (freeze)
    const transmittal = await insertOne<{ id: string }>(A, "transmittals", {
      company_id: fx.companyId,
      project_id: fx.projectId,
      subject: `Issue for approval ${fx.token}`,
      purpose: "for_approval",
      status: "draft",
      direction: "outgoing",
      recipient_name: "Owner's engineer",
      created_by: fx.admin.userId,
    });
    transmittalId = transmittal.id;

    const items = [
      { document_id: revs[2].id, line_no: 1, revision_pinned: "C" },
      { document_id: standalone.id, line_no: 2, revision_pinned: "A" },
    ].map((i) => ({ ...i, company_id: fx.companyId, transmittal_id: transmittalId }));
    const { error: itemErr } = await A.from("transmittal_items").insert(items as never);
    if (itemErr) throw new Error(`items: ${itemErr.message}`);

    const { error: issueErr } = await A.from("transmittals")
      .update({ status: "issued", sent_at: new Date().toISOString() } as never)
      .eq("id", transmittalId);
    if (issueErr) throw new Error(`issue: ${issueErr.message}`);

    const push = (msg?: string) => frozenErrors.push(msg ?? "accepted");
    push(
      (
        await A.from("transmittal_items").insert({
          company_id: fx.companyId,
          transmittal_id: transmittalId,
          document_id: standalone.id,
          line_no: 3,
          revision_pinned: "A",
        } as never)
      ).error?.message,
    );
    push(
      (
        await A.from("transmittal_items")
          .update({ revision_pinned: "Z" } as never)
          .eq("transmittal_id", transmittalId)
          .eq("line_no", 1)
      ).error?.message,
    );
    push(
      (
        await A.from("transmittal_items")
          .delete()
          .eq("transmittal_id", transmittalId)
          .eq("line_no", 2)
      ).error?.message,
    );

    // 3 — controlled copies against revision C
    for (const holder of ["Site office", "QA lead", "Owner's engineer"]) {
      const { data, error } = await rpc(A)("issue_controlled_copy", {
        p_document_id: revs[2].id,
        p_holder_name: holder,
        p_location: holder,
      });
      if (error) throw new Error(`issue_controlled_copy: ${error.message}`);
      copyNumbers.push(firstRow<{ copy_number: number }>(data).copy_number);
    }

    // 4 — recall flow: return copy #2, then supersede C with D
    const { data: copyRows } = await A.from("controlled_copies")
      .select("id, copy_number")
      .eq("document_id", revs[2].id)
      .order("copy_number");
    const copies = (copyRows ?? []) as Array<{ id: string; copy_number: number }>;
    const second = copies.find((c) => c.copy_number === 2)!;
    const { error: recallErr } = await rpc(A)("recall_controlled_copy", {
      p_copy_id: second.id,
      p_disposition: "returned",
      p_notes: "Handed back at the gate",
    });
    if (recallErr) throw new Error(`recall: ${recallErr.message}`);
    doubleRecallError =
      (
        await rpc(A)("recall_controlled_copy", {
          p_copy_id: second.id,
          p_disposition: "recalled",
        })
      ).error?.message ?? "accepted";

    const { data: comp } = await rpc(A)("controlled_copy_completeness", {
      p_document_id: revs[2].id,
    });
    const c0 = firstRow<Record<string, number>>(comp);
    completenessAfterReturn = {
      total: c0.total,
      outstanding: c0.outstanding,
      closed: c0.closed,
      recallDue: c0.recall_due,
    };

    revs.push(
      await register({
        ...base,
        current_revision: "D",
        status: "issued",
        supersedes_id: revs[2].id,
        change_summary: "As-built markup incorporated",
      }),
    );

    const { data: due } = await A.from("controlled_copies")
      .select("id")
      .eq("document_id", revs[2].id)
      .eq("status", "issued")
      .not("recall_due_at", "is", null);
    recallDueAfterSupersede = ((due ?? []) as unknown[]).length;

    const { data: pinned } = await A.from("transmittal_items")
      .select("revision_pinned")
      .eq("transmittal_id", transmittalId)
      .eq("line_no", 1)
      .single();
    pinnedRevisionAfterSupersede = (pinned as { revision_pinned: string }).revision_pinned;

    staleIssueError =
      (
        await rpc(A)("issue_controlled_copy", {
          p_document_id: revs[2].id,
          p_holder_name: "Late holder",
        })
      ).error?.message ?? "accepted";

    const { data: fresh, error: freshErr } = await rpc(A)("issue_controlled_copy", {
      p_document_id: revs[3].id,
      p_holder_name: "Site office",
    });
    if (freshErr) throw new Error(`issue on current: ${freshErr.message}`);
    firstCopyOnCurrent = firstRow<{ copy_number: number }>(fresh).copy_number;

    // 5 — retention classes
    const { data: retention } = await A.from("document_register")
      .select("retention_class, retention_starts_at, retention_expires_at")
      .in("id", [revs[0].id, standalone.id]);
    for (const row of (retention ?? []) as Array<{
      retention_class: string;
      retention_starts_at: string;
      retention_expires_at: string | null;
    }>) {
      if (row.retention_class === "transient") {
        transientDays = Math.round(
          (Date.parse(row.retention_expires_at!) - Date.parse(row.retention_starts_at)) /
            86_400_000,
        );
      } else {
        permanentExpiry = row.retention_expires_at;
      }
    }

    // 6 — dossier generation, with a gap and without
    const gapped = await rpc(A)("register_turnover_dossier", {
      p_project_id: fx.projectId,
      p_complete: false,
      p_gaps: [
        { chapter: "warranties", count: 1, detail: "Warranties: no records in the package" },
        { chapter: "as_builts", count: 2, detail: `2 ${GAP_REASON.drawingNotIfc}` },
      ],
      p_chapters: [],
      p_storage_path: null,
    });
    if (gapped.error) throw new Error(`dossier(gap): ${gapped.error.message}`);
    const gappedRow = firstRow<{ document_id: string; doc_number: string }>(gapped.data);

    const clean = await rpc(A)("register_turnover_dossier", {
      p_project_id: fx.projectId,
      p_complete: true,
      p_gaps: [],
      p_chapters: [],
      p_storage_path: null,
    });
    if (clean.error) throw new Error(`dossier(clean): ${clean.error.message}`);
    const cleanRow = firstRow<{ document_id: string; doc_number: string }>(clean.data);

    const { data: dossierDocs } = await A.from("document_register")
      .select("id, doc_number, retention_class, status, metadata")
      .in("id", [gappedRow.document_id, cleanRow.document_id]);
    for (const row of (dossierDocs ?? []) as Array<{
      id: string;
      doc_number: string;
      retention_class: string;
      status: string;
      metadata: { complete?: boolean; gap_count?: number };
    }>) {
      dossierRetentionClass = row.retention_class;
      const shape = {
        doc_number: row.doc_number,
        gap_count: row.metadata.gap_count ?? -1,
        complete: Boolean(row.metadata.complete),
      };
      if (row.id === gappedRow.document_id) dossierWithGap = shape;
      else dossierClean = shape;
    }
  }, 300_000);

  afterAll(async () => {
    await fx?.cleanup();
  }, 180_000);

  // -- register + chain ------------------------------------------------------
  it("stamps every registered document with a DOC-#### number", () => {
    for (const rev of [...revs, standalone]) {
      expect(rev.doc_number, `bad number ${rev.doc_number}`).toMatch(/^DOC-\d{4,}$/);
    }
    const numbers = revs.map((r) => r.doc_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("walks the 3-deep supersedure chain in order and resolves the current head", async () => {
    const { data, error } = await rpc(A)("document_history", { p_doc_id: revs[0].id });
    expect(error).toBeNull();
    const chain = (data as Array<{ current_revision: string; depth: number }>)
      .slice()
      .sort((a, b) => a.depth - b.depth)
      .map((r) => r.current_revision);
    // A>B>C at the time of registration; D was added later in the same lineage.
    expect(chain.slice(0, EXPECTED.chain.length)).toEqual([...EXPECTED.chain]);
    expect(chain).toEqual([...EXPECTED.chain, "D"]);

    const { data: current } = await rpc(A)("document_current_in_lineage", { p_doc_id: revs[0].id });
    const head = firstRow<{ current_revision: string; is_self: boolean }>(current);
    expect(head.current_revision).toBe("D");
    expect(head.is_self).toBe(false);
  });

  it("marks every superseded revision and links it forward", async () => {
    const { data } = await A.from("document_register")
      .select("id, status, superseded_by_id")
      .in(
        "id",
        revs.map((r) => r.id),
      );
    const byId = new Map(
      ((data ?? []) as Array<{ id: string; status: string; superseded_by_id: string | null }>).map(
        (r) => [r.id, r],
      ),
    );
    expect(byId.get(revs[0].id)!.status).toBe("superseded");
    expect(byId.get(revs[0].id)!.superseded_by_id).toBe(revs[1].id);
    expect(byId.get(revs[1].id)!.superseded_by_id).toBe(revs[2].id);
    expect(byId.get(revs[2].id)!.superseded_by_id).toBe(revs[3].id);
    expect(byId.get(revs[3].id)!.status).toBe("issued");
  });

  // -- transmittals ----------------------------------------------------------
  it("freezes transmittal items on insert, update and delete once issued", () => {
    expect(frozenErrors).toHaveLength(3);
    for (const msg of frozenErrors) expect(msg).toMatch(/transmittal_items_frozen/);
  });

  it("keeps the pinned revision after the document is superseded", () => {
    expect(pinnedRevisionAfterSupersede).toBe("C");
  });

  // -- controlled copies + recall -------------------------------------------
  it("numbers controlled copies sequentially per document", () => {
    expect(copyNumbers).toEqual([...EXPECTED.copyNumbers]);
    expect(firstCopyOnCurrent).toBe(1);
  });

  it("computes recall completeness after a returned copy", () => {
    expect(completenessAfterReturn).toEqual(EXPECTED.completenessAfterReturn);
  });

  it("flags the outstanding copies as recall-due when the revision is superseded", () => {
    expect(recallDueAfterSupersede).toBe(EXPECTED.recallDueAfterSupersede);
  });

  it("rejects a second recall of a closed copy", () => {
    expect(doubleRecallError).toMatch(/copy_not_outstanding/);
  });

  it("raises the typed doc_not_current 409 on a stale issue", () => {
    expect(staleIssueError).toMatch(/doc_not_current/);
  });

  // -- retention -------------------------------------------------------------
  it("derives the retention window from the class", () => {
    expect(transientDays).toBe(EXPECTED.transientDays);
    expect(permanentExpiry).toBeNull();
  });

  it("reports the class distribution for the project", async () => {
    const { data, error } = await rpc(A)("document_retention_summary", {
      p_project_id: fx.projectId,
    });
    expect(error).toBeNull();
    const rows = (data as Array<{ retention_class: string; total: number | string }>).map((r) => ({
      cls: r.retention_class,
      total: Number(r.total),
    }));
    const transient = rows.find((r) => r.cls === "transient");
    const permanent = rows.find((r) => r.cls === "permanent");
    // 4 revisions transient; 1 certificate + 2 dossiers permanent.
    expect(transient?.total).toBe(4);
    expect(permanent?.total).toBe(3);
  });

  // -- dossier ---------------------------------------------------------------
  it("registers a gapped dossier as an incomplete permanent document", () => {
    expect(dossierWithGap).not.toBeNull();
    expect(dossierWithGap!.complete).toBe(false);
    expect(dossierWithGap!.gap_count).toBe(2);
    expect(dossierWithGap!.doc_number).toMatch(/^DOC-\d{4,}$/);
    expect(dossierRetentionClass).toBe("permanent");
  });

  it("registers a clean dossier as complete with zero gaps", () => {
    expect(dossierClean).not.toBeNull();
    expect(dossierClean!.complete).toBe(true);
    expect(dossierClean!.gap_count).toBe(0);
    expect(dossierClean!.doc_number).not.toBe(dossierWithGap!.doc_number);
  });

  it("detects the same gap list the dossier was registered with (hand-computed)", () => {
    const chapters: DossierChapter[] = emptyChapters().map((c) => {
      if (c.key === "warranties") return c; // required, empty → 1 gap
      if (c.key === "as_builts") {
        return {
          ...c,
          items: [
            {
              reference: "D-01",
              title: "Trench",
              revision: "D",
              status: "issued",
              documentDate: null,
              gapReason: GAP_REASON.drawingNotIfc,
            },
            {
              reference: "D-02",
              title: "Earthing",
              revision: "B",
              status: "issued",
              documentDate: null,
              gapReason: GAP_REASON.drawingNotIfc,
            },
            {
              reference: "D-03",
              title: "Layout",
              revision: "C",
              status: "issued",
              documentDate: null,
            },
          ],
        };
      }
      return {
        ...c,
        items: [
          {
            reference: `${c.key}-1`,
            title: c.title,
            revision: "A",
            status: "issued",
            documentDate: null,
          },
        ],
      };
    });

    const gaps = detectGaps(chapters);
    expect(gaps.map((g) => g.chapter).sort()).toEqual(["as_builts", "warranties"]);
    expect(gapCount(gaps)).toBe(3); // 2 non-IFC drawings + 1 empty required chapter
    expect(gaps.find((g) => g.chapter === "as_builts")!.detail).toBe(
      `2 ${GAP_REASON.drawingNotIfc}`,
    );
    expect(isComplete(chapters)).toBe(false);

    const filled = chapters.map((c) =>
      c.key === "warranties"
        ? {
            ...c,
            items: [
              {
                reference: "W-1",
                title: "Inverter warranty",
                revision: "A",
                status: "issued",
                documentDate: null,
              },
            ],
          }
        : { ...c, items: (c.items ?? []).map(({ ...i }) => ({ ...i, gapReason: null })) },
    );
    expect(detectGaps(filled)).toEqual([]);
    expect(isComplete(filled)).toBe(true);
  });

  // -- P-264 search sanity, same corpus -------------------------------------
  it("ranks, filters and snippets the fixture corpus (P-264 RPC)", async () => {
    const { data, error } = await rpc(A)("search_documents", { p_query: fx.token, p_limit: 50 });
    expect(error).toBeNull();
    const rows = data as Array<{
      id: string;
      doc_type: string;
      rank: number;
      snippet: string;
      status: string;
    }>;
    // The 4 revisions + the certificate carry the token in their titles.
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.map((r) => r.rank)).toEqual([...rows.map((r) => r.rank)].sort((a, b) => b - a));
    expect(rows.every((r) => r.rank > 0)).toBe(true);
    expect(rows.some((r) => r.snippet.includes("<mark>"))).toBe(true);

    const typed = await rpc(A)("search_documents", {
      p_query: fx.token,
      p_doc_type: "p268_certificate",
    });
    const typedRows = typed.data as Array<{ id: string }>;
    expect(typedRows.map((r) => r.id)).toEqual([standalone.id]);

    const superseded = await rpc(A)("search_documents", {
      p_query: fx.token,
      p_status: "superseded",
    });
    expect((superseded.data as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(
      revs
        .slice(0, 3)
        .map((r) => r.id)
        .sort(),
    );

    const scoped = await rpc(A)("search_documents", {
      p_query: fx.token,
      p_retention_class: "permanent",
    });
    expect((scoped.data as Array<{ id: string }>).map((r) => r.id)).toContain(standalone.id);

    const miss = await rpc(A)("search_documents", { p_query: "kryptonite-not-in-corpus" });
    expect((miss.data as unknown[]) ?? []).toHaveLength(0);
  });
});
