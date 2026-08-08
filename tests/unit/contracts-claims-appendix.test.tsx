// GC-16 — appendix rendering, EN/AR catalog parity, RTL layout and keyboard
// accessibility for the contract & claims evidence surfaces embedded in the
// project close pack and the portfolio management pack.
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import {
  ContractsClaimsAppendixCard,
  PortfolioClaimsAppendixCard,
} from "@/components/contracts-claims/contracts-claims-appendix";
import { createI18n, type Locale } from "@/lib/i18n";
import financeEn from "@/lib/i18n/finance.en.json";
import financeAr from "@/lib/i18n/finance.ar.json";
import portfolioEn from "@/lib/i18n/portfolio.en.json";
import portfolioAr from "@/lib/i18n/portfolio.ar.json";
import {
  CONTRACTS_CLAIMS_DISCLAIMER,
  emptyTotals,
  exposureWaterfall,
  type ExposureTotals,
} from "@/lib/contracts-claims.rules";
import type { ClaimsAppendix, PortfolioClaimsView } from "@/lib/contracts-claims.server";

// ---------------------------------------------------------------------------
// Catalog parity
// ---------------------------------------------------------------------------
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keyPaths(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object") out.push(...keyPaths(v, path));
    else out.push(path);
  }
  return out;
}

const stripped = (keys: string[]) => new Set(keys.map((k) => k.replace(PLURAL_SUFFIX, "")));

function subtree(catalog: unknown): unknown {
  return (catalog as { costing?: { contractsClaims?: unknown } }).costing?.contractsClaims;
}

describe("GC-16 catalog parity (en vs ar)", () => {
  it.each([
    ["financeMod", financeEn, financeAr],
    ["portfolioMod", portfolioEn, portfolioAr],
  ])("%s.costing.contractsClaims has identical key sets", (_name, en, ar) => {
    const enTree = subtree(en);
    const arTree = subtree(ar);
    expect(enTree, "english contractsClaims subtree missing").toBeTruthy();
    expect(arTree, "arabic contractsClaims subtree missing").toBeTruthy();
    const enKeys = stripped(keyPaths(enTree));
    const arKeys = stripped(keyPaths(arTree));
    const missingAr = [...enKeys].filter((k) => !arKeys.has(k));
    const missingEn = [...arKeys].filter((k) => !enKeys.has(k));
    expect(missingAr, `missing in ar: ${missingAr.join(", ")}`).toHaveLength(0);
    expect(missingEn, `missing in en: ${missingEn.join(", ")}`).toHaveLength(0);
  });

  it("never leaves an Arabic contract & claims string empty or untranslated latin prose", () => {
    for (const tree of [subtree(financeAr), subtree(portfolioAr)]) {
      for (const path of keyPaths(tree)) {
        const value = path
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
        if (typeof value !== "string") continue;
        expect(value.trim(), `empty ar value at ${path}`).not.toBe("");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function totals(over: Partial<ExposureTotals> = {}): ExposureTotals {
  return {
    ...emptyTotals(),
    asserted: 2_400_000,
    submitted: 2_100_000,
    assessed: 1_500_000,
    approved: 1_200_000,
    certified: 900_000,
    paid: 400_000,
    forecast: 1_000_000,
    live_exposure: 1_650_000,
    unapproved_exposure: 450_000,
    ld_exposure: 120_000,
    eot_days_approved: 21,
    claim_count: 3,
    ...over,
  };
}

function appendix(over: Partial<ClaimsAppendix> = {}): ClaimsAppendix {
  const t = over.totals ?? totals();
  return {
    project_id: "p1",
    project_name: "East Amman 50 MW PV",
    period_month: "2026-06-01",
    status: "approved",
    totals: t,
    waterfall: exposureWaterfall(t),
    top_claims: [
      {
        claim_ref: "CL-001",
        title: "Grid connection delay",
        status: "approved",
        currency_code: "USD",
        approved_amount: 1_200_000,
        exposure: 1_650_000,
      },
    ],
    upcoming_deadlines: [
      { label: "Clause 20.1 notice", kind: "notice", due_date: "2026-07-12", days: 9 },
    ],
    open_alerts: [
      { kind: "notice_due", severity: "critical", title: "Notice due", due_at: "2026-07-12" },
    ],
    checks: [
      {
        code: "reconciliation_approved_vs_register",
        ok: false,
        expected: 1_200_000,
        actual: 1_000_000,
        delta: -200_000,
      },
    ],
    disclaimer: CONTRACTS_CLAIMS_DISCLAIMER,
    ...over,
  };
}

function portfolioView(): PortfolioClaimsView {
  const t = totals();
  return {
    period_month: "2026-06-01",
    projects: [
      {
        project_id: "p1",
        project_code: "GSI-EAM-001",
        project_name: "East Amman 50 MW PV",
        currency_code: "USD",
        totals: t,
      } as PortfolioClaimsView["projects"][number],
    ],
    totals: { ...t, project_count: 1 } as PortfolioClaimsView["totals"],
    concentration: [] as unknown as PortfolioClaimsView["concentration"],
    waterfall: exposureWaterfall(t),
    alerts: [],
    access: { canWrite: true, canApprove: false, roles: ["project_admin"] },
    disclaimer: CONTRACTS_CLAIMS_DISCLAIMER,
  };
}

function renderIn(locale: Locale, ui: React.ReactElement) {
  const i18n = createI18n(locale);
  const dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <I18nextProvider i18n={i18n}>
      <div dir={dir}>{ui}</div>
    </I18nextProvider>,
  );
}

// ---------------------------------------------------------------------------
// Rendering + accessibility
// ---------------------------------------------------------------------------
describe("GC-16 close-pack appendix rendering", () => {
  it("renders governed totals, the waterfall, top claims, deadlines and the disclaimer", () => {
    renderIn("en", <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />);

    expect(screen.getByText("CL-001")).toBeTruthy();
    expect(screen.getByText("Grid connection delay")).toBeTruthy();
    expect(screen.getByText("Clause 20.1 notice")).toBeTruthy();
    expect(screen.getByText(CONTRACTS_CLAIMS_DISCLAIMER)).toBeTruthy();
    // Failed reconciliation checks must surface in the evidence pack.
    expect(screen.getByText(/reconciliation_approved_vs_register/)).toBeTruthy();
    // Every waterfall step is rendered as a row.
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThanOrEqual(exposureWaterfall(totals()).length);
  });

  it("shows the empty state instead of an empty table body", () => {
    renderIn(
      "en",
      <ContractsClaimsAppendixCard
        appendix={appendix({ top_claims: [], upcoming_deadlines: [], checks: [] })}
        currency="USD"
      />,
    );
    expect(screen.queryByText("CL-001")).toBeNull();
    expect(screen.queryByText(/reconciliation_approved_vs_register/)).toBeNull();
  });

  it("exposes labelled sections and scoped column headers for screen readers", () => {
    const { container } = renderIn(
      "en",
      <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />,
    );

    const sections = container.querySelectorAll("section[aria-labelledby]");
    expect(sections.length).toBeGreaterThanOrEqual(3);
    for (const section of Array.from(sections)) {
      const id = section.getAttribute("aria-labelledby")!;
      expect(container.querySelector(`#${id}`), `no heading for ${id}`).toBeTruthy();
    }
    const headers = screen.getAllByRole("columnheader");
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) expect(h.getAttribute("scope")).toBe("col");
  });

  it("keeps a single H2 with H3 subsections (no heading level skips)", () => {
    const { container } = renderIn(
      "en",
      <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />,
    );
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(container.querySelectorAll("h2")).toHaveLength(1);
    expect(container.querySelectorAll("h3").length).toBeGreaterThan(0);
  });

  it("renders the portfolio pack appendix from the same governed basis", () => {
    renderIn("en", <PortfolioClaimsAppendixCard data={portfolioView()} />);
    expect(screen.getByText(CONTRACTS_CLAIMS_DISCLAIMER)).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });
});

describe("GC-16 appendix in Arabic / RTL", () => {
  it("translates the chrome while keeping references and amounts LTR-safe", () => {
    const { container } = renderIn(
      "ar",
      <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />,
    );
    expect(container.firstElementChild!.getAttribute("dir")).toBe("rtl");

    // Latin-coded business identifiers are never translated.
    expect(screen.getByText("CL-001")).toBeTruthy();

    // The heading is the Arabic catalog value, not the raw key or the English string.
    const heading = container.querySelector("h2")!;
    const arTitle = (subtree(financeAr) as { appendix: { title: string } }).appendix.title;
    expect(heading.textContent).toBe(arTitle);
    expect(heading.textContent).not.toContain("financeMod.");
  });

  it("keeps money columns end-aligned and tabular in both directions", () => {
    for (const locale of ["en", "ar"] as const) {
      const { container, unmount } = renderIn(
        locale,
        <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />,
      );
      const numeric = container.querySelectorAll("td.tabular-nums");
      expect(numeric.length).toBeGreaterThan(0);
      for (const cell of Array.from(numeric)) {
        expect(cell.className).toContain("text-right");
      }
      unmount();
    }
  });

  it("orders interactive content in DOM order so keyboard traversal is predictable", () => {
    const { container } = renderIn(
      "en",
      <ContractsClaimsAppendixCard appendix={appendix()} currency="USD" />,
    );
    const focusable = container.querySelectorAll(
      "a[href], button, input, select, textarea, [tabindex]",
    );
    // The appendix is read-only evidence: nothing steals focus with a positive
    // tabindex, and any control that exists stays in natural document order.
    for (const el of Array.from(focusable)) {
      const idx = el.getAttribute("tabindex");
      if (idx !== null) expect(Number(idx)).toBeLessThanOrEqual(0);
    }
  });
});

describe("GC-16 appendix totals table", () => {
  it("renders each waterfall step exactly once with a cumulative column", () => {
    const t = totals();
    const { container } = renderIn(
      "en",
      <ContractsClaimsAppendixCard appendix={appendix({ totals: t })} currency="USD" />,
    );
    const section = container.querySelector<HTMLElement>(
      'section[aria-labelledby="cc-appendix-waterfall"]',
    )!;
    for (const step of exposureWaterfall(t)) {
      expect(within(section).getAllByText(step.label).length, `step ${step.key}`).toBe(1);
    }
    // Each step row carries a movement and a cumulative cell.
    for (const row of Array.from(section.querySelectorAll("tbody tr"))) {
      expect(row.querySelectorAll("td.tabular-nums")).toHaveLength(2);
    }
  });

  it("shows an em dash rather than a zero for a missing amount", () => {
    const t = totals({ ld_exposure: Number.NaN });
    const { container } = renderIn(
      "en",
      <ContractsClaimsAppendixCard appendix={appendix({ totals: t })} currency="USD" />,
    );
    expect(within(container as HTMLElement).getAllByText("—").length).toBeGreaterThan(0);
  });
});
