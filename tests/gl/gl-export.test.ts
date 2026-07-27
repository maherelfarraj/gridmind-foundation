// P-208 — GL export engine tests: mapping resolution, two-line emission,
// balancing, memo format, CSV shape, supersede-not-delete semantics.
import { describe, expect, it } from "vitest";

import {
  GL_CSV_HEADERS,
  GL_EVENT_TYPES,
  GenerateGlExportSchema,
  UpdateGlMappingSchema,
  buildJournal,
  buildMemo,
  defaultPeriod,
  glCsvRows,
  glExportPath,
  resolveMapping,
  type GlMapping,
  type GlSourceEvent,
} from "@/lib/gl.rules";

function mapping(event: GlSourceEvent["event_type"], overrides: Partial<GlMapping> = {}): GlMapping {
  return {
    event_type: event,
    debit_account_code: "1200",
    debit_account_name: "Accounts receivable",
    credit_account_code: "4000",
    credit_account_name: "Contract revenue",
    enabled: true,
    ...overrides,
  };
}

function event(overrides: Partial<GlSourceEvent> = {}): GlSourceEvent {
  return {
    event_type: "invoice_receivable_issued",
    source_type: "invoice",
    source_id: "11111111-1111-4111-8111-111111111111",
    source_number: "INV-0042",
    counterparty: "NEPCO",
    detail: "milestone 3",
    entry_date: "2026-05-14",
    amount_base: 1000,
    currency_code: "USD",
    project_id: null,
    ...overrides,
  };
}

const FULL_MAPPINGS: GlMapping[] = GL_EVENT_TYPES.map((e) => mapping(e));

describe("mapping resolution", () => {
  it("resolves an enabled mapping per event type", () => {
    for (const e of GL_EVENT_TYPES) {
      expect(resolveMapping(FULL_MAPPINGS, e)?.event_type).toBe(e);
    }
  });

  it("treats a disabled mapping as unresolved", () => {
    const rows = [mapping("payment_received", { enabled: false })];
    expect(resolveMapping(rows, "payment_received")).toBeNull();
  });

  it("validates account codes as 4–10 alphanumeric characters", () => {
    const base = {
      event_type: "payment_made" as const,
      debit_account_code: "2100",
      debit_account_name: "Accounts payable",
      credit_account_code: "1010",
      credit_account_name: "Bank",
      enabled: true,
    };
    expect(UpdateGlMappingSchema.safeParse(base).success).toBe(true);
    expect(
      UpdateGlMappingSchema.safeParse({ ...base, debit_account_code: "210" }).success,
    ).toBe(false);
    expect(
      UpdateGlMappingSchema.safeParse({ ...base, debit_account_code: "21-00" }).success,
    ).toBe(false);
    expect(
      UpdateGlMappingSchema.safeParse({ ...base, credit_account_code: "12345678901" }).success,
    ).toBe(false);
  });
});

describe("journal emission", () => {
  it("emits exactly one debit and one credit line per source, in base currency", () => {
    const result = buildJournal([event()], FULL_MAPPINGS, "USD");
    expect(result.lines).toHaveLength(2);
    const [dr, cr] = result.lines;
    expect(dr.debit).toBe(1000);
    expect(dr.credit).toBe(0);
    expect(dr.account_code).toBe("1200");
    expect(cr.credit).toBe(1000);
    expect(cr.debit).toBe(0);
    expect(cr.account_code).toBe("4000");
    expect(dr.currency_code).toBe("USD");
    expect(cr.currency_code).toBe("USD");
    expect(dr.source_id).toBe(cr.source_id);
  });

  it("uses the mapped accounts for each distinct event type", () => {
    const mappings = [
      mapping("payment_received", {
        debit_account_code: "1010",
        debit_account_name: "Bank",
        credit_account_code: "1200",
        credit_account_name: "Accounts receivable",
      }),
    ];
    const result = buildJournal(
      [event({ event_type: "payment_received", source_type: "payment", source_number: "PAY-0007" })],
      mappings,
      "USD",
    );
    expect(result.lines.map((l) => l.account_code)).toEqual(["1010", "1200"]);
  });

  it("balances to the cent across a mixed, rounded fixture", () => {
    const events = [
      event({ amount_base: 1234.567 }),
      event({
        event_type: "retention_withheld",
        source_type: "pay_application",
        source_number: "PA-0003",
        amount_base: 89.005,
      }),
      event({
        event_type: "change_order_approved",
        source_type: "change_order",
        source_number: "CO-0011",
        amount_base: 0.014,
      }),
    ];
    const result = buildJournal(events, FULL_MAPPINGS, "USD");
    expect(result.balanced).toBe(true);
    expect(result.total_debit).toBeCloseTo(result.total_credit, 2);
    expect(Math.abs(result.total_debit - result.total_credit)).toBeLessThanOrEqual(0.01);
  });

  it("counts sources per event type for the run summary", () => {
    const result = buildJournal(
      [event(), event({ source_number: "INV-0043" }), event({ event_type: "payment_received" })],
      FULL_MAPPINGS,
      "USD",
    );
    expect(result.source_counts.invoice_receivable_issued).toBe(2);
    expect(result.source_counts.payment_received).toBe(1);
  });
});

describe("balancing failures", () => {
  it("fails and names the source when a credit mapping is missing", () => {
    const partial = FULL_MAPPINGS.filter((m) => m.event_type !== "debit_note_issued");
    const result = buildJournal(
      [
        event(),
        event({
          event_type: "debit_note_issued",
          source_type: "debit_note",
          source_number: "DN-0002",
        }),
      ],
      partial,
      "USD",
    );
    expect(result.balanced).toBe(false);
    expect(result.missing_mappings).toContain("debit_note_issued");
    expect(result.unbalanced.map((u) => u.source_number)).toContain("DN-0002");
    // The mapped source still produced its balanced pair.
    expect(result.lines).toHaveLength(2);
  });

  it("excludes disabled mappings and reports them separately", () => {
    const rows = FULL_MAPPINGS.map((m) =>
      m.event_type === "payment_made" ? { ...m, enabled: false } : m,
    );
    const result = buildJournal(
      [event({ event_type: "payment_made", source_type: "payment", source_number: "PAY-0009" })],
      rows,
      "USD",
    );
    expect(result.lines).toHaveLength(0);
    expect(result.disabled_mappings).toEqual(["payment_made"]);
    expect(result.missing_mappings).toEqual([]);
    expect(result.unbalanced[0].reason).toMatch(/disabled/i);
  });

  it("refuses zero or non-finite base amounts rather than posting them", () => {
    const result = buildJournal(
      [event({ amount_base: 0 }), event({ source_number: "INV-9999", amount_base: Number.NaN })],
      FULL_MAPPINGS,
      "USD",
    );
    expect(result.lines).toHaveLength(0);
    expect(result.balanced).toBe(false);
    expect(result.unbalanced).toHaveLength(2);
  });
});

describe("memo + csv", () => {
  it("formats the memo as number · counterparty · detail", () => {
    expect(buildMemo(event())).toBe("INV-0042 · NEPCO · milestone 3");
  });

  it("drops empty memo parts without leaving separators", () => {
    expect(buildMemo(event({ counterparty: null, detail: "" }))).toBe("INV-0042");
  });

  it("emits the agreed CSV header and one row per journal line", () => {
    const { lines } = buildJournal([event()], FULL_MAPPINGS, "USD");
    expect([...GL_CSV_HEADERS]).toEqual([
      "entry_date",
      "account_code",
      "account_name",
      "debit",
      "credit",
      "currency",
      "memo",
      "source_type",
      "source_id",
    ]);
    const rows = glCsvRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      "2026-05-14",
      "1200",
      "Accounts receivable",
      "1000.00",
      "",
      "USD",
      "INV-0042 · NEPCO · milestone 3",
      "invoice",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(rows[1][3]).toBe("");
    expect(rows[1][4]).toBe("1000.00");
  });

  it("stores CSVs under a company-UUID-first path", () => {
    const company = "22222222-2222-4222-8222-222222222222";
    expect(glExportPath(company, "GL-0007")).toBe(`${company}/gl-exports/GL-0007.csv`);
  });
});

describe("period input", () => {
  it("defaults to the previous calendar month", () => {
    expect(defaultPeriod("2026-07-27")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(defaultPeriod("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(defaultPeriod("2028-03-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("rejects an inverted range", () => {
    expect(
      GenerateGlExportSchema.safeParse({ period_from: "2026-06-30", period_to: "2026-06-01" })
        .success,
    ).toBe(false);
    expect(
      GenerateGlExportSchema.safeParse({ period_from: "2026-06-01", period_to: "2026-06-01" })
        .success,
    ).toBe(true);
  });
});
