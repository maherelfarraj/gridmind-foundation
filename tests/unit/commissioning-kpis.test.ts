import { describe, expect, it } from "vitest";
import {
  computeMcCod,
  pickPrAtCod,
  rollupPunchClosure,
  serializeKpisCsv,
  type CommissioningKpisPayload,
} from "@/lib/commissioning-kpis.rules";

describe("computeMcCod", () => {
  it("returns empty when no MC", () => {
    const k = computeMcCod({ mcDate: null, codDate: null, targetCod: "2026-12-01" });
    expect(k.state).toBe("empty");
    expect(k.projected_cod).toBe("2026-12-01");
    expect(k.days).toBeNull();
  });
  it("returns mc_only with elapsed + projected", () => {
    const k = computeMcCod({
      mcDate: "2026-01-01",
      codDate: null,
      targetCod: "2026-06-01",
      now: new Date("2026-02-01T00:00:00Z"),
    });
    expect(k.state).toBe("mc_only");
    expect(k.elapsed_since_mc).toBe(31);
    expect(k.projected_cod).toBe("2026-06-01");
    expect(k.days).toBeNull();
  });
  it("returns complete with day diff", () => {
    const k = computeMcCod({
      mcDate: "2026-01-01",
      codDate: "2026-03-15",
      targetCod: null,
    });
    expect(k.state).toBe("complete");
    expect(k.days).toBe(73);
  });
});

describe("pickPrAtCod", () => {
  it("prefers certificate over perf test", () => {
    const r = pickPrAtCod({
      certificate: { pr_at_cod: 82.5 },
      latestPerfTest: { measured_value: 79, contract_value: 80 },
      contractPr: 80,
    });
    expect(r.source).toBe("certificate");
    expect(r.measured).toBe(82.5);
    expect(r.contract).toBe(80);
    expect(r.passing).toBe(true);
  });
  it("falls back to perf test", () => {
    const r = pickPrAtCod({
      certificate: null,
      latestPerfTest: { measured_value: 78, contract_value: 80 },
      contractPr: null,
    });
    expect(r.source).toBe("performance_test");
    expect(r.passing).toBe(false);
    expect(r.delta).toBe(-2);
  });
  it("returns null source with neither", () => {
    const r = pickPrAtCod({ certificate: null, latestPerfTest: null, contractPr: 80 });
    expect(r.source).toBeNull();
    expect(r.measured).toBeNull();
  });
});

describe("rollupPunchClosure", () => {
  it("groups totals and open refs by category", () => {
    const r = rollupPunchClosure([
      { category: "A", status: "open", punch_number: "PN-0001" },
      { category: "A", status: "closed", punch_number: "PN-0002" },
      { category: "B", status: "in_progress", punch_number: "PN-0003" },
      { category: "C", status: "closed", punch_number: "PN-0004" },
    ]);
    const a = r.find((x) => x.category === "A")!;
    expect(a.total).toBe(2);
    expect(a.closed).toBe(1);
    expect(a.open_refs).toEqual(["PN-0001"]);
    const c = r.find((x) => x.category === "C")!;
    expect(c.closed).toBe(1);
  });
});

describe("serializeKpisCsv", () => {
  it("emits header + rows", () => {
    const payload: CommissioningKpisPayload = {
      project: { id: "p", name: "n", code: "C1", phase: "commissioning" },
      mcCod: {
        state: "complete",
        mc_date: "2026-01-01",
        cod_date: "2026-03-15",
        projected_cod: null,
        days: 73,
        elapsed_since_mc: null,
      },
      prAtCod: { source: "certificate", measured: 82.5, contract: 80, delta: 2.5, passing: true },
      punchClosure: [
        { category: "A", total: 2, closed: 1, open_refs: ["PN-0001"] },
        { category: "B", total: 0, closed: 0, open_refs: [] },
        { category: "C", total: 0, closed: 0, open_refs: [] },
      ],
      availability: { state: "awaiting_scada", cod_date: "2026-03-15" },
      testSummary: [
        { test_type: "iv_curve", passed: 3, failed: 0, in_progress: 1, not_started: 0 },
      ],
      turnoverStatus: { status: "delivered", compiled_at: null, delivered_at: "2026-03-20" },
      permissions: { canRead: true },
    };
    const csv = serializeKpisCsv(payload);
    expect(csv.split("\n")[0]).toBe("metric,value,detail");
    expect(csv).toContain("MC to COD (days),73");
    expect(csv).toContain("PR at COD (%),82.50");
    expect(csv).toContain("Punch closure A,50%");
    expect(csv).toContain("Turnover status,delivered");
  });
});
