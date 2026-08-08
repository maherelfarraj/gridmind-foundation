// GC-17 — real-browser verification of the risk & contingency alert register.
//
// Chromium drives the two real routes:
//   /projects/$projectId/costing/risk-contingency
//   /portfolio/costing/risk-contingency
// Everything is asserted through rendered browser controls: the lifecycle,
// deep links, cross-route navigation, reload persistence, optimistic-concurrency
// conflicts, role gating, audit history, keyboard-only operation, focus order,
// live-region announcements and Arabic RTL. Fixtures are seeded in globalSetup
// and purged in globalTeardown.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { FAMILIES, readFixture, service, type Fixture } from "./fixtures";

const fixture: Fixture = readFixture();
const PROJECT_ROUTE = `/projects/${fixture.projectId}/costing/risk-contingency`;
const PORTFOLIO_ROUTE = "/portfolio/costing/risk-contingency";

const EN = {
  acknowledge: "Acknowledge",
  escalate: "Escalate",
  snooze: "Snooze",
  unsnooze: "Unsnooze",
  resolve: "Resolve",
  reopen: "Reopen",
  readOnly: "View only",
  updated: "Alert updated",
  audit: "Audit timeline",
};
const AR = {
  acknowledge: "إقرار",
  resolve: "إغلاق",
};

/** The alert table row for one family, located by its deterministic title. */
function rowFor(page: Page, family: string): Locator {
  return page.locator("tbody tr").filter({ hasText: `GC17 ${family} ${fixture.suffix}` });
}

function auditTable(page: Page): Locator {
  return page.locator("table").filter({ has: page.locator("caption", { hasText: EN.audit }) });
}

async function gotoProject(page: Page) {
  await page.goto(PROJECT_ROUTE, { waitUntil: "domcontentloaded" });
  await expect(rowFor(page, "new_top_contributor")).toBeVisible();
}

async function gotoPortfolio(page: Page) {
  await page.goto(PORTFOLIO_ROUTE, { waitUntil: "domcontentloaded" });
  await expect(rowFor(page, "new_top_contributor")).toBeVisible();
}

/** Clicks a lifecycle control, waits for the success announcement, asserts new state. */
async function act(page: Page, family: string, label: string, expected: RegExp) {
  const row = rowFor(page, family);
  await row.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByText(EN.updated).first()).toBeVisible();
  await expect(row).toContainText(expected);
  // Retire the toast so the next action sees a fresh announcement.
  await page.getByText(EN.updated).first().waitFor({ state: "hidden", timeout: 30_000 });
}

async function alertRow(family: string) {
  const svc = service();
  const { data } = await svc
    .from("risk_contingency_alerts")
    .select("status, severity, row_version")
    .eq("id", fixture.alerts[family]!)
    .single();
  return data as { status: string; severity: string; row_version: number };
}

test.describe.configure({ mode: "serial" });

test.describe("GC-17 alert register — writer, English", () => {
  test.use({ storageState: fixture.storage.writer });

  test("project route renders all 16 families, each individually identifiable", async ({
    page,
  }) => {
    await gotoProject(page);
    for (const family of FAMILIES) {
      const row = rowFor(page, family);
      await expect(row, `family ${family} missing`).toHaveCount(1);
      await expect(row).toContainText(`GC17 ${family} ${fixture.suffix}`);
    }
    const register = page
      .locator("table")
      .filter({ has: page.getByText(`GC17 new_top_contributor ${fixture.suffix}`) });
    await expect(register.locator("thead th")).toHaveCount(7);
    await expect(register.locator("caption")).toHaveText("Alerts");
  });

  test("full lifecycle persists across reload and cross-route navigation", async ({ page }) => {
    const family = "high_exposure";
    await gotoProject(page);

    await act(page, family, EN.acknowledge, /Acknowledged/i);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rowFor(page, family)).toContainText(/Acknowledged/i);

    await act(page, family, EN.snooze, /Snoozed/i);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rowFor(page, family)).toContainText(/Snoozed/i);

    await act(page, family, EN.unsnooze, /Open/i);

    // Cross-route: the portfolio register shows the same governed state.
    await gotoPortfolio(page);
    await expect(rowFor(page, family)).toContainText(/Open/i);
    await act(page, family, EN.acknowledge, /Acknowledged/i);

    await gotoProject(page);
    await expect(rowFor(page, family)).toContainText(/Acknowledged/i);

    await act(page, family, EN.resolve, /Resolved/i);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rowFor(page, family)).toContainText(/Resolved/i);

    // Resolved rows leave the portfolio register by policy.
    await gotoPortfolio(page);
    await expect(rowFor(page, family)).toHaveCount(0);

    await gotoProject(page);
    await act(page, family, EN.reopen, /Open/i);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rowFor(page, family)).toContainText(/Open/i);
    expect((await alertRow(family)).status).toBe("open");
  });

  test("escalation raises severity in place and withdraws the control at critical", async ({
    page,
  }) => {
    const family = "sod_exception";
    await gotoProject(page);
    await expect(rowFor(page, family)).toContainText(/Info/);

    await act(page, family, EN.escalate, /Warning/i);
    await act(page, family, EN.escalate, /Critical/i);

    await page.reload({ waitUntil: "domcontentloaded" });
    const row = rowFor(page, family);
    await expect(row).toContainText(/Critical/i);
    await expect(row.getByRole("button", { name: EN.escalate, exact: true })).toHaveCount(0);
    expect((await alertRow(family)).severity).toBe("critical");
  });

  test("audit timeline grows with every governed action", async ({ page }) => {
    const family = "burn_rate_spike";
    await gotoProject(page);
    const before = await auditTable(page).locator("tbody tr").count();

    await act(page, family, EN.acknowledge, /Acknowledged/i);
    await page.reload({ waitUntil: "domcontentloaded" });

    const rows = auditTable(page).locator("tbody tr");
    await expect(rows).toHaveCount(before + 1);
    await expect(rows.first()).toContainText("alert");
    await expect(rows.first()).toContainText("acknowledged");
  });

  test("an optimistic-concurrency conflict is announced accessibly", async ({ page, context }) => {
    const family = "funding_mismatch";
    await gotoProject(page);

    // A second browser session moves the alert after this page loaded it.
    const other = await context.newPage();
    await other.goto(PROJECT_ROUTE, { waitUntil: "domcontentloaded" });
    await rowFor(other, family).getByRole("button", { name: EN.acknowledge, exact: true }).click();
    await expect(other.getByText(EN.updated).first()).toBeVisible();
    await other.close();

    // The stale page still offers Acknowledge; using it must fail loudly.
    await rowFor(page, family).getByRole("button", { name: EN.acknowledge, exact: true }).click();
    const conflict = page.getByText(/changed since you loaded it/i).first();
    await expect(conflict).toBeVisible();
    // The message sits in a live region, so assistive tech hears it.
    const live = page
      .locator("[aria-live], [role='status'], [role='alert']")
      .filter({ hasText: /changed since you loaded it/i });
    await expect(live.first()).toBeAttached();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rowFor(page, family)).toContainText(/Acknowledged/i);
    expect((await alertRow(family)).row_version).toBe(2);
  });

  test("keyboard-only tab and activate drives the lifecycle with logical focus", async ({
    page,
  }) => {
    const family = "input_quality";
    await gotoProject(page);
    const row = rowFor(page, family);

    // Tab from the row's first action reaches the next control in the group.
    const ack = row.getByRole("button", { name: EN.acknowledge, exact: true });
    await ack.focus();
    await expect(ack).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row.getByRole("button", { name: EN.snooze, exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(ack).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByText(EN.updated).first()).toBeVisible();
    await expect(row).toContainText(/Acknowledged/i);

    // Focus stays inside the same row after the mutation re-renders it.
    const focusedRowText = await page.evaluate(
      () => document.activeElement?.closest("tr")?.textContent ?? "",
    );
    expect(focusedRowText).toContain(`GC17 ${family} ${fixture.suffix}`);

    // Space activates the next control without a mouse.
    const snooze = row.getByRole("button", { name: EN.snooze, exact: true });
    await snooze.focus();
    await page.keyboard.press("Space");
    await expect(row).toContainText(/Snoozed/i);
  });

  test("portfolio evidence deep link navigates to the project cockpit", async ({ page }) => {
    const family = "double_count";
    await gotoPortfolio(page);
    const link = rowFor(page, family).getByRole("link", { name: /Open evidence/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", PROJECT_ROUTE);
    await link.click();
    await page.waitForURL(`**${PROJECT_ROUTE}`);
    await expect(rowFor(page, family)).toBeVisible();
    await expect(page.getByRole("heading", { name: EN.audit })).toBeVisible();
  });

  test("portfolio route can drive the lifecycle and the project route agrees", async ({ page }) => {
    const family = "reserve_expiry";
    await gotoPortfolio(page);
    await act(page, family, EN.acknowledge, /Acknowledged/i);
    await gotoProject(page);
    await expect(rowFor(page, family)).toContainText(/Acknowledged/i);
    expect((await alertRow(family)).status).toBe("acknowledged");
  });
});

test.describe("GC-17 alert register — unauthorized member", () => {
  test.use({ storageState: fixture.storage.reader });

  test("sees the register read-only on both routes with no lifecycle controls", async ({
    page,
  }) => {
    const family = "overdue_mitigation";
    for (const route of [PROJECT_ROUTE, PORTFOLIO_ROUTE]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const row = rowFor(page, family);
      await expect(row).toBeVisible();
      await expect(row).toContainText(EN.readOnly);
      for (const label of [EN.acknowledge, EN.snooze, EN.escalate, EN.resolve, EN.reopen]) {
        await expect(row.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      }
    }
    expect((await alertRow(family)).status).toBe("open");
  });
});

test.describe("GC-17 alert register — Arabic RTL", () => {
  test.use({ storageState: fixture.storage.writerAr });

  test("renders right-to-left with translated controls and persists a transition", async ({
    page,
  }) => {
    const family = "stale_simulation";
    await page.goto(PROJECT_ROUTE, { waitUntil: "domcontentloaded" });
    const row = rowFor(page, family);
    await expect(row).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    // Direction is honoured by the computed layout, not only the attribute.
    expect(await row.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");

    const ack = row.getByRole("button", { name: AR.acknowledge, exact: true });
    await expect(ack).toBeVisible();
    await ack.click();
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await alertRow(family)).status).toBe("acknowledged");

    // Arabic labels render; no raw i18n keys leak into the register.
    const text = (await page.locator("body").textContent()) ?? "";
    expect(text).not.toContain("financeMod.costing.riskContingency.");
    expect(text).toContain(AR.resolve);
  });
});
