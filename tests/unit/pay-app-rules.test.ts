// P-079 — Pay-app rules unit tests.
import { describe, expect, it } from "vitest";
import {
  PayAppLineValidationError,
  computePayAppTotals,
  nextInvoiceNumber,
  nextPayAppNumber,
  reconcilePayApp,
  validateCertifyInput,
  type PayAppLine,
} from "@/lib/pay-app.rules";
import { nextChangeOrderNumber } from "@/lib/change-orders.rules";

function mkLine(overrides: Partial<PayAppLine>): PayAppLine {
  return {
    sov_line_no: 1,
    description: "l",
    scheduled_amount: 1000,
    prev_certified: 0,
    this_period: 0,
    total_certified: 0,
    pct_complete: 0,
    ...overrides,
  };
}

describe("computePayAppTotals", () => {
  it("sums lines and applies retention (5%)", () => {
    const t = computePayAppTotals(
      [
        mkLine({ sov_line_no: 1, scheduled_amount: 1000, prev_certified: 200, this_period: 300 }),
        mkLine({ sov_line_no: 2, scheduled_amount: 500, prev_certified: 0, this_period: 100 }),
      ],
      5,
    );
    expect(t.total_scheduled).toBe(1500);
    expect(t.total_certified).toBe(600);
    expect(t.retention_amount).toBe(30);
    expect(t.net_amount).toBe(570);
    expect(t.lines[0].total_certified).toBe(500);
    expect(t.lines[0].pct_complete).toBe(50);
  });

  it("no float drift on 3-decimal inputs", () => {
    const t = computePayAppTotals(
      [
        mkLine({ scheduled_amount: 0.1, prev_certified: 0, this_period: 0.2, sov_line_no: 1 }),
        mkLine({ scheduled_amount: 0.7, prev_certified: 0, this_period: 0.1, sov_line_no: 2 }),
      ],
      10,
    );
    expect(t.total_certified).toBeCloseTo(0.3, 10);
    expect(t.retention_amount).toBeCloseTo(0.03, 10);
    expect(t.net_amount).toBeCloseTo(0.27, 10);
  });

  it("clamps retention pct outside 0..100", () => {
    const t = computePayAppTotals([mkLine({ scheduled_amount: 100, this_period: 100 })], 200);
    expect(t.retention_amount).toBe(100);
    expect(t.net_amount).toBe(0);
  });
});

describe("validateCertifyInput", () => {
  it("passes when all lines are valid", () => {
    expect(() =>
      validateCertifyInput([
        mkLine({ scheduled_amount: 100, prev_certified: 40, this_period: 50 }),
      ]),
    ).not.toThrow();
  });

  it("throws with sov_line_no on negative this_period", () => {
    try {
      validateCertifyInput([mkLine({ sov_line_no: 7, this_period: -1 })]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PayAppLineValidationError);
      expect((e as PayAppLineValidationError).failures[0].sov_line_no).toBe(7);
      expect((e as PayAppLineValidationError).failures[0].reason).toBe("negative");
    }
  });

  it("throws with sov_line_no on overrun", () => {
    try {
      validateCertifyInput([
        mkLine({ sov_line_no: 3, scheduled_amount: 100, prev_certified: 80, this_period: 40 }),
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PayAppLineValidationError);
      expect((e as PayAppLineValidationError).failures[0].sov_line_no).toBe(3);
      expect((e as PayAppLineValidationError).failures[0].reason).toBe("overrun");
    }
  });
});

describe("reconcilePayApp", () => {
  const baseLines = [
    mkLine({ sov_line_no: 1, scheduled_amount: 1000, prev_certified: 0, this_period: 500 }),
  ];

  it("passes for signed contract with matching totals", () => {
    const r = reconcilePayApp({
      contract_status: "signed",
      contract_value: 1000,
      lines: baseLines,
      totals: { total_certified: 500 },
    });
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("blocks when contract is draft", () => {
    const r = reconcilePayApp({
      contract_status: "draft",
      contract_value: 1000,
      lines: baseLines,
      totals: { total_certified: 500 },
    });
    expect(r.ok).toBe(false);
    expect(r.failures[0].rule).toBe("contract_status");
  });

  it("lists offending sov_line_nos on line overrun", () => {
    const r = reconcilePayApp({
      contract_status: "active",
      contract_value: 10_000,
      lines: [
        mkLine({ sov_line_no: 1, scheduled_amount: 100, this_period: 200 }),
        mkLine({ sov_line_no: 2, scheduled_amount: 100, this_period: 50 }),
        mkLine({ sov_line_no: 3, scheduled_amount: 100, this_period: 500 }),
      ],
      totals: { total_certified: 750 },
    });
    const overrun = r.failures.find((f) => f.rule === "line_overrun");
    expect(overrun).toBeDefined();
    expect((overrun as { sov_line_nos: number[] }).sov_line_nos).toEqual([1, 3]);
  });

  it("blocks when contract-value ceiling is breached", () => {
    const r = reconcilePayApp({
      contract_status: "active",
      contract_value: 400,
      lines: [
        mkLine({ sov_line_no: 1, scheduled_amount: 500, prev_certified: 0, this_period: 500 }),
      ],
      totals: { total_certified: 500 },
    });
    // 500 > 400 → both line_overrun (500>500? no) and contract_value_overrun
    expect(r.failures.some((f) => f.rule === "contract_value_overrun")).toBe(true);
  });

  it("catches totals-integrity drift", () => {
    const r = reconcilePayApp({
      contract_status: "signed",
      contract_value: 10_000,
      lines: baseLines,
      totals: { total_certified: 999 },
    });
    expect(r.failures.some((f) => f.rule === "totals_integrity")).toBe(true);
  });
});

describe("nextInvoiceNumber / nextPayAppNumber / nextChangeOrderNumber", () => {
  it("starts at INV-0001 when none exist", () => {
    expect(nextInvoiceNumber([])).toBe("INV-0001");
  });
  it("advances past highest INV-####", () => {
    expect(nextInvoiceNumber(["INV-0007", "INV-0003", "INV-0021"])).toBe("INV-0022");
  });
  it("ignores unrelated strings", () => {
    expect(nextInvoiceNumber(["FOO", "INV-0004"])).toBe("INV-0005");
  });
  it("pay app numbering starts at 1", () => {
    expect(nextPayAppNumber([])).toBe(1);
    expect(nextPayAppNumber([1, 2, 5])).toBe(6);
  });
  it("change-order numbering scoped to year", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(nextChangeOrderNumber(["CO-2025-0099", "CO-2026-0002"], now)).toBe("CO-2026-0003");
    expect(nextChangeOrderNumber([], now)).toBe("CO-2026-0001");
  });
});
