// P-035 — Selection schema unit tests.
import { describe, expect, it } from "vitest";

import {
  BLANK_SELECTION,
  budgetLineSchema,
  projectSelectionSchema,
} from "@/lib/schemas/project-wizard";

describe("projectSelectionSchema", () => {
  it("accepts the blank default selection", () => {
    expect(projectSelectionSchema.safeParse(BLANK_SELECTION).success).toBe(true);
  });

  it("rejects when budget shares don't sum to 100%", () => {
    const bad = {
      ...BLANK_SELECTION,
      budget_lines: [
        { category: "EPC", code: "A", label: "A", share: 0.5 },
        { category: "EPC", code: "B", label: "B", share: 0.3 },
      ],
    };
    const r = projectSelectionSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("accepts shares that sum within tolerance", () => {
    const ok = {
      ...BLANK_SELECTION,
      budget_lines: [
        { category: "EPC", code: "A", label: "A", share: 0.334 },
        { category: "EPC", code: "B", label: "B", share: 0.333 },
        { category: "EPC", code: "C", label: "C", share: 0.333 },
      ],
    };
    expect(projectSelectionSchema.safeParse(ok).success).toBe(true);
  });

  it("requires at least one gate and one department", () => {
    expect(
      projectSelectionSchema.safeParse({
        ...BLANK_SELECTION,
        gates: [],
      }).success,
    ).toBe(false);
    expect(
      projectSelectionSchema.safeParse({
        ...BLANK_SELECTION,
        departments: [],
      }).success,
    ).toBe(false);
  });

  it("clamps budget line share to 0..1", () => {
    expect(
      budgetLineSchema.safeParse({
        category: "EPC",
        code: "X",
        label: "X",
        share: 1.5,
      }).success,
    ).toBe(false);
  });
});
