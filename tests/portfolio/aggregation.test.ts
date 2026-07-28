// P-256 — Portfolio aggregation fixture suite.
//
// Three projects, three phases, three contract currencies, uneven manhours.
// Every expected number is hand-computed in `EXPECTED` and asserted here to
// the cent — this suite is the proof that the portfolio RPCs weight ratios
// (ΣEV/ΣPV) instead of averaging per-project ratios, that FX is frozen at
// entry, and that the heat table orders deterministically.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  currentMonth,
  EXPECTED,
  isSupabaseUp,
  setupPortfolioFixture,
  type PortfolioFixture,
} from "./fixtures";

const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

const n = (v: unknown): number => Number(v ?? 0);
const round = (v: number, places: number): number =>
  Math.round(v * 10 ** places) / 10 ** places;

d("P-256 · portfolio aggregation over a 3-project fixture", () => {
  let fx: PortfolioFixture;

  beforeAll(async () => {
    fx = await setupPortfolioFixture();
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
  }, 120_000);

  it("portfolio_kpis returns weighted SPI/CPI, not an average of ratios", async () => {
    const { data, error } = await fx.client.rpc("portfolio_kpis");
    expect(error).toBeNull();
    const k = data as Record<string, never>;

    expect(k.base_currency).toBe(EXPECTED.baseCurrency);
    expect(n((k.projects as Record<string, unknown>).total)).toBe(EXPECTED.projects.total);
    expect((k.projects as Record<string, unknown>).by_phase).toMatchObject(
      EXPECTED.projects.byPhase,
    );
    expect(n(k.contract_value)).toBe(EXPECTED.contractValue);

    const evm = k.evm as Record<string, unknown>;
    expect(n(evm.pv)).toBe(EXPECTED.evm.pv);
    expect(n(evm.ev)).toBe(EXPECTED.evm.ev);
    expect(n(evm.ac)).toBe(EXPECTED.evm.ac);
    expect(n(evm.bac)).toBe(EXPECTED.evm.bac);
    expect(n(evm.projects_counted)).toBe(EXPECTED.evm.projectsCounted);
    expect(round(n(evm.spi), 6)).toBe(EXPECTED.evm.spi);
    expect(round(n(evm.cpi), 6)).toBe(EXPECTED.evm.cpi);

    // The wrong answer an unweighted mean would produce.
    const meanSpi = (0.9 + 1.1 + 400_000 / 600_000) / 3;
    expect(round(n(evm.spi), 6)).not.toBe(round(meanSpi, 6));

    expect(n(k.ar_open)).toBe(EXPECTED.arOpen);
    expect(n(k.ap_open)).toBe(EXPECTED.apOpen);
    const cash = k.cash_mtd as Record<string, unknown>;
    expect(n(cash.inflow)).toBe(EXPECTED.cashMtd.inflow);
    expect(n(cash.outflow)).toBe(EXPECTED.cashMtd.outflow);
  });

  it("portfolio_gates places every project on the rail", async () => {
    const { data, error } = await fx.client.rpc("portfolio_gates");
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const byCode = Object.fromEntries(rows.map((r) => [r.project_code as string, r]));

    expect(rows).toHaveLength(3);

    expect(n(byCode[fx.codes.A].gates_total)).toBe(3);
    expect(n(byCode[fx.codes.A].gates_approved)).toBe(1);
    expect(byCode[fx.codes.A].current_gate_name).toBe("A-G1");
    expect(byCode[fx.codes.A].next_gate_name).toBe("A-G2");

    expect(n(byCode[fx.codes.B].gates_total)).toBe(4);
    expect(n(byCode[fx.codes.B].gates_approved)).toBe(4);
    expect(byCode[fx.codes.B].current_gate_name).toBe("B-G4");
    expect(byCode[fx.codes.B].next_gate_name).toBeNull();

    expect(n(byCode[fx.codes.C].gates_total)).toBe(3);
    expect(n(byCode[fx.codes.C].gates_approved)).toBe(2);
    expect(byCode[fx.codes.C].current_gate_name).toBe("C-G2");
    expect(byCode[fx.codes.C].next_gate_name).toBe("C-G3");
  });

  it("portfolio_project_cards carries per-project EVM and punch-A counts", async () => {
    const { data, error } = await fx.client.rpc("portfolio_project_cards");
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const byCode = Object.fromEntries(rows.map((r) => [r.project_code as string, r]));

    for (const key of ["A", "B", "C"] as const) {
      const card = byCode[fx.codes[key]];
      const exp = EXPECTED.cards[key];
      expect(round(n(card.spi), 6)).toBe(exp.spi);
      expect(round(n(card.cpi), 6)).toBe(exp.cpi);
      expect(n(card.punch_a_open)).toBe(exp.punchAOpen);
      expect(n(card.gates_total)).toBe(exp.gatesTotal);
      expect(n(card.gates_approved)).toBe(exp.gatesApproved);
    }

    // Deterministic ordering by project code.
    expect(rows.map((r) => r.project_code)).toEqual([fx.codes.A, fx.codes.B, fx.codes.C]);
  });

  it("portfolio_hse_quality computes TRIR over uneven manhours", async () => {
    const { data, error } = await fx.client.rpc("portfolio_hse_quality");
    expect(error).toBeNull();
    const h = data as Record<string, never>;

    expect(n(h.incidents_open)).toBe(EXPECTED.hse.incidentsOpen);
    expect(n(h.incidents_total)).toBe(EXPECTED.hse.incidentsTotal);
    expect(n(h.recordable_count)).toBe(EXPECTED.hse.recordable);
    expect(n(h.exposure_hours)).toBe(EXPECTED.hse.exposureHours);
    expect(round(n(h.trir), 4)).toBe(EXPECTED.hse.trir);
    expect(h.punch_open).toMatchObject(EXPECTED.hse.punchOpen);
    expect(n(h.punch_open_total)).toBe(EXPECTED.hse.punchOpenTotal);
    expect(n(h.ncr_open)).toBe(EXPECTED.hse.ncrOpen);
  });

  it("portfolio_hse_exposure orders the heat table and counts hold points", async () => {
    const { data, error } = await fx.client.rpc("portfolio_hse_exposure");
    expect(error).toBeNull();
    const e = data as Record<string, never>;

    expect(n(e.incidents_open)).toBe(EXPECTED.hse.incidentsOpen);
    expect(e.incidents_by_severity).toMatchObject({ major: 1, minor: 1 });
    expect(n(e.exposure_hours_current)).toBe(EXPECTED.hse.exposureHours);
    expect(round(n(e.trir_current), 4)).toBe(EXPECTED.hse.trir);
    expect(n(e.hold_points_open)).toBe(EXPECTED.hse.holdPointsOpen);

    const rows = (e.by_project ?? []) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.project_code)).toEqual([fx.codes.A, fx.codes.B, fx.codes.C]);

    const a = rows.find((r) => r.project_code === fx.codes.A)!;
    expect(n(a.incidents_open)).toBe(1);
    expect(n(a.punch_a_open)).toBe(2);
    expect(n(a.punch_b_open)).toBe(1);
    expect(n(a.hold_points_open)).toBe(1);

    const b = rows.find((r) => r.project_code === fx.codes.B)!;
    expect(n(b.punch_c_open)).toBe(1);
    expect(n(b.ncr_open)).toBe(1);
  });

  it("cash curve consolidates mixed currencies at the FX fixed on entry", async () => {
    const { data, error } = await fx.client.rpc("portfolio_cash_curve", { p_months: 3 });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const month = rows.find((r) => String(r.month).slice(0, 10) === currentMonth());
    expect(month).toBeDefined();

    expect(n(month!.forecast_inflow)).toBe(EXPECTED.curve.forecastInflow);
    expect(n(month!.forecast_outflow)).toBe(EXPECTED.curve.forecastOutflow);
    expect(n(month!.actual_inflow)).toBe(EXPECTED.curve.actualInflow);
    expect(n(month!.actual_outflow)).toBe(EXPECTED.curve.actualOutflow);
    expect(n(month!.forecast_net)).toBe(EXPECTED.curve.forecastNet);
    expect(n(month!.actual_net)).toBe(EXPECTED.curve.actualNet);
  });

  it("per-project curve attributes each movement to its project", async () => {
    const { data, error } = await fx.client.rpc("portfolio_cash_curve_projects", {
      p_back: 2,
      p_forward: 1,
    });
    expect(error).toBeNull();
    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter(
      (r) => String(r.month).slice(0, 10) === currentMonth(),
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.project_code as string, r]));

    for (const key of ["A", "B", "C"] as const) {
      const exp = EXPECTED.perProjectCurve[key];
      const row = byCode[fx.codes[key]];
      expect(n(row.forecast_inflow)).toBe(exp.forecastInflow);
      expect(n(row.forecast_outflow)).toBe(exp.forecastOutflow);
      expect(n(row.actual_inflow)).toBe(exp.actualInflow);
      expect(n(row.actual_outflow)).toBe(exp.actualOutflow);
    }
  });

  it("month drill lists every non-voided movement in the month", async () => {
    const { data, error } = await fx.client.rpc("portfolio_cash_month", {
      p_month: currentMonth(),
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<Record<string, unknown>>;

    // 5 live rows; the voided 999,999 forecast must not appear.
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => n(r.amount) === 999_999)).toBe(false);

    const jod = rows.find((r) => r.currency_code === "JOD")!;
    expect(n(jod.amount)).toBe(71_000);
    expect(n(jod.amount_base)).toBe(100_110);
    expect(jod.base_currency).toBe("USD");
  });
});
