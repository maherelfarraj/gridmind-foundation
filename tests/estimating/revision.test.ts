// P-214 — Revision cloning: header + lines copied, source superseded.
import { describe, expect, it } from "vitest";

import { canCreateRevision } from "@/lib/estimating/revision-diff";
import { cloneEstimateAsRevision } from "@/lib/estimating.server";
import { COMPANY_A, makeEstimate, makeLine, makeWorld } from "./fixtures";

const LINES = [
  makeLine({ id: "l1", source_bom_line_id: "bom-1", sort_order: 0 }),
  makeLine({ id: "l2", line_type: "labor", amount: 5000, source_bom_line_id: null, sort_order: 1 }),
];

describe("createEstimateRevision", () => {
  it("copies the header with revision + 1 and clears workflow fields", async () => {
    const source = makeEstimate({
      status: "approved",
      revision: 2,
      approved_at: "2026-07-10T00:00:00.000Z",
      approved_by: "user-fin",
      approval_instance_id: "appr-1",
      priced_at: "2026-07-11T00:00:00.000Z",
      converted_proposal_id: "prop-1",
    });
    const w = makeWorld({ estimates: [source], estimate_lines: LINES });
    const created = await cloneEstimateAsRevision(w.ctx, { companyId: COMPANY_A, estimate: source });
    expect(created.revision).toBe(3);
    const clone = w.db.estimates.find((e) => e.id === created.id)!;
    expect(clone).toMatchObject({
      status: "draft",
      revision: 3,
      supersedes_id: "est-1",
      title: source.title,
      currency_code: "USD",
      escalation_pct: 2,
      profit_pct: 10,
      approval_instance_id: null,
      approved_at: null,
      approved_by: null,
      priced_at: null,
      converted_proposal_id: null,
      converted_at: null,
    });
  });

  it("copies every line with traceability ids preserved", async () => {
    const source = makeEstimate({ status: "priced" });
    const w = makeWorld({ estimates: [source], estimate_lines: LINES });
    const created = await cloneEstimateAsRevision(w.ctx, { companyId: COMPANY_A, estimate: source });
    expect(created.lines_copied).toBe(2);
    const copies = w.db.estimate_lines.filter((l) => l.estimate_id === created.id);
    expect(copies).toHaveLength(2);
    expect(copies.map((l) => l.source_bom_line_id)).toEqual(["bom-1", null]);
    expect(copies.map((l) => l.amount)).toEqual([12_000, 5000]);
  });

  it("supersedes the source estimate", async () => {
    const source = makeEstimate({ status: "approved" });
    const w = makeWorld({ estimates: [source], estimate_lines: LINES });
    await cloneEstimateAsRevision(w.ctx, { companyId: COMPANY_A, estimate: source });
    expect(w.db.estimates.find((e) => e.id === "est-1")!.status).toBe("superseded");
  });

  it("only allows revising approved or priced estimates", () => {
    expect(canCreateRevision("approved")).toBe(true);
    expect(canCreateRevision("priced")).toBe(true);
    for (const status of ["draft", "in_review", "superseded"]) {
      expect(canCreateRevision(status), status).toBe(false);
    }
  });
});
