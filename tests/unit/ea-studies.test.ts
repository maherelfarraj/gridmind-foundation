// P-165 — ea_studies record pattern: numbering, transitions, catalogue. Offline.
import { describe, expect, it } from "vitest";

import {
  canTransition,
  EA_DISCLAIMER,
  EA_STUDY_LIST,
  EA_STUDY_SPECS,
  EA_STUDY_TYPES,
  formatStudyNumber,
  isEditable,
  nextStudySequence,
  parseStudyNumber,
} from "@/lib/ea/study-types";

describe("study catalogue", () => {
  it("covers all 18 study types with a spec each", () => {
    expect(EA_STUDY_TYPES).toHaveLength(18);
    expect(EA_STUDY_LIST).toHaveLength(18);
    for (const type of EA_STUDY_TYPES) {
      const spec = EA_STUDY_SPECS[type];
      expect(spec.type).toBe(type);
      expect(spec.label.length).toBeGreaterThan(2);
      expect(spec.defaultStandards.length).toBeGreaterThan(0);
    }
  });

  it("states the not-formally-validated disclaimer without a compliance claim", () => {
    expect(EA_DISCLAIMER).toContain("Not formally validated");
    expect(EA_DISCLAIMER).toContain("qualified professional engineer");
    expect(EA_DISCLAIMER.toLowerCase()).not.toContain("certified compliant");
  });
});

describe("study numbering", () => {
  it("zero-pads to four digits and keeps growing beyond 9999", () => {
    expect(formatStudyNumber(1)).toBe("EA-0001");
    expect(formatStudyNumber(42)).toBe("EA-0042");
    expect(formatStudyNumber(9999)).toBe("EA-9999");
    expect(formatStudyNumber(10000)).toBe("EA-10000");
  });

  it("rejects non-positive or fractional sequences", () => {
    expect(() => formatStudyNumber(0)).toThrow();
    expect(() => formatStudyNumber(-3)).toThrow();
    expect(() => formatStudyNumber(1.5)).toThrow();
  });

  it("round-trips through parseStudyNumber and ignores foreign shapes", () => {
    expect(parseStudyNumber("EA-0007")).toBe(7);
    expect(parseStudyNumber(" EA-0123 ")).toBe(123);
    expect(parseStudyNumber("EA-12")).toBeNull();
    expect(parseStudyNumber("SLD-0001")).toBeNull();
    expect(parseStudyNumber("EA-0000")).toBeNull();
  });

  it("takes the max issued number, not the row count, so gaps never collide", () => {
    expect(nextStudySequence([])).toBe(1);
    expect(nextStudySequence(["EA-0001", "EA-0002"])).toBe(3);
    // A deleted EA-0002 must not hand EA-0003 out twice.
    expect(nextStudySequence(["EA-0001", "EA-0003"])).toBe(4);
    expect(nextStudySequence(["EA-0009", "legacy-1", "EA-0004"])).toBe(10);
  });
});

describe("status workflow", () => {
  it("allows draft → under_review → approved and recall to draft", () => {
    expect(canTransition("draft", "under_review")).toBe(true);
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("under_review", "draft")).toBe(true);
  });

  it("never moves out of approved without a new revision", () => {
    expect(canTransition("approved", "draft")).toBe(false);
    expect(canTransition("approved", "under_review")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("only a draft is editable", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("under_review")).toBe(false);
    expect(isEditable("approved")).toBe(false);
  });
});
