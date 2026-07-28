// P-254 — HSE/quality exposure: heat intensity, TRIR trend, drill-through URLs.
import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/portfolio.en.json";
import ar from "@/lib/i18n/portfolio.ar.json";
import {
  dimensionMaxima,
  EXPOSURE_DIMENSIONS,
  exposureScore,
  heatLevel,
  holdPointDrill,
  incidentDrill,
  ncrDrill,
  orderedCounts,
  punchDrill,
  sortByExposure,
  totalCounts,
  trirTrend,
  type ExposureProjectRow,
} from "@/lib/portfolio/exposure.rules";

const row = (over: Partial<ExposureProjectRow>): ExposureProjectRow => ({
  project_id: "p1",
  project_code: "AAA-001",
  project_name: "Alpha",
  incidents_open: 0,
  punch_a_open: 0,
  punch_b_open: 0,
  punch_c_open: 0,
  ncr_open: 0,
  hold_points_open: 0,
  last_incident_at: null,
  days_since_last_incident: null,
  ...over,
});

describe("heat intensity", () => {
  it("keeps zero cold and any open item at least level 1", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(1, 0)).toBe(1);
  });

  it("tiers by share of the column maximum", () => {
    expect(heatLevel(2, 8)).toBe(1); // 25%
    expect(heatLevel(3, 8)).toBe(2); // 37.5%
    expect(heatLevel(5, 8)).toBe(3); // 62.5%
    expect(heatLevel(8, 8)).toBe(4); // 100%
  });

  it("renders one project as an honest single row (its own value is the max)", () => {
    const rows = [row({ incidents_open: 1, punch_a_open: 0 })];
    const max = dimensionMaxima(rows);
    expect(max.incidents_open).toBe(1);
    expect(max.punch_a_open).toBe(0);
    expect(heatLevel(rows[0].incidents_open, max.incidents_open)).toBe(4);
    expect(heatLevel(rows[0].punch_a_open, max.punch_a_open)).toBe(0);
  });

  it("computes a maximum for every dimension column", () => {
    const max = dimensionMaxima([
      row({ incidents_open: 2, ncr_open: 1 }),
      row({ project_id: "p2", project_code: "BBB-002", incidents_open: 5, hold_points_open: 3 }),
    ]);
    for (const dim of EXPOSURE_DIMENSIONS) expect(max[dim]).toBeGreaterThanOrEqual(0);
    expect(max.incidents_open).toBe(5);
    expect(max.hold_points_open).toBe(3);
  });
});

describe("exposure ranking", () => {
  it("weights incidents and gate-blocking punch A hardest", () => {
    expect(exposureScore(row({ incidents_open: 1 }))).toBe(5);
    expect(exposureScore(row({ punch_a_open: 1 }))).toBe(3);
    expect(exposureScore(row({ punch_b_open: 1 }))).toBe(1);
  });

  it("sorts the troubled project first, ties by code", () => {
    const rows = [
      row({ project_id: "p1", project_code: "BBB", punch_b_open: 1 }),
      row({ project_id: "p2", project_code: "CCC", incidents_open: 2 }),
      row({ project_id: "p3", project_code: "AAA", punch_b_open: 1 }),
    ];
    expect(sortByExposure(rows).map((r) => r.project_code)).toEqual(["CCC", "AAA", "BBB"]);
  });
});

describe("TRIR trend", () => {
  it("falling TRIR is good news", () => {
    const t = trirTrend(1.2, 2.4);
    expect(t.direction).toBe("down");
    expect(t.delta).toBeCloseTo(-1.2, 10);
    expect(t.pct).toBeCloseTo(-50, 10);
    expect(t.tone).toBe("good");
  });

  it("rising TRIR is bad news", () => {
    expect(trirTrend(3, 1)).toMatchObject({ direction: "up", tone: "bad", pct: 200 });
  });

  it("is flat when unchanged and unknown without a comparable period", () => {
    expect(trirTrend(2, 2)).toMatchObject({ direction: "flat", tone: "neutral", delta: 0 });
    expect(trirTrend(2, null)).toMatchObject({ direction: "unknown", pct: null, delta: null });
    expect(trirTrend(null, 2).direction).toBe("unknown");
  });

  it("never divides by a zero prior rate", () => {
    expect(trirTrend(2, 0)).toMatchObject({ direction: "up", pct: null, delta: 2 });
  });
});

describe("counts", () => {
  it("zero-fills a fixed order", () => {
    expect(orderedCounts({ A: 3 }, ["A", "B", "C"] as const)).toEqual([
      { key: "A", count: 3 },
      { key: "B", count: 0 },
      { key: "C", count: 0 },
    ]);
    expect(orderedCounts(null, ["A"] as const)).toEqual([{ key: "A", count: 0 }]);
  });

  it("totals a count map", () => {
    expect(totalCounts({ A: 2, B: 1 })).toBe(3);
    expect(totalCounts(undefined)).toBe(0);
  });
});

describe("drill-through URLs", () => {
  it("punch A drills to the open A list for the project", () => {
    expect(punchDrill("proj-1", "A")).toEqual({
      to: "/qaqc/punch",
      search: { projectId: "proj-1", category: "A", status: "open", view: "list" },
    });
  });

  it("omits projectId for portfolio-wide drills", () => {
    expect(punchDrill(null, "B").search).toEqual({
      category: "B",
      status: "open",
      view: "list",
    });
    expect(incidentDrill(null).search).toEqual({});
  });

  it("targets NCR, incident and hold-point lists", () => {
    expect(ncrDrill("p", "in_progress")).toEqual({
      to: "/qaqc/ncrs",
      search: { projectId: "p", status: "in_progress" },
    });
    expect(incidentDrill("p", "open")).toEqual({
      to: "/hse/incidents",
      search: { projectId: "p", status: "open" },
    });
    expect(holdPointDrill("p")).toEqual({
      to: "/quality/itp",
      search: { projectId: "p", pointType: "hold" },
    });
  });
});

describe("i18n catalog parity", () => {
  const keys = (obj: unknown, prefix = ""): string[] =>
    Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it("exposure keys exist in both catalogs", () => {
    const e = keys(en.exposure).sort();
    const a = keys(ar.exposure).sort();
    expect(a).toEqual(e);
    expect(e).toContain("heat.holdPoints");
    expect(e).toContain("trend.down");
  });

  it("Arabic exposure strings are actually translated", () => {
    expect(ar.exposure.heading).toBe("التعرض");
    expect(ar.exposure.daysSince).toBe("أيام منذ آخر حادث");
    expect(ar.exposure.holdPoints).toBe("نقاط التوقف المفتوحة");
  });
});
