// P-089 — QA/QC unit tests.
import { describe, expect, it } from "vitest";
import {
  computeHeatmap,
  heatmapCellTint,
  inspectionInput,
  nextInspectionNumber,
  type HeatmapRowInput,
} from "@/lib/qaqc.rules";

describe("nextInspectionNumber", () => {
  it("starts at QA-0001 on empty", () => {
    expect(nextInspectionNumber([])).toBe("QA-0001");
  });
  it("increments from max existing", () => {
    expect(nextInspectionNumber(["QA-0009", "QA-0003"])).toBe("QA-0010");
  });
  it("ignores malformed entries", () => {
    expect(nextInspectionNumber(["INS-9999", "QA-0004"])).toBe("QA-0005");
  });
});

describe("inspectionInput.superRefine", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    discipline: "civil" as const,
    area: "Block A",
    inspectionDate: "2026-06-01",
    result: "fail" as const,
  };
  it("rejects rework_required without notes", () => {
    const res = inspectionInput.safeParse({
      ...base,
      reworkRequired: true,
      reworkNotes: "",
    });
    expect(res.success).toBe(false);
  });
  it("rejects rework_required with whitespace-only notes", () => {
    const res = inspectionInput.safeParse({
      ...base,
      reworkRequired: true,
      reworkNotes: "   ",
    });
    expect(res.success).toBe(false);
  });
  it("accepts rework_required with real notes", () => {
    const res = inspectionInput.safeParse({
      ...base,
      reworkRequired: true,
      reworkNotes: "Concrete honeycomb — patch and re-inspect",
    });
    expect(res.success).toBe(true);
  });
  it("accepts pass without notes", () => {
    const res = inspectionInput.safeParse({
      ...base,
      result: "pass",
      reworkRequired: false,
    });
    expect(res.success).toBe(true);
  });
});

describe("heatmapCellTint", () => {
  it("no-data cells are muted", () => {
    expect(heatmapCellTint(0, 0)).toBe("bg-muted");
    expect(heatmapCellTint(1, 0)).toBe("bg-muted");
  });
  it("clean cells use emerald", () => {
    expect(heatmapCellTint(0, 5)).toContain("emerald");
  });
  it("scales destructive opacity as fail rate rises", () => {
    expect(heatmapCellTint(0.05, 20)).toBe("bg-destructive/10");
    expect(heatmapCellTint(0.2, 20)).toBe("bg-destructive/25");
    expect(heatmapCellTint(0.4, 20)).toBe("bg-destructive/40");
    expect(heatmapCellTint(0.6, 20)).toBe("bg-destructive/55");
    expect(heatmapCellTint(0.9, 20)).toBe("bg-destructive/70");
  });
});

describe("computeHeatmap", () => {
  const rows: HeatmapRowInput[] = [
    { area: "Block A", discipline: "civil", result: "pass", rework_required: false },
    { area: "Block A", discipline: "civil", result: "fail", rework_required: true },
    { area: "Block A", discipline: "electrical", result: "pass", rework_required: false },
    { area: "Block B", discipline: "civil", result: "conditional", rework_required: false },
    { area: "Block B", discipline: "electrical", result: "fail", rework_required: true },
  ];
  const s = computeHeatmap(rows);
  it("collects and sorts areas", () => {
    expect(s.areas).toEqual(["Block A", "Block B"]);
  });
  it("counts pass/fail/rework per cell", () => {
    const a = s.cells["Block A"].civil;
    expect(a.count).toBe(2);
    expect(a.pass).toBe(1);
    expect(a.fail).toBe(1);
    expect(a.rework).toBe(1);
    expect(a.failRate).toBe(1); // (1 fail + 1 rework) / 2 = 1, capped
    const b = s.cells["Block B"].mechanical;
    expect(b.count).toBe(0);
  });
  it("aggregates totals and rework %", () => {
    expect(s.totals.total).toBe(5);
    expect(s.totals.pass).toBe(2);
    expect(s.totals.fail).toBe(2);
    expect(s.totals.rework).toBe(2);
    expect(s.totals.reworkPct).toBeCloseTo(0.4, 5);
  });
});
