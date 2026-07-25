import { describe, expect, it } from "vitest";
import {
  assertGrnPhotoPath,
  computePoStatusAfterGrn,
  countDefects,
  deriveGrnStatus,
  formatGrnNumber,
  grnDraftPayload,
  nextGrnNumber,
  overReceivedLines,
  type GrnLine,
  type ReceivableLine,
} from "@/lib/grn-rules";

const line = (over: Partial<GrnLine> = {}): GrnLine => ({
  po_line_no: 1,
  description: "Modules",
  uom: "pcs",
  qty_ordered: 100,
  qty_received: 100,
  lot_ids: [],
  condition: "ok",
  defect_notes: null,
  ...over,
});

const receivable = (over: Partial<ReceivableLine> = {}): ReceivableLine => ({
  po_line_no: 1,
  description: "Modules",
  uom: "pcs",
  qty_ordered: 100,
  qty_already_received: 0,
  qty_remaining: 100,
  ...over,
});

describe("nextGrnNumber", () => {
  it("starts at GRN-0001", () => {
    expect(nextGrnNumber([])).toBe("GRN-0001");
  });
  it("increments past the highest existing number", () => {
    expect(nextGrnNumber(["GRN-0001", "GRN-0007", "DRAFT-x"])).toBe("GRN-0008");
  });
  it("formats with leading zeros", () => {
    expect(formatGrnNumber(42)).toBe("GRN-0042");
  });
});

describe("overReceivedLines", () => {
  it("returns empty when quantities fit", () => {
    expect(
      overReceivedLines([line({ qty_received: 50 })], [receivable({ qty_remaining: 100 })]),
    ).toEqual([]);
  });
  it("flags lines that exceed the remaining qty", () => {
    expect(
      overReceivedLines([line({ qty_received: 150 })], [receivable({ qty_remaining: 100 })]),
    ).toEqual([1]);
  });
});

describe("deriveGrnStatus", () => {
  it("returns confirmed when all lines are OK and fully received", () => {
    expect(deriveGrnStatus([line()])).toBe("confirmed");
  });
  it("returns has_defects on damaged condition", () => {
    expect(deriveGrnStatus([line({ condition: "damaged", defect_notes: "dent" })])).toBe(
      "has_defects",
    );
  });
  it("returns has_defects on short ship", () => {
    expect(deriveGrnStatus([line({ qty_received: 90 })])).toBe("has_defects");
  });
});

describe("countDefects", () => {
  it("counts non-ok lines and lines with defect notes", () => {
    expect(
      countDefects([line(), line({ po_line_no: 2, condition: "damaged", defect_notes: "x" })]),
    ).toBe(1);
  });
});

describe("computePoStatusAfterGrn", () => {
  const poLines = [
    { line_no: 1, qty: 100 },
    { line_no: 2, qty: 50 },
  ];
  it("returns null when nothing received", () => {
    expect(computePoStatusAfterGrn(poLines, [])).toBeNull();
  });
  it("returns partially_received when any line short", () => {
    expect(
      computePoStatusAfterGrn(poLines, [
        { po_line_no: 1, qty_received: 100 },
        { po_line_no: 2, qty_received: 25 },
      ]),
    ).toBe("partially_received");
  });
  it("returns received when every line met or exceeded", () => {
    expect(
      computePoStatusAfterGrn(poLines, [
        { po_line_no: 1, qty_received: 100 },
        { po_line_no: 2, qty_received: 50 },
      ]),
    ).toBe("received");
  });
});

describe("grnDraftPayload zod", () => {
  it("rejects negative qty_received", () => {
    const result = grnDraftPayload.safeParse({
      lines: [
        {
          po_line_no: 1,
          description: "x",
          uom: "pcs",
          qty_ordered: 10,
          qty_received: -1,
          lot_ids: [],
          condition: "ok",
        },
      ],
      photos: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("assertGrnPhotoPath", () => {
  it("accepts paths under the tenant/grn prefix", () => {
    expect(() => assertGrnPhotoPath("co/grn/g1/pic.jpg", "co", "g1")).not.toThrow();
  });
  it("rejects paths outside the prefix", () => {
    expect(() => assertGrnPhotoPath("other/grn/g1/pic.jpg", "co", "g1")).toThrow();
  });
  it("rejects traversal", () => {
    expect(() => assertGrnPhotoPath("co/grn/g1/../evil.jpg", "co", "g1")).toThrow();
  });
});
