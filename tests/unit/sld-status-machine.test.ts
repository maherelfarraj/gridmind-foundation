// P-146 — Unit tests for the pure SLD status machine.
import { describe, expect, it } from "vitest";

import {
  availableTransitions,
  checkTransition,
  isStructurallyAllowed,
  type TransitionContext,
} from "@/lib/sld/status-machine";

const base: TransitionContext = {
  current: "draft",
  objectCount: 5,
  hasValidation: true,
  errorCount: 0,
  openSignoffs: 0,
  approvalStatus: "none",
  isEngineeringAdmin: true,
  hasReplacement: false,
};

describe("sld status machine", () => {
  it("only allows the documented edges", () => {
    expect(isStructurallyAllowed("draft", "under_review")).toBe(true);
    expect(isStructurallyAllowed("draft", "ifc")).toBe(false);
    expect(isStructurallyAllowed("approved", "superseded")).toBe(true);
    expect(isStructurallyAllowed("superseded", "draft")).toBe(false);
  });

  it("blocks review with zero objects", () => {
    const r = checkTransition({ ...base, objectCount: 0 }, "under_review");
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("empty_drawing");
  });

  it("requires a validation run before review", () => {
    const r = checkTransition({ ...base, hasValidation: false }, "under_review");
    expect(r.code).toBe("validation_required");
  });

  it("blocks approval on error-severity validation issues", () => {
    const r = checkTransition({ ...base, current: "under_review", errorCount: 3 }, "approved");
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("validation_errors");
    expect(r.reason).toContain("3");
  });

  it("blocks approval while reviewer signoffs are open", () => {
    const r = checkTransition({ ...base, current: "under_review", openSignoffs: 2 }, "approved");
    expect(r.code).toBe("open_signoffs");
  });

  it("blocks approval while the engine instance is pending", () => {
    const r = checkTransition(
      { ...base, current: "under_review", approvalStatus: "pending" },
      "approved",
    );
    expect(r.code).toBe("approval_pending");
  });

  it("requires a completed approval and engineering admin for IFC", () => {
    expect(
      checkTransition({ ...base, current: "approved", approvalStatus: "approved" }, "ifc").allowed,
    ).toBe(true);
    expect(checkTransition({ ...base, current: "approved" }, "ifc").code).toBe(
      "approval_incomplete",
    );
    expect(
      checkTransition(
        { ...base, current: "approved", approvalStatus: "approved", isEngineeringAdmin: false },
        "ifc",
      ).code,
    ).toBe("forbidden");
  });

  it("requires a replacement reference to supersede", () => {
    expect(checkTransition({ ...base, current: "ifc" }, "superseded").code).toBe(
      "replacement_required",
    );
    expect(
      checkTransition({ ...base, current: "ifc", hasReplacement: true }, "superseded").allowed,
    ).toBe(true);
  });

  it("annotates every non-current target for the dropdown", () => {
    const list = availableTransitions(base);
    expect(list).toHaveLength(5);
    expect(list.find((t) => t.target === "ifc")?.code).toBe("invalid_transition");
    expect(list.find((t) => t.target === "under_review")?.allowed).toBe(true);
  });
});
