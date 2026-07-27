// P-224 — vendor-proposed delivery window rules.
import { describe, expect, it } from "vitest";

import {
  COUNTER_PROPOSED_PREFIX,
  VENDOR_PROPOSED_PREFIX,
  counterProposedNote,
  isCounterProposedNote,
  isVendorProposedNote,
  parsePoLines,
  validateProposedDate,
} from "@/lib/vendor-portal.rules";

describe("vendor-proposed note detection", () => {
  it("detects vendor proposals", () => {
    expect(isVendorProposedNote(VENDOR_PROPOSED_PREFIX)).toBe(true);
    expect(isVendorProposedNote("Vendor-proposed — ships from Genoa")).toBe(true);
    expect(isVendorProposedNote("Chased vendor")).toBe(false);
    expect(isVendorProposedNote(null)).toBe(false);
  });

  it("detects counter-proposals and never confuses them with vendor ones", () => {
    const note = counterProposedNote("  site cannot receive earlier  ");
    expect(note).toBe(`${COUNTER_PROPOSED_PREFIX}site cannot receive earlier`);
    expect(isCounterProposedNote(note)).toBe(true);
    expect(isVendorProposedNote(note)).toBe(false);
  });
});

describe("validateProposedDate", () => {
  it("requires a date", () => {
    expect(validateProposedDate("", "2026-01-01")).toBe("proposed_date_required");
    expect(validateProposedDate(null, "2026-01-01")).toBe("proposed_date_required");
  });

  it("rejects malformed dates", () => {
    expect(validateProposedDate("01/02/2026", "2026-01-01")).toBe("proposed_date_invalid");
  });

  it("rejects dates before the PO issue date", () => {
    expect(validateProposedDate("2025-12-31", "2026-01-01")).toBe("proposed_date_before_issue");
  });

  it("accepts the issue date itself and later dates", () => {
    expect(validateProposedDate("2026-01-01", "2026-01-01")).toBeNull();
    expect(validateProposedDate("2026-06-15", "2026-01-01")).toBeNull();
  });

  it("accepts a timestamped issue date and a missing one", () => {
    expect(validateProposedDate("2026-01-02", "2026-01-01T09:30:00Z")).toBeNull();
    expect(validateProposedDate("1999-01-02", null)).toBeNull();
  });
});

describe("parsePoLines line numbering", () => {
  it("keeps explicit line numbers and falls back to position", () => {
    const lines = parsePoLines([
      { line_no: 7, description: "Inverter", qty: 4, uom: "ea" },
      { description: "Cable", quantity: 100, unit: "m" },
    ]);
    expect(lines[0].line_no).toBe(7);
    expect(lines[1].line_no).toBe(2);
    expect(lines[0].quantity).toBe(4);
    expect(lines[1].uom).toBe("m");
  });

  it("returns an empty array for non-array payloads", () => {
    expect(parsePoLines(null)).toEqual([]);
  });
});
