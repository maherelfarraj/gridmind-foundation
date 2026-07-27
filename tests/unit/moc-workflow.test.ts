// P-192 — MOC approval chain + transition truth table (pure mirror of 0078 SQL).
import { describe, expect, it } from "vitest";

import { CR_STATUSES, type CrStatus } from "@/lib/moc.rules";
import {
  ALLOWED_TRANSITIONS,
  canSubmitChangeRequest,
  evaluateTransition,
  nextCrNumber,
  resolveMocRuleKey,
} from "@/lib/moc.state";

const ACTIVE_RULES = ["moc_default", "moc_vendor_substitution"];

describe("submit_change_request", () => {
  it("picks the vendor-substitution chain over the default chain", () => {
    expect(resolveMocRuleKey("vendor_substitution", ACTIVE_RULES)).toBe("moc_vendor_substitution");
  });

  it("falls back to moc_default for a change type without its own chain", () => {
    expect(resolveMocRuleKey("design", ACTIVE_RULES)).toBe("moc_default");
    expect(resolveMocRuleKey("vendor_substitution", ["moc_default"])).toBe("moc_default");
  });

  it("requires description and reason before submission", () => {
    expect(canSubmitChangeRequest({ status: "draft", description: "", reason: "x" })).toEqual({
      ok: false,
      error: "description_and_reason_required",
    });
    expect(canSubmitChangeRequest({ status: "draft", description: "d", reason: "r" }).ok).toBe(
      true,
    );
  });

  it("is idempotent once the CR has left draft", () => {
    expect(canSubmitChangeRequest({ status: "assessment" })).toEqual({
      ok: true,
      idempotent: true,
    });
  });

  it("numbers change requests per company as CR-0007", () => {
    expect(nextCrNumber(6)).toBe("CR-0007");
    expect(nextCrNumber(0)).toBe("CR-0001");
    expect(nextCrNumber(9999)).toBe("CR-10000");
  });
});

describe("transition_change_request — truth table", () => {
  const legal = new Set<string>();
  for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const to of tos) legal.add(`${from}->${to}`);
  }

  it("allows exactly the documented edges", () => {
    expect(Array.from(legal).sort()).toEqual(
      [
        "approved->cancelled",
        "approved->implementing",
        "assessment->approved",
        "assessment->cancelled",
        "assessment->rejected",
        "draft->assessment",
        "draft->cancelled",
        "implementing->closed",
      ].sort(),
    );
  });

  it("raises invalid_transition on every illegal jump", () => {
    for (const from of CR_STATUSES) {
      for (const to of CR_STATUSES) {
        if (from === to || legal.has(`${from}->${to}`)) continue;
        const res = evaluateTransition({
          from: from as CrStatus,
          to: to as CrStatus,
          approvalStatus: "approved",
          rejectionReason: "because",
          evidenceCount: 1,
          closureNotes: "done",
          isCompanyAdmin: true,
        });
        expect(res, `${from}->${to}`).toEqual({ ok: false, error: "invalid_transition" });
      }
    }
  });

  it("treats a no-op transition as idempotent", () => {
    expect(evaluateTransition({ from: "assessment", to: "assessment" })).toEqual({
      ok: true,
      status: "assessment",
      idempotent: true,
    });
  });

  it("blocks approved until the approval instance is approved", () => {
    expect(
      evaluateTransition({ from: "assessment", to: "approved", approvalStatus: "in_progress" }),
    ).toEqual({ ok: false, error: "approval_not_complete" });
    expect(
      evaluateTransition({ from: "assessment", to: "approved", approvalStatus: null }),
    ).toEqual({ ok: false, error: "approval_not_complete" });
    expect(
      evaluateTransition({ from: "assessment", to: "approved", approvalStatus: "approved" }),
    ).toEqual({ ok: true, status: "approved", idempotent: false });
  });

  it("requires a reason when rejecting outside the chain", () => {
    expect(evaluateTransition({ from: "assessment", to: "rejected" })).toEqual({
      ok: false,
      error: "rejection_reason_required",
    });
    expect(
      evaluateTransition({ from: "assessment", to: "rejected", rejectionReason: "  " }),
    ).toEqual({ ok: false, error: "rejection_reason_required" });
    expect(
      evaluateTransition({ from: "assessment", to: "rejected", rejectionReason: "Not viable" }).ok,
    ).toBe(true);
    // A chain rejection carries its own reason.
    expect(
      evaluateTransition({ from: "assessment", to: "rejected", approvalStatus: "rejected" }).ok,
    ).toBe(true);
  });

  it("blocks closure without evidence or closure notes", () => {
    expect(evaluateTransition({ from: "implementing", to: "closed", closureNotes: "ok" })).toEqual({
      ok: false,
      error: "implementation_evidence_required",
    });
    expect(evaluateTransition({ from: "implementing", to: "closed", evidenceCount: 2 })).toEqual({
      ok: false,
      error: "closure_notes_required",
    });
    expect(
      evaluateTransition({
        from: "implementing",
        to: "closed",
        evidenceCount: 2,
        closureNotes: "As-builts updated",
      }),
    ).toEqual({ ok: true, status: "closed", idempotent: false });
  });

  it("permits cancellation only for the originator or a company admin", () => {
    expect(evaluateTransition({ from: "draft", to: "cancelled" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(evaluateTransition({ from: "draft", to: "cancelled", isOriginator: true }).ok).toBe(
      true,
    );
    expect(
      evaluateTransition({ from: "assessment", to: "cancelled", isCompanyAdmin: true }).ok,
    ).toBe(true);
  });

  it("fails closed for non-members and unauthenticated callers", () => {
    expect(evaluateTransition({ from: "draft", to: "assessment", authenticated: false })).toEqual({
      ok: false,
      error: "not_authenticated",
    });
    expect(evaluateTransition({ from: "draft", to: "assessment", isMember: false })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("walks the happy path draft → assessment → approved → implementing → closed", () => {
    let status: CrStatus = "draft";
    const steps: Array<[CrStatus, Partial<Parameters<typeof evaluateTransition>[0]>]> = [
      ["assessment", {}],
      ["approved", { approvalStatus: "approved" }],
      ["implementing", {}],
      ["closed", { evidenceCount: 1, closureNotes: "Closed out" }],
    ];
    for (const [to, extra] of steps) {
      const res = evaluateTransition({ from: status, to, ...extra });
      expect(res.ok, `${status}->${to}`).toBe(true);
      status = to;
    }
    expect(status).toBe("closed");
  });
});
