// P-080 — Unit tests for invoice & debit-note rules.
import { describe, expect, it } from "vitest";
import {
  computeMilestoneBill,
  extractSovLineNoFromLabel,
  milestoneLabelFor,
  sumPriorBilledPerLine,
} from "@/lib/invoices.rules";
import { nextDebitNoteNumber } from "@/lib/debit-notes.rules";

describe("computeMilestoneBill", () => {
  it("computes a straight percentage of scheduled", () => {
    const r = computeMilestoneBill(1000, 0, 30);
    expect(r.amount).toBe(300);
    expect(r.hitCap).toBe(false);
    expect(r.cappedPct).toBe(30);
    expect(r.remainingAfter).toBe(700);
  });

  it("caps to remaining unbilled and reports cappedPct", () => {
    const r = computeMilestoneBill(1000, 800, 90);
    // Remaining is 200; capped to 200.
    expect(r.amount).toBe(200);
    expect(r.hitCap).toBe(true);
    expect(r.cappedPct).toBe(20);
    expect(r.remainingAfter).toBe(0);
  });

  it("throws when the SOV line is fully billed", () => {
    expect(() => computeMilestoneBill(500, 500, 10)).toThrow(/fully billed/);
  });

  it("rejects invalid pct", () => {
    expect(() => computeMilestoneBill(100, 0, 0)).toThrow();
    expect(() => computeMilestoneBill(100, 0, 101)).toThrow();
  });

  it("uses cents math so 0.1+0.2 doesn't drift", () => {
    const r1 = computeMilestoneBill(100, 0, 10); // 10.00
    const r2 = computeMilestoneBill(100, 10, 20); // 20.00
    expect(r1.amount + r2.amount).toBe(30);
  });
});

describe("SOV line label parsing", () => {
  it("extracts the SOV line number from a milestone label", () => {
    expect(extractSovLineNoFromLabel("SOV #3 — Foundations @25%")).toBe(3);
    expect(extractSovLineNoFromLabel("SOV#12 — X")).toBe(12);
    expect(extractSovLineNoFromLabel("Retention release")).toBeNull();
    expect(extractSovLineNoFromLabel(null)).toBeNull();
  });

  it("sums prior billed per SOV line and ignores cancelled", () => {
    const map = sumPriorBilledPerLine([
      { milestone_label: "SOV #1 — Mob @10%", amount: 100, status: "draft" },
      { milestone_label: "SOV #1 — Mob @20%", amount: 200, status: "paid" },
      { milestone_label: "SOV #2 — X", amount: 500, status: "paid" },
      { milestone_label: "SOV #2 — X", amount: 999, status: "cancelled" },
      { milestone_label: null, amount: 50, status: "draft" },
    ]);
    expect(map.get(1)).toBe(300);
    expect(map.get(2)).toBe(500);
    expect(map.has(3)).toBe(false);
  });

  it("truncates long descriptions in the label", () => {
    const label = milestoneLabelFor(2, "x".repeat(100), 25);
    expect(label.startsWith("SOV #2 — ")).toBe(true);
    expect(label).toContain("@25%");
    expect(label.length).toBeLessThan(90);
  });
});

describe("nextDebitNoteNumber", () => {
  it("starts at DN-0001", () => {
    expect(nextDebitNoteNumber([])).toBe("DN-0001");
  });
  it("increments the max, ignoring drafts", () => {
    expect(nextDebitNoteNumber(["DN-0001", "DN-0004", "DRAFT-ABC"])).toBe("DN-0005");
  });
});
