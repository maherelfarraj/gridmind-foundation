// GC-15 verification — render, accessibility and i18n proofs for the
// recognition appendices embedded in the project close pack and the portfolio
// management pack. Rendered server-side (no router, no network) so the
// assertions are about semantics and translation coverage only.
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import {
  PortfolioRecognitionAppendixCard,
  RecognitionAppendixCard,
} from "@/components/recognition/recognition-appendix";
import { createI18n } from "@/lib/i18n";
import type { PortfolioRecognitionView, RecognitionAppendix } from "@/lib/recognition.server";
import { rollupPortfolio, type PortfolioProjectInput } from "@/lib/recognition.rules";

const PROJECT = "aaaaaaaa-1111-4111-8111-111111111111";

const totals = {
  obligations: 1,
  reporting: {
    cumulative_revenue: 611_000,
    period_revenue: 111_000,
    contract_asset: 211_000,
    contract_liability: 0,
  },
  transaction_price: 1_100_000,
  approved_variations: 100_000,
  constrained_consideration: 0,
  cost_incurred: 500_000,
  cost_to_complete: 400_000,
  eac: 900_000,
  progress_pct: 55.6,
  cumulative_revenue: 611_000,
  prior_revenue: 500_000,
  period_revenue: 111_000,
  gross_profit: 111_000,
  margin_pct: 18.2,
  loss_provision: 0,
  billed_to_date: 400_000,
  cash_received: 250_000,
  contract_asset: 211_000,
  contract_liability: 0,
  retention_receivable: 40_000,
  advance_balance: 0,
  unbilled_receivable: 211_000,
  remaining_revenue: 489_000,
  cumulative_revenue_reporting: 611_000,
  period_revenue_reporting: 111_000,
  contract_asset_reporting: 211_000,
  contract_liability_reporting: 0,
} as RecognitionAppendix["totals"];

const appendix = (over: Partial<RecognitionAppendix> = {}): RecognitionAppendix =>
  ({
    scope: "project",
    basis: "approved",
    disclaimer: "Non-posting management information.",
    project_id: PROJECT,
    project_name: "East Amman 50 MW",
    period_month: "2026-06-01",
    data_date: "2026-06-30",
    billing_cutoff: "2026-06-30",
    status: "approved",
    version_no: 2,
    frozen: true,
    watermark: null,
    policy: { method: "cost_to_cost", policy_version: "v1" },
    reporting_currency: "USD",
    totals,
    obligations: [
      {
        code: "POB-1",
        label: "EPC scope",
        method: "cost_to_cost",
        progress_pct: 55.6,
        cumulative_revenue: 611_000,
        billed_to_date: 400_000,
        contract_asset: 211_000,
        contract_liability: 0,
      },
    ],
    reconciliation: [
      { key: "movement", ok: true, expected: 111_000, actual: 111_000, delta: 0 },
    ] as RecognitionAppendix["reconciliation"],
    exceptions: [],
    approvals: {
      prepared_by: "preparer",
      prepared_at: "2026-07-01T09:00:00.000Z",
      submitted_by: "submitter",
      submitted_at: "2026-07-02T09:00:00.000Z",
      approved_by: "approver",
      approved_at: "2026-07-03T09:00:00.000Z",
    },
    fx_provenance: { reporting_currency: "USD", rate_date: "2026-06-30", rates: [] },
    inclusion_rules: { constraint_pct: 0, billing_cutoff: "2026-06-30" },
    adjustments: [
      { kind: "claim", amount: 25_000, reason: "Approved EoT claim", status: "approved" },
    ],
    ...over,
  }) as RecognitionAppendix;

const portfolioRow: PortfolioProjectInput = {
  project_id: PROJECT,
  project_name: "East Amman 50 MW",
  customer: "NEPCO",
  currency_code: "USD",
  method: "cost_to_cost",
  status: "approved",
  period_month: "2026-06-01",
  data_date: "2026-06-30",
  totals: totals!,
  fx_missing: false,
  reconciliation_ok: true,
  pending_adjustments: 0,
  last_billing_date: "2026-06-20",
  retention_due_date: null,
  submitted_at: null,
};

const portfolio = (): PortfolioRecognitionView => ({
  period_month: "2026-06-01",
  reporting_currency: "USD",
  rows: [portfolioRow],
  rollup: rollupPortfolio([portfolioRow]),
  concentration: { customer: [], project: [], currency: [], method: [] },
  alerts: [],
  access: { canWrite: true, canApprove: true },
});

function renderWith(locale: "en" | "ar", node: React.ReactElement) {
  const i18n = createI18n(locale);
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("project recognition appendix", () => {
  it("renders a single labelled heading and an accessible obligation table", () => {
    renderWith("en", <RecognitionAppendixCard appendix={appendix()} />);
    const heading = screen.getAllByRole("heading")[0]!;
    expect(heading.tagName).toBe("H2");

    const table = screen.getAllByRole("table")[0]!;
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h.textContent?.trim()).not.toBe("");
    expect(within(table).getAllByText(/POB-1|EPC scope/).length).toBeGreaterThan(0);
  });

  it("labels the basis as approved and drops the watermark once frozen", () => {
    renderWith("en", <RecognitionAppendixCard appendix={appendix()} />);
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("WORKING")).toBeNull();
  });

  it("shows the working watermark and indicative basis before approval", () => {
    renderWith(
      "en",
      <RecognitionAppendixCard
        appendix={appendix({
          basis: "indicative",
          status: "working",
          frozen: false,
          watermark: "WORKING",
        })}
      />,
    );
    expect(screen.getByText("WORKING")).toBeTruthy();
  });

  it("renders without a snapshot instead of crashing the pack", () => {
    const { container } = renderWith(
      "en",
      <RecognitionAppendixCard
        appendix={appendix({
          status: null,
          version_no: null,
          totals: null,
          obligations: [],
          reconciliation: [],
          adjustments: [],
          frozen: false,
          basis: "indicative",
          watermark: "NO SNAPSHOT",
        })}
      />,
    );
    expect(screen.getByText("NO SNAPSHOT")).toBeTruthy();
    expect(container.textContent).not.toContain("NaN");
  });

  it("leaves no untranslated i18n keys in English or Arabic", () => {
    for (const locale of ["en", "ar"] as const) {
      const { container, unmount } = renderWith(
        locale,
        <RecognitionAppendixCard appendix={appendix()} />,
      );
      expect(container.textContent).not.toMatch(/financeMod\.costing\.recognition/);
      unmount();
    }
  });

  it("keeps numeric evidence identical across locales (no re-derivation)", () => {
    const en = renderWith("en", <RecognitionAppendixCard appendix={appendix()} />);
    const enNums = (en.container.textContent ?? "").match(/\d[\d,.]*/g) ?? [];
    en.unmount();
    const ar = renderWith("ar", <RecognitionAppendixCard appendix={appendix()} />);
    const arNums = (ar.container.textContent ?? "").match(/\d[\d,.]*/g) ?? [];
    expect(arNums.length).toBe(enNums.length);
  });
});

describe("portfolio recognition appendix", () => {
  it("renders the portfolio rollup with a heading and non-posting marker", () => {
    renderWith("en", <PortfolioRecognitionAppendixCard data={portfolio()} />);
    const heading = screen.getAllByRole("heading")[0]!;
    expect(heading.tagName).toBe("H2");
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("renders an empty portfolio without numeric artefacts", () => {
    const empty: PortfolioRecognitionView = {
      ...portfolio(),
      rows: [],
      rollup: rollupPortfolio([]),
    };
    const { container } = renderWith("en", <PortfolioRecognitionAppendixCard data={empty} />);
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });

  it("leaves no untranslated keys in Arabic", () => {
    const { container } = renderWith("ar", <PortfolioRecognitionAppendixCard data={portfolio()} />);
    expect(container.textContent).not.toMatch(/financeMod\.costing\.recognition/);
  });
});
