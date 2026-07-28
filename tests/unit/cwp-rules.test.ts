// P-179 — pure rule tests for CWP numbering, look-ahead weeks, rollups.
import { describe, expect, it } from "vitest";

import {
  formatSequenceNumber,
  isMonday,
  lookAheadUpsertSchema,
  nextSequence,
  rollupProgress,
  weightingRuleSchema,
} from "@/lib/cwp.rules";

describe("cwp numbering", () => {
  it("pads sequences to four digits", () => {
    expect(formatSequenceNumber("CWP", 1)).toBe("CWP-0001");
    expect(formatSequenceNumber("RCP", 42)).toBe("RCP-0042");
    expect(formatSequenceNumber("CWP", 12345)).toBe("CWP-12345");
  });

  it("derives the next sequence from existing numbers", () => {
    expect(nextSequence("CWP", [])).toBe(1);
    expect(nextSequence("CWP", ["CWP-0001", "CWP-0009", "CWP-0003"])).toBe(10);
    expect(nextSequence("CWP", ["RCP-0100", "junk"])).toBe(1);
  });
});

describe("look-ahead week validation", () => {
  it("accepts Mondays only", () => {
    expect(isMonday("2026-07-27")).toBe(true); // Monday
    expect(isMonday("2026-07-26")).toBe(false); // Sunday
    expect(isMonday("not-a-date")).toBe(false);
  });

  it("zod refine rejects a non-Monday week_start", () => {
    const base = {
      projectId: "11111111-1111-4111-8111-111111111111",
      entries: [],
    };
    expect(lookAheadUpsertSchema.safeParse({ ...base, weekStart: "2026-07-27" }).success).toBe(
      true,
    );
    expect(lookAheadUpsertSchema.safeParse({ ...base, weekStart: "2026-07-28" }).success).toBe(
      false,
    );
  });
});

describe("weighting rule bounds", () => {
  const base = { discipline: "civil", name: "Piling", uom: "item" as const };
  it("rejects target_qty <= 0 and weight_pct outside 0–100", () => {
    expect(weightingRuleSchema.safeParse({ ...base, targetQty: 0, weightPct: 10 }).success).toBe(
      false,
    );
    expect(weightingRuleSchema.safeParse({ ...base, targetQty: 5, weightPct: 101 }).success).toBe(
      false,
    );
    expect(weightingRuleSchema.safeParse({ ...base, targetQty: 5, weightPct: 100 }).success).toBe(
      true,
    );
  });
});

describe("weighted progress rollup", () => {
  it("returns 0 with no weight instead of NaN", () => {
    expect(rollupProgress([])).toBe(0);
    expect(rollupProgress([{ weight: 0, progress_pct: 50 }])).toBe(0);
  });

  it("weights package progress", () => {
    expect(
      rollupProgress([
        { weight: 3, progress_pct: 100 },
        { weight: 1, progress_pct: 0 },
      ]),
    ).toBe(75);
  });
});
