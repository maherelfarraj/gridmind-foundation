// P-214 — Estimate → proposal conversion mapping and reconciliation.
import { describe, expect, it } from "vitest";

import { computeEstimate } from "@/lib/estimating/buildup";
import {
  LINE_TYPE_CATEGORY,
  proposalLinesFromEstimate,
  sumLineTotals,
} from "@/lib/estimating/convert";
import { createProposalFromEstimate, linkEstimateToProposal } from "@/lib/estimating.server";
import type { EstimateLineRow } from "@/lib/estimating.server";
import { COMPANY_A, makeEstimate, makeLine, makeWorld } from "./fixtures";

const LINES = [
  makeLine({ id: "l1", line_type: "material", qty: 1, unit_rate: 60_000, amount: 60_000 }),
  makeLine({ id: "l2", line_type: "labor", qty: 1, unit_rate: 20_000, amount: 20_000 }),
  makeLine({ id: "l3", line_type: "plant", qty: 1, unit_rate: 10_000, amount: 10_000 }),
  makeLine({ id: "l4", line_type: "subcontract", qty: 1, unit_rate: 7_000, amount: 7_000 }),
  makeLine({ id: "l5", line_type: "other", qty: 1, unit_rate: 3_000, amount: 3_000 }),
] as unknown as EstimateLineRow[];

const MARGINS = { escalation_pct: 2, contingency_pct: 5, overhead_pct: 8, profit_pct: 10 };
const ESTIMATE = makeEstimate({ status: "approved" });

describe("category mapping", () => {
  it("maps every estimate line type to the proposal category", () => {
    expect(LINE_TYPE_CATEGORY).toMatchObject({
      material: "equipment",
      labor: "installation",
      plant: "equipment",
      subcontract: "other",
      other: "other",
    });
  });

  it("emits contingency as its own category and skips zero stages", () => {
    const buildup = computeEstimate(LINES, MARGINS);
    const drafts = proposalLinesFromEstimate(LINES, buildup);
    const contingency = drafts.filter((d) => d.category === "contingency");
    expect(contingency).toHaveLength(1);
    expect(contingency[0].line_total).toBe(5100);
    expect(drafts.map((d) => d.description)).toContain("Escalation");
    expect(drafts.map((d) => d.description)).toContain("Overhead & indirect costs");
    expect(drafts.every((d) => d.line_total !== 0)).toBe(true);

    const zeroStages = proposalLinesFromEstimate(
      LINES,
      computeEstimate(LINES, {
        escalation_pct: 0,
        contingency_pct: 0,
        overhead_pct: 0,
        profit_pct: 10,
      }),
    );
    expect(zeroStages.some((d) => d.category === "contingency")).toBe(false);
    expect(zeroStages.some((d) => d.description === "Escalation")).toBe(false);
  });

  it("reconciles Σ line_total with the build-up subtotal", () => {
    const buildup = computeEstimate(LINES, MARGINS);
    expect(sumLineTotals(proposalLinesFromEstimate(LINES, buildup))).toBe(buildup.subtotal);
  });
});

describe("createProposalFromEstimate", () => {
  it("writes a draft proposal whose subtotal and total match the estimate", async () => {
    const w = makeWorld({ estimates: [ESTIMATE], proposals: [], proposal_line_items: [] });
    const { proposalId, lineCount } = await createProposalFromEstimate(w.ctx, {
      companyId: COMPANY_A,
      estimate: ESTIMATE,
      opportunityId: "opp-1",
      lines: LINES,
    });
    const buildup = computeEstimate(LINES, MARGINS);
    const proposal = w.db.proposals[0];
    expect(proposalId).toBeTruthy();
    expect(proposal.status).toBe("draft");
    expect(proposal.currency_code).toBe("USD");
    expect(proposal.subtotal).toBe(buildup.subtotal);
    expect(proposal.total).toBe(buildup.total_price);
    const items = w.db.proposal_line_items;
    expect(items).toHaveLength(lineCount);
    const sum = Math.round(items.reduce((a, i) => a + Number(i.line_total), 0) * 100) / 100;
    expect(sum).toBe(Number(proposal.subtotal));
    const margin = Number(proposal.margin_pct);
    expect(Math.round(Number(proposal.subtotal) * (1 + margin / 100) * 100) / 100).toBe(
      Number(proposal.total),
    );
  });

  it("never fails the conversion when the digital-thread link table is missing", async () => {
    const w = makeWorld(
      { entity_links: [] },
      { failOn: (table, op) => (table === "entity_links" && op === "insert" ? "42P01" : null) },
    );
    await expect(
      linkEstimateToProposal(w.ctx, {
        companyId: COMPANY_A,
        projectId: "proj-1",
        estimateId: "est-1",
        proposalId: "prop-1",
      }),
    ).resolves.toBeUndefined();
  });
});
