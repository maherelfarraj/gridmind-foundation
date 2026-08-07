// GC-04 — forecast-version CSV exports (snapshot + comparison).
import { describe, expect, it } from "vitest";

import {
  buildForecastCompareCsv,
  buildForecastVersionCsv,
  forecastVersionCsvFilename,
} from "@/lib/costing.versions.csv";
import { diffSnapshots, snapshotTotals, type ForecastSnapshotLine } from "@/lib/costing.versions";

const line = (over: Partial<ForecastSnapshotLine> = {}): ForecastSnapshotLine => ({
  cost_code_id: "cc-1",
  cost_code_key: "cc-1",
  cost_code: "01-100",
  cost_code_name: "Civil works",
  currency_code: "EUR",
  base_currency_code: "USD",
  fx_rate: 1.08,
  fx_rate_date: "2026-03-01",
  fx_source: "table",
  fx_override_reason: null,
  etc_amount: 1000,
  etc_amount_base: 1080,
  budget_current: 5000,
  committed: 2000,
  actual: 1500,
  accruals: 250,
  eac: 2830,
  vac: 2170,
  ...over,
});

const header = {
  version_no: 3,
  status: "approved",
  reporting_period: "2026-03-01",
  base_currency_code: "USD",
  project_name: "East Amman 50 MW",
};

describe("forecast version CSV", () => {
  it("writes one row per line plus a TOTAL row at the frozen rates", () => {
    const lines = [
      line(),
      line({ cost_code_id: null, cost_code_key: "__unassigned__", cost_code: null }),
    ];
    const csv = buildForecastVersionCsv(header, lines, snapshotTotals(lines, "USD"));
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(4); // header + 2 lines + TOTAL
    expect(rows[0]).toContain("cost_code");
    expect(rows[0]).toContain("fx_rate");
    expect(rows[2]).toContain("Unassigned");
    expect(rows[3]).toContain("TOTAL");
    // Totals: actual 3000, accruals 500, etc 2160 -> eac 5660
    expect(rows[3]).toContain("5660.00");
    // The locked rate is echoed, never recomputed.
    expect(rows[1]).toContain("1.08");
  });

  it("omits the TOTAL row when no totals are supplied", () => {
    expect(buildForecastVersionCsv(header, [line()]).trim().split("\n")).toHaveLength(2);
  });

  it("builds a safe filename from the project and period", () => {
    expect(forecastVersionCsvFilename(header)).toBe("East-Amman-50-MW-forecast-v3-2026-03.csv");
    expect(forecastVersionCsvFilename({ ...header, project_name: null })).toBe(
      "forecast-forecast-v3-2026-03.csv",
    );
  });

  it("flattens comparison drivers and totals", () => {
    const diff = diffSnapshots([line()], [line({ actual: 2500, eac: 3830 })]);
    const csv = buildForecastCompareCsv("v2", "v3", diff);
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain("changed");
    expect(rows[1]).toContain("actual:1000.00");
    expect(rows[2]).toContain("TOTAL");
    expect(rows[2]).toContain("1000.00");
  });
});
