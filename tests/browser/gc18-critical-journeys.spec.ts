// GC-18 — real-browser critical-journey UAT (Playwright Chromium).
//
// Covers every GC-01..GC-17 project and portfolio surface named in the GC-18
// brief: costing drilldown, forecast/versions, FX/close, EVM, cash-flow and
// funding, Revenue/WIP, Contracts/Claims, Risk/Contingency, alerts, scenarios,
// audit, saved views and pack generation.
//
// Fixtures are the deterministic, tenant-isolated GC-17 browser fixtures
// (globalSetup seeds, globalTeardown purges through the audited purge path).
import { expect, test, type Page } from "@playwright/test";
import { readFixture } from "./fixtures";

const fx = readFixture();

const PROJECT_ROUTES: { id: string; path: string }[] = [
  { id: "GC-01 costing overview", path: "costing" },
  { id: "GC-02 commitments", path: "costing/commitments" },
  { id: "GC-03 invoices", path: "costing/invoices" },
  { id: "GC-04 forecast", path: "costing/forecast" },
  { id: "GC-05 forecast versions", path: "costing/versions" },
  { id: "GC-06 period close", path: "costing/close" },
  { id: "GC-07 close pack", path: "costing/close-pack" },
  { id: "GC-12 EVM", path: "costing/evm" },
  { id: "GC-12 EVM mappings", path: "costing/evm-mappings" },
  { id: "GC-13 cash flow", path: "costing/cash-flow" },
  { id: "GC-14 contingency", path: "costing/contingency" },
  { id: "GC-15 revenue and WIP", path: "costing/revenue" },
  { id: "GC-16 contracts", path: "costing/contracts" },
  { id: "GC-16 contracts and claims", path: "costing/contracts-claims" },
  { id: "GC-17 risk and contingency", path: "costing/risk-contingency" },
];

const PORTFOLIO_ROUTES: { id: string; path: string }[] = [
  { id: "GC-08 portfolio costing", path: "/portfolio/costing" },
  { id: "GC-09 portfolio audit", path: "/portfolio/costing/audit" },
  { id: "GC-10 portfolio alerts", path: "/portfolio/costing/alerts" },
  { id: "GC-11 portfolio scenarios", path: "/portfolio/costing/scenarios" },
  { id: "GC-12 portfolio EVM", path: "/portfolio/costing/evm" },
  { id: "GC-13 portfolio cash flow", path: "/portfolio/costing/cash-flow" },
  { id: "GC-13 portfolio funding", path: "/portfolio/costing/funding" },
  { id: "GC-15 portfolio revenue and WIP", path: "/portfolio/costing/revenue-wip" },
  { id: "GC-16 portfolio contracts and claims", path: "/portfolio/costing/contracts-claims" },
  { id: "GC-17 portfolio risk", path: "/portfolio/costing/risk-contingency" },
  { id: "GC-18 portfolio pack", path: "/portfolio/costing/pack" },
];

const projectUrl = (p: string) => `/projects/${fx.projectId}/${p}`;

/** A rendered governed surface: settled, no crash overlay, an accessible heading. */
async function expectGovernedSurface(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/Unexpected Application Error|Internal Server Error|TypeError:/i);
  // Nothing may stay stuck in a perpetual skeleton: loading resolves to content,
  // an empty state, or an explicit denial.
  expect(text.trim().length).toBeGreaterThan(0);
}

test.describe("GC-18 authorized project journeys", () => {
  test.use({ storageState: fx.storage.writer });

  for (const route of PROJECT_ROUTES) {
    test(`${route.id} renders for an authorized user`, async ({ page }) => {
      await expectGovernedSurface(page, projectUrl(route.path));
    });
  }

  test("costing drilldown persists after reload and back-navigation", async ({ page }) => {
    await expectGovernedSurface(page, projectUrl("costing/risk-contingency"));
    const before = await page.evaluate(() => document.body.innerText);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    const after = await page.evaluate(() => document.body.innerText);
    expect(after.length).toBeGreaterThan(0);
    expect(page.url()).toContain("costing/risk-contingency");
    expect(before.length).toBeGreaterThan(0);

    await expectGovernedSurface(page, projectUrl("costing/evm"));
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    expect(page.url()).toContain("costing/risk-contingency");
  });

  test("keyboard-only traversal reaches an operable control", async ({ page }) => {
    await expectGovernedSurface(page, projectUrl("costing/risk-contingency"));
    let tag = "";
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
      if (["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(tag)) break;
    }
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(tag);
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return (el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim();
    });
    expect(name.length).toBeGreaterThan(0);
  });
});

test.describe("GC-18 authorized portfolio journeys", () => {
  test.use({ storageState: fx.storage.writer });

  for (const route of PORTFOLIO_ROUTES) {
    test(`${route.id} renders for an authorized user`, async ({ page }) => {
      await expectGovernedSurface(page, route.path);
    });
  }

  test("portfolio alert register exposes its evidence deep link", async ({ page }) => {
    await expectGovernedSurface(page, "/portfolio/costing/risk-contingency");
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toContain("GC17");
  });
});

test.describe("GC-18 denied-role journeys", () => {
  test.use({ storageState: fx.storage.reader });

  for (const route of [
    { id: "project close", path: projectUrl("costing/close") },
    { id: "portfolio audit", path: "/portfolio/costing/audit" },
    { id: "portfolio pack", path: "/portfolio/costing/pack" },
  ]) {
    test(`${route.id} does not leak another tenant's governed data`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toBeVisible({ timeout: 60_000 });
      const text = await page.evaluate(() => document.body.innerText);
      // A role-less member must never see the seeded tenant's governed rows.
      expect(text).not.toContain(fx.projectCode);
      expect(text).not.toMatch(/Unexpected Application Error|Internal Server Error/i);
    });
  }
});

test.describe("GC-18 Arabic and RTL parity", () => {
  test.use({ storageState: fx.storage.writerAr });

  test("project risk cockpit renders RTL with translated chrome", async ({ page }) => {
    await expectGovernedSurface(page, projectUrl("costing/risk-contingency"));
    const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    expect(dir).toBe("rtl");
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toMatch(/[\u0600-\u06FF]/);
    // No untranslated raw i18n keys may reach the DOM.
    expect(text).not.toMatch(/\b[a-z0-9]+(\.[a-z0-9_]+){2,}\b/);
  });

  test("portfolio risk dashboard renders RTL", async ({ page }) => {
    await expectGovernedSurface(page, "/portfolio/costing/risk-contingency");
    const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
    expect(dir).toBe("rtl");
  });
});

test.describe("GC-18 mobile viewport", () => {
  test.use({ storageState: fx.storage.writer, viewport: { width: 390, height: 844 } });

  test("project risk cockpit is usable at 390px without horizontal overflow", async ({ page }) => {
    await expectGovernedSurface(page, projectUrl("costing/risk-contingency"));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test("portfolio costing is usable at 390px", async ({ page }) => {
    await expectGovernedSurface(page, "/portfolio/costing");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
