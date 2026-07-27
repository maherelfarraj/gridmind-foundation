// P-223 — Unit tests for PO acknowledgment rules.
import { describe, expect, it } from "vitest";

import {
  countdownLabel,
  isAcknowledgeable,
  parsePoLines,
  requiresComment,
  validateAcknowledgment,
  vendorPortalErrorCode,
  vendorPortalErrorMessage,
} from "@/lib/vendor-portal.rules";

describe("isAcknowledgeable", () => {
  it("allows open POs only", () => {
    expect(isAcknowledgeable("issued")).toBe(true);
    expect(isAcknowledgeable("partially_received")).toBe(true);
    expect(isAcknowledgeable("draft")).toBe(false);
    expect(isAcknowledgeable("closed")).toBe(false);
    expect(isAcknowledgeable("cancelled")).toBe(false);
  });
});

describe("validateAcknowledgment", () => {
  it("requires a comment for rejection and accept-with-comments", () => {
    expect(requiresComment("accepted")).toBe(false);
    expect(validateAcknowledgment("accepted", null)).toEqual({ ok: true });
    expect(validateAcknowledgment("rejected", "   ")).toEqual({
      ok: false,
      code: "comment_required",
    });
    expect(validateAcknowledgment("accepted_with_comments", undefined)).toEqual({
      ok: false,
      code: "comment_required",
    });
    expect(validateAcknowledgment("rejected", "Wrong voltage class")).toEqual({ ok: true });
  });
});

describe("countdownLabel", () => {
  const now = new Date("2026-07-27T00:00:00Z");
  it("handles null and invalid dates", () => {
    expect(countdownLabel(null, now)).toBeNull();
    expect(countdownLabel("not-a-date", now)).toBeNull();
  });
  it("labels future, today and overdue", () => {
    expect(countdownLabel("2026-07-30T00:00:00Z", now)).toMatchObject({
      overdue: false,
      label: "In 3 days",
    });
    expect(countdownLabel("2026-07-27T00:00:00Z", now)?.label).toBe("Due today");
    expect(countdownLabel("2026-07-25T00:00:00Z", now)).toMatchObject({
      overdue: true,
      label: "2 days overdue",
    });
  });
});

describe("parsePoLines", () => {
  it("returns [] for non-array payloads", () => {
    expect(parsePoLines(null)).toEqual([]);
    expect(parsePoLines({ a: 1 })).toEqual([]);
  });
  it("normalizes aliases and derives amounts", () => {
    const [line] = parsePoLines([{ item: "Tracker", qty: "4", unit_price: "2.5", unit: "ea" }]);
    expect(line).toEqual({
      description: "Tracker",
      spec: null,
      quantity: 4,
      uom: "ea",
      unit_price: 2.5,
      amount: 10,
    });
  });
});

describe("vendorPortalErrorCode", () => {
  it("maps acknowledgment errors", () => {
    expect(vendorPortalErrorCode(new Error("comment_required"))).toBe("comment_required");
    expect(vendorPortalErrorCode({ message: "po_not_acknowledgeable" })).toBe(
      "po_not_acknowledgeable",
    );
    expect(vendorPortalErrorMessage("po_not_acknowledgeable")).toMatch(/no longer/i);
  });
});
