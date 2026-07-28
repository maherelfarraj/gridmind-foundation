// P-252 — Portfolio dashboard UI proofs: threshold coloring, rendering with
// fixture data, catalog parity, RTL render.
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GateRail } from "@/components/portfolio/gate-rail";
import { ProjectCard } from "@/components/portfolio/project-card";
import { createI18n, dirFor } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import portfolioAr from "@/lib/i18n/portfolio.ar.json";
import portfolioEn from "@/lib/i18n/portfolio.en.json";
import type { PortfolioProjectCard } from "@/lib/portfolio.functions";
import { PERF_GOOD, PERF_WARN, perfTone, railIndex } from "@/lib/portfolio/portfolio.rules";

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

const fixture = (over: Partial<PortfolioProjectCard> = {}): PortfolioProjectCard => ({
  project_id: "11111111-1111-4111-8111-111111111111",
  project_code: "GSI-EAM-001",
  project_name: "East Amman Hybrid PV + BESS",
  phase: "development",
  status: "active",
  target_cod: "2027-06-30",
  contract_value: 48500000,
  currency_code: "USD",
  planned_value: 100,
  earned_value: 90,
  actual_cost: 95,
  spi: 0.9,
  cpi: 0.947,
  punch_a_open: 3,
  gates_total: 4,
  gates_approved: 1,
  current_gate_name: "Site control",
  current_gate_status: "in_review",
  next_gate_name: "NTP readiness",
  next_gate_due: "2026-09-30",
  ...over,
});

const flatten = (obj: Record<string, unknown>, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

describe("portfolio threshold coloring", () => {
  it("maps >= 0.95 green, 0.85–0.95 amber, < 0.85 red", () => {
    expect(perfTone(1.05)).toBe("good");
    expect(perfTone(PERF_GOOD)).toBe("good");
    expect(perfTone(0.94)).toBe("warning");
    expect(perfTone(PERF_WARN)).toBe("warning");
    expect(perfTone(0.84)).toBe("bad");
    expect(perfTone(0)).toBe("bad");
  });

  it("stays neutral when there is no index at all", () => {
    expect(perfTone(null)).toBe("neutral");
    expect(perfTone(undefined)).toBe("neutral");
    expect(perfTone(Number.NaN)).toBe("neutral");
  });

  it("places projects on the Development→NTP→COD→Handover rail", () => {
    expect(railIndex("development")).toBe(0);
    expect(railIndex("construction")).toBe(1);
    expect(railIndex("commissioning")).toBe(2);
    expect(railIndex("handover")).toBe(3);
    expect(railIndex(null)).toBe(0);
  });
});

describe("portfolio cards render with fixture data", () => {
  it("shows code, contract value, gates and mini indices", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <ProjectCard project={fixture()} />
      </LocaleProvider>,
    );
    expect(html).toContain("GSI-EAM-001");
    expect(html).toContain("East Amman Hybrid PV + BESS");
    expect(html).toContain("48,500,000");
    expect(html).toContain("Site control");
    expect(html).toContain("NTP readiness");
    expect(html).toContain("0.9");
  });

  it("renders an em dash instead of a fake index when EVM is missing", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <ProjectCard project={fixture({ spi: null, cpi: null })} />
      </LocaleProvider>,
    );
    expect(html).toContain("—");
  });

  it("renders one rail track per project", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider>
        <GateRail
          projects={[fixture(), fixture({ project_code: "SBX-DRILL-001", phase: "ntp" })]}
        />
      </LocaleProvider>,
    );
    expect(html).toContain("Development");
    expect(html).toContain("Handover");
    expect(html.match(/aria-label="GSI-EAM-001"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="SBX-DRILL-001"');
  });
});

describe("portfolio i18n", () => {
  it("has en/ar catalog parity", () => {
    expect(flatten(portfolioAr).sort()).toEqual(flatten(portfolioEn).sort());
  });

  it("registers both catalogs under portfolioMod", () => {
    const index = read("src/lib/i18n/index.ts");
    expect(index).toContain("portfolioMod: portfolioEn,");
    expect(index).toContain("portfolioMod: portfolioAr,");
  });

  it("ships no English-only strings in the UI", () => {
    const route = read("src/routes/_authenticated/portfolio.tsx");
    expect(route).toContain('t("portfolioMod.title")');
    expect(route).not.toMatch(/title="[A-Za-z ]{4,}"/);
  });

  it("resolves the Arabic catalog and stays RTL-safe (no physical-direction classes)", () => {
    const i18n = createI18n("ar");
    expect(i18n.t("portfolioMod.title")).toBe("المحفظة");
    expect(i18n.t("portfolioMod.kpi.spi")).toBe("مؤشر أداء الجدول المرجّح");
    expect(dirFor("ar")).toBe("rtl");

    for (const rel of [
      "src/routes/_authenticated/portfolio.tsx",
      "src/components/portfolio/project-card.tsx",
      "src/components/portfolio/gate-rail.tsx",
    ]) {
      expect(read(rel)).not.toMatch(/\b(ml-|mr-|pl-|pr-|text-left|text-right)\b/);
    }
  });
});

describe("portfolio nav registration", () => {
  it("exposes /portfolio and hides it from external viewers", () => {
    const nav = read("src/lib/nav-map.ts");
    const idx = nav.indexOf('url: "/portfolio"');
    expect(idx).toBeGreaterThan(0);
    expect(nav.slice(idx, idx + 200)).toContain("hideFromExternalViewers: true");
  });
});
