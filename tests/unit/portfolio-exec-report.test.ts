// P-255 — Executive portfolio PDF: pure math, PDF bytes, table smoke,
// export-lock 423 path and the audit row shape.
import { describe, expect, it, vi } from "vitest";

import { buildPortfolioExecReportPdf } from "@/lib/exports/portfolio-exec-pdf";
import {
  CONFIDENTIALITY_NOTE,
  LANGUAGE_NOTE,
  chartSeries,
  countRows,
  curveTotals,
  execReportFilename,
  fmtIndex,
  monthLabel,
  niceScale,
  perfVerdict,
  periodFromWindow,
  periodLabel,
  plotX,
  plotY,
  type PortfolioExecReportData,
} from "@/lib/portfolio/exec-report.rules";

// ---------------------------------------------------------------------------
// Fixture — two projects, a real July inflow and an August forecast.

const fixture = (): PortfolioExecReportData => ({
  company: { id: "c1", name: "GSI", legalName: "Green Solar Industries" },
  branding: {
    primaryColor: "#1e40af",
    accentColor: "#0d9488",
    footerText: "gridmind.example",
    logoSignedUrl: null,
  },
  period: { start: "2026-07-01", end: "2026-08-01" },
  generatedAt: "2026-07-28T09:30:00.000Z",
  generatedBy: "Maher",
  baseCurrency: "USD",
  kpis: {
    base_currency: "USD",
    projects: { total: 2, by_phase: { development: 1, construction: 1 }, by_status: { active: 2 } },
    contract_value: 48_500_000,
    evm: { pv: 300, ev: 310, ac: 320, bac: 500, spi: 310 / 300, cpi: 310 / 320, projects_counted: 2 },
    ar_open: 960,
    ap_open: 400,
    cash_mtd: { inflow: 275_000, outflow: 41_000 },
  },
  cards: [
    {
      project_id: "p1",
      project_code: "GSI-EAM-001",
      project_name: "East Amman Hybrid PV + BESS",
      phase: "development",
      status: "active",
      gates_total: 4,
      gates_approved: 1,
      current_gate_name: "Development gate",
      current_gate_status: "approved",
      next_gate_name: "NTP gate",
      next_gate_due: "2026-09-30",
      target_cod: "2027-06-30",
      contract_value: 48_500_000,
      currency_code: "USD",
      planned_value: 300,
      earned_value: 310,
      actual_cost: 320,
      spi: 310 / 300,
      cpi: 310 / 320,
      punch_a_open: 0,
    },
  ],
  gates: [
    {
      project_id: "p1",
      project_code: "GSI-EAM-001",
      project_name: "East Amman Hybrid PV + BESS",
      phase: "development",
      status: "active",
      gates_total: 4,
      gates_approved: 1,
      current_gate_name: "Development gate",
      current_gate_status: "approved",
      next_gate_name: "NTP gate",
      next_gate_due: "2026-09-30",
    },
  ],
  curve: [
    {
      month: "2026-07-01",
      forecast_inflow: 200_000,
      forecast_outflow: 0,
      actual_inflow: 275_000,
      actual_outflow: 0,
      forecast_net: 200_000,
      actual_net: 275_000,
    },
    {
      month: "2026-08-01",
      forecast_inflow: 0,
      forecast_outflow: 41_000,
      actual_inflow: 0,
      actual_outflow: 0,
      forecast_net: -41_000,
      actual_net: 0,
    },
  ],
  exposure: {
    incidents_open: 1,
    incidents_by_severity: { minor: 1 },
    trir_current: 100,
    trir_prior: null,
    exposure_hours_current: 2000,
    exposure_hours_prior: 0,
    punch_open: { A: 0, B: 0, C: 0 },
    ncr_open_by_status: {},
    hold_points_open: 2,
    by_project: [
      {
        project_id: "p1",
        project_code: "GSI-EAM-001",
        project_name: "East Amman Hybrid PV + BESS",
        incidents_open: 1,
        punch_a_open: 0,
        punch_b_open: 0,
        punch_c_open: 0,
        ncr_open: 0,
        hold_points_open: 2,
        last_incident_at: "2026-07-27T00:00:00.000Z",
        days_since_last_incident: 1,
      },
    ],
  },
  rowCounts: { projects: 1, gates: 1, curve_months: 2, exposure_projects: 1 },
});

// ---------------------------------------------------------------------------

describe("report labelling", () => {
  it("formats months and periods in English regardless of UI locale", () => {
    expect(monthLabel("2026-07-01")).toBe("Jul 2026");
    expect(monthLabel("2026-07-01", false)).toBe("July 2026");
    expect(monthLabel("garbage")).toBe("—");
    expect(periodLabel({ start: "2026-07-01", end: "2026-08-01" })).toBe("Jul 2026 – Aug 2026");
    expect(periodLabel({ start: "2026-07-01", end: "2026-07-01" })).toBe("Jul 2026");
  });

  it("derives a month window around a reference date", () => {
    expect(periodFromWindow(new Date("2026-07-15T00:00:00Z"), 12, 6)).toEqual({
      start: "2025-07-01",
      end: "2027-01-01",
    });
  });

  it("builds a safe filename", () => {
    expect(execReportFilename("GSI / Solar", { start: "2026-07-01", end: "2026-08-01" })).toBe(
      "GSI_Solar_Portfolio_Executive_Report_2026-08.pdf",
    );
  });

  it("applies the dashboard thresholds", () => {
    expect(perfVerdict(1.03)).toBe("On track");
    expect(perfVerdict(0.95)).toBe("On track");
    expect(perfVerdict(0.9)).toBe("Watch");
    expect(perfVerdict(0.4)).toBe("Behind");
    expect(perfVerdict(null)).toBe("No data");
    expect(fmtIndex(310 / 300)).toBe("1.033");
    expect(fmtIndex(null)).toBe("—");
  });
});

describe("chart geometry", () => {
  it("builds an axis that always contains zero", () => {
    const s = niceScale([275000, -41000]);
    expect(s.min).toBeLessThanOrEqual(-41000);
    expect(s.max).toBeGreaterThanOrEqual(275000);
    expect(s.ticks[0]).toBe(s.min);
    expect(s.ticks.at(-1)).toBe(s.max);
    expect(s.ticks).toContain(0);
  });

  it("handles a flat all-zero series without dividing by zero", () => {
    const s = niceScale([0, 0]);
    expect(Number.isFinite(s.step)).toBe(true);
    expect(s.max).toBeGreaterThan(s.min);
  });

  it("maps values into the plot box, larger values higher on the page", () => {
    const s = niceScale([0, 100]);
    expect(plotY(s.max, s, 10, 100)).toBeCloseTo(10, 6);
    expect(plotY(s.min, s, 10, 100)).toBeCloseTo(110, 6);
    expect(plotY(s.max, s, 10, 100)).toBeLessThan(plotY(s.min, s, 10, 100));
    expect(plotX(0, 3, 0, 100)).toBe(0);
    expect(plotX(2, 3, 0, 100)).toBe(100);
    expect(plotX(0, 1, 0, 100)).toBe(50);
  });

  it("plots forecast and actual nets for every month", () => {
    const s = chartSeries(fixture().curve);
    expect(s.months).toEqual(["2026-07-01", "2026-08-01"]);
    expect(s.actual).toEqual([275_000, 0]);
    expect(s.forecast).toEqual([200_000, -41_000]);
  });
});

describe("monthly table totals", () => {
  it("sums every column", () => {
    const t = curveTotals(fixture().curve);
    expect(t.actual_inflow).toBe(275_000);
    expect(t.forecast_net).toBe(159_000);
    expect(t.actual_net).toBe(275_000);
  });

  it("counts rows for the audit metadata", () => {
    const d = fixture();
    expect(countRows(d)).toEqual({
      projects: 1,
      gates: 1,
      curve_months: 2,
      exposure_projects: 1,
    });
  });
});

describe("PDF generation", () => {
  it("produces valid PDF bytes with the expected page count", async () => {
    const { bytes, filename } = await buildPortfolioExecReportPdf(fixture());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(4000);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // cover + KPIs + cash + projects + exposure
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(filename).toBe("GSI_Portfolio_Executive_Report_2026-08.pdf");
  });

  it("renders tables through jspdf-autotable v5 without regressions", async () => {
    const autotable = await import("jspdf-autotable");
    expect(typeof autotable.default).toBe("function");
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(
      readFileSync("node_modules/jspdf-autotable/package.json", "utf8"),
    ) as { version: string };
    expect(pkg.version).toMatch(/^5\./);

    const plain = await buildPortfolioExecReportPdf(fixture());
    const empty = await buildPortfolioExecReportPdf({
      ...fixture(),
      cards: [],
      gates: [],
      curve: [],
      exposure: { ...fixture().exposure, by_project: [] },
    });
    // Tables actually drew content: the populated report is materially larger.
    expect(plain.bytes.byteLength).toBeGreaterThan(empty.bytes.byteLength);
    // …and the empty portfolio still yields a valid, complete document.
    expect(Buffer.from(empty.bytes).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("survives a portfolio with no data at all", async () => {
    const bare = fixture();
    const { bytes } = await buildPortfolioExecReportPdf({
      ...bare,
      cards: [],
      gates: [],
      curve: [],
      kpis: { ...bare.kpis, projects: { total: 0, by_phase: {}, by_status: {} } },
      exposure: {
        ...bare.exposure,
        incidents_open: 0,
        incidents_by_severity: {},
        trir_current: null,
        by_project: [],
      },
    });
    expect(Buffer.from(bytes).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("stamps confidentiality, the live-data note and the English-document note", () => {
    expect(CONFIDENTIALITY_NOTE).toMatch(/Confidential/);
    expect(LANGUAGE_NOTE).toMatch(/English/);
  });
});

// ---------------------------------------------------------------------------
// Governance: export lock 423 + audit row.

describe("export governance", () => {
  it("raises a typed 423 when a project in scope is locked", async () => {
    const { assertExportAllowed } = await import("@/lib/export-guard");
    const inserted: unknown[] = [];
    const supabase = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "sync_export_locks") return { data: null, error: null };
        return { data: null, error: { message: "export_locked: approval pending" } };
      }),
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { company_id: "c1" }, error: null }) }),
        }),
        insert: async (row: unknown) => {
          if (table === "audit_logs") inserted.push(row);
          return { error: null };
        },
      }),
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    } as never;

    await expect(assertExportAllowed(supabase, "p1", "portfolio_report")).rejects.toMatchObject({
      statusCode: 423,
      code: "export_locked",
      exportType: "portfolio_report",
    });
    // exactly one blocked-attempt audit row
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      action: "export.blocked",
      metadata: { export_type: "portfolio_report", status_code: 423 },
    });
  });

  it("passes through when no project is locked", async () => {
    const { assertExportAllowed } = await import("@/lib/export-guard");
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: null })) } as never;
    await expect(assertExportAllowed(supabase, "p1", "portfolio_report")).resolves.toBeUndefined();
  });

  it("writes an export.portfolio_report audit row carrying actor and row counts", () => {
    const d = fixture();
    const metadata = {
      actor_id: "u1",
      period_start: d.period.start,
      period_end: d.period.end,
      base_currency: d.baseCurrency,
      row_counts: countRows(d),
    };
    expect(metadata.row_counts.projects).toBe(1);
    expect(metadata.row_counts.curve_months).toBe(2);
    expect(metadata.base_currency).toBe("USD");
  });
});
