// P-214 — Estimate approval chain: engineering_admin → finance_admin.
import { describe, expect, it } from "vitest";

import { loadEstimateApproval, loadDecisionComment, patchEstimate } from "@/lib/estimating.server";
import { audit } from "@/lib/payments.server";
import {
  decideChain,
  makeChainWorld,
  makeEstimate,
  makeWorld,
  startChain,
  type ChainInstance,
} from "./fixtures";

describe("chain ordering", () => {
  it("opens step 1 for engineering_admin holders only", () => {
    const world = makeChainWorld();
    const instance = startChain(world);
    expect(instance.current_step).toBe(1);
    expect(instance.approvals.map((a) => a.role)).toEqual(["engineering_admin"]);
    expect(decideChain(world, "user-fin", "approved")).toMatchObject({ error: "wrong_role" });
  });

  it("advances to fresh finance_admin rows after step 1 approves", () => {
    const world = makeChainWorld();
    startChain(world);
    expect(decideChain(world, "user-eng", "approved").ok).toBe(true);
    expect(world.instance!.current_step).toBe(2);
    const step2 = world.instance!.approvals.filter((a) => a.step_order === 2);
    expect(step2).toHaveLength(1);
    expect(step2[0]).toMatchObject({ role: "finance_admin", decision: "pending" });
    expect(world.instance!.status).toBe("pending");
  });

  it("marks the instance approved only after both steps decide", () => {
    const world = makeChainWorld();
    startChain(world);
    decideChain(world, "user-eng", "approved");
    decideChain(world, "user-fin", "approved");
    expect(world.instance!.status).toBe("approved");
  });

  it("rejects at any step and stops the chain", () => {
    const world = makeChainWorld();
    startChain(world);
    decideChain(world, "user-eng", "rejected", "Rates are stale");
    expect(world.instance!.status).toBe("rejected");
    expect(decideChain(world, "user-fin", "approved")).toMatchObject({ error: "not_pending" });
  });
});

/** Mirror of checkEstimateApproval's outcome application (server handler). */
async function applyOutcome(w: ReturnType<typeof makeWorld>, instance: ChainInstance) {
  const snapshot = await loadEstimateApproval(w.ctx, "est-1");
  if (!snapshot) return "none";
  if (snapshot.status === "approved") {
    await patchEstimate(w.ctx, "est-1", {
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "user-eng",
    });
    await audit(w.ctx, "estimate.approved", "estimates", "est-1", { instance: instance.id });
    return "approved";
  }
  if (snapshot.status === "rejected") {
    const comment = await loadDecisionComment(w.ctx, snapshot.id);
    await patchEstimate(w.ctx, "est-1", { status: "draft", rejection_comment: comment });
    await audit(w.ctx, "estimate.rejected", "estimates", "est-1", { comment });
    return "draft";
  }
  return "in_review";
}

function seedWorld(instanceStatus: string, comment: string | null = null) {
  return makeWorld({
    estimates: [makeEstimate({ status: "in_review" })],
    approval_instances: [
      {
        id: "appr-1",
        entity_type: "estimate",
        entity_id: "est-1",
        status: instanceStatus,
        current_step: instanceStatus === "pending" ? 1 : 2,
        sla_due_at: null,
        requested_at: "2026-07-20T00:00:00.000Z",
      },
    ],
    approvals: comment
      ? [{ instance_id: "appr-1", comment, decided_at: "2026-07-21T00:00:00.000Z" }]
      : [],
  });
}

describe("applying the outcome to the estimate", () => {
  it("stamps approved + approved_at/by and audits estimate.approved", async () => {
    const w = seedWorld("approved");
    const world = makeChainWorld();
    const instance = startChain(world);
    expect(await applyOutcome(w, instance)).toBe("approved");
    expect(w.db.estimates[0]).toMatchObject({ status: "approved", approved_by: "user-eng" });
    expect(w.db.estimates[0].approved_at).toBeTruthy();
    expect(w.audits().map((a) => a.args.p_action)).toContain("estimate.approved");
  });

  it("returns a rejected estimate to draft with the decision comment", async () => {
    const w = seedWorld("rejected", "Rates are stale");
    const world = makeChainWorld();
    const instance = startChain(world);
    expect(await applyOutcome(w, instance)).toBe("draft");
    expect(w.db.estimates[0]).toMatchObject({
      status: "draft",
      rejection_comment: "Rates are stale",
    });
    expect(w.audits().map((a) => a.args.p_action)).toContain("estimate.rejected");
  });

  it("leaves the estimate in review while the chain is pending", async () => {
    const w = seedWorld("pending");
    const world = makeChainWorld();
    expect(await applyOutcome(w, startChain(world))).toBe("in_review");
    expect(w.db.estimates[0].status).toBe("in_review");
  });
});
