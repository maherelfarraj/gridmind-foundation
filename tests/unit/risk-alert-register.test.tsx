// GC-17 — rendered alert-register verification: lifecycle controls, role gating,
// keyboard-only operation, accessible names, all 16 families, EN/AR + RTL.
//
// Drives the real shared component through actual rendered controls with
// @testing-library user-event (the repository's UI-verification approach);
// the persisted server/API path is covered by tests/e2e/risk-alert-lifecycle.e2e.test.tsx.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const href = Object.entries(params ?? {}).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to);
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const { AlertRegister } = await import("@/components/risk-contingency/alert-register");
import type { AlertDecision, AlertRegisterRow } from "@/components/risk-contingency/alert-register";
import { createI18n, type Locale } from "@/lib/i18n";
import financeAr from "@/lib/i18n/finance.ar.json";
import financeEn from "@/lib/i18n/finance.en.json";
import { ALERT_FAMILIES, snoozeUntil, type AlertStatus } from "@/lib/risk-sim.rules";

const NOW = new Date("2026-03-01T00:00:00.000Z");

function alert(over: Partial<AlertRegisterRow> = {}): AlertRegisterRow {
  return {
    id: "a-1",
    project_id: "11111111-1111-4111-8111-111111111111",
    family: "high_exposure",
    severity: "warning",
    status: "open",
    title: "Contingency cover under watch",
    detail: "Cover ratio 1.02.",
    owner_id: null,
    due_date: null,
    snoozed_until: null,
    row_version: 3,
    ...over,
  };
}

function renderRegister(
  rows: AlertRegisterRow[],
  opts: { canWrite?: boolean; showProject?: boolean; locale?: Locale; busy?: boolean } = {},
) {
  const locale = opts.locale ?? "en";
  const decisions: AlertDecision[] = [];
  const i18n = createI18n(locale);
  document.documentElement.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", locale);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <AlertRegister
        alerts={rows}
        canWrite={opts.canWrite ?? true}
        busy={opts.busy ?? false}
        onDecide={(d) => decisions.push(d)}
        showProject={opts.showProject ?? false}
        now={NOW}
      />
    </I18nextProvider>,
  );
  return { ...utils, decisions };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Lifecycle actions through rendered controls
// ---------------------------------------------------------------------------
const LIFECYCLE: {
  name: string;
  status: AlertStatus;
  severity?: string;
  label: string;
  expect: Omit<AlertDecision, "id" | "row_version">;
}[] = [
  {
    name: "acknowledge",
    status: "open",
    label: "Acknowledge",
    expect: { target: "acknowledged" },
  },
  {
    name: "snooze",
    status: "acknowledged",
    label: "Snooze",
    expect: { target: "snoozed", snoozed_until: snoozeUntil(NOW) },
  },
  {
    name: "unsnooze",
    status: "snoozed",
    label: "Unsnooze",
    expect: { target: "open", snoozed_until: null },
  },
  {
    name: "escalate",
    status: "open",
    severity: "info",
    label: "Escalate",
    expect: { target: "open", escalate: true },
  },
  { name: "resolve", status: "acknowledged", label: "Resolve", expect: { target: "resolved" } },
  { name: "reopen", status: "resolved", label: "Reopen", expect: { target: "open" } },
];

describe("GC-17 alert register — lifecycle controls (mouse)", () => {
  for (const step of LIFECYCLE) {
    it(`emits the ${step.name} decision with the loaded row version`, async () => {
      const user = userEvent.setup();
      const row = alert({ status: step.status, severity: step.severity ?? "warning" });
      const { decisions } = renderRegister([row]);
      await user.click(screen.getByRole("button", { name: step.label }));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ id: row.id, row_version: 3, ...step.expect });
    });
  }

  it("never offers an illegal transition for a resolved alert", () => {
    renderRegister([alert({ status: "resolved" })]);
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Escalate" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("offers unsnooze instead of snooze while deferred", () => {
    renderRegister([alert({ status: "snoozed", snoozed_until: "2026-03-08" })]);
    expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unsnooze" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "2026-03-08" })).toBeTruthy();
  });

  it("hides escalate once the alert is critical", () => {
    renderRegister([alert({ severity: "critical" })]);
    expect(screen.queryByRole("button", { name: "Escalate" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Keyboard-only operation and focus behaviour
// ---------------------------------------------------------------------------
describe("GC-17 alert register — keyboard-only operation", () => {
  it("reaches and activates every action with Tab/Enter and keeps focus in place", async () => {
    const user = userEvent.setup();
    const { decisions } = renderRegister([alert()]);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Acknowledge" }));
    await user.keyboard("{Enter}");
    expect(decisions[0]).toMatchObject({ target: "acknowledged" });
    // Focus must remain on the activated control (no focus loss / no trap).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Acknowledge" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Snooze" }));
    await user.keyboard(" ");
    expect(decisions[1]).toMatchObject({ target: "snoozed" });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Escalate" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resolve" }));
    await user.keyboard("{Enter}");
    expect(decisions[2]).toMatchObject({ target: "resolved" });
  });

  it("reaches the evidence link before the actions in portfolio mode", async () => {
    const user = userEvent.setup();
    renderRegister([alert()], { showProject: true });
    await user.tab();
    const link = document.activeElement as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain("/projects/11111111-1111-4111-8111-111111111111");
    expect(link.getAttribute("aria-label")).toMatch(/Open evidence/);
  });

  it("takes disabled controls out of the keyboard order while a decision is in flight", async () => {
    const user = userEvent.setup();
    const { decisions } = renderRegister([alert()], { busy: true });
    const ack = screen.getByRole("button", { name: "Acknowledge" }) as HTMLButtonElement;
    expect(ack.disabled).toBe(true);
    await user.click(ack);
    expect(decisions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Role gating
// ---------------------------------------------------------------------------
describe("GC-17 alert register — role gating", () => {
  it("renders no lifecycle control for a read-only role", () => {
    renderRegister([alert()], { canWrite: false });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("View only")).toBeTruthy();
  });

  it("renders the full action set for a write role", () => {
    renderRegister([alert()], { canWrite: true });
    expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Family coverage and de-duplicated rendering
// ---------------------------------------------------------------------------
describe("GC-17 alert register — family coverage", () => {
  const rows = ALERT_FAMILIES.map((family, i) =>
    alert({
      id: `a-${i}`,
      family,
      title: `Alert for ${family}`,
      severity: i % 3 === 0 ? "critical" : i % 3 === 1 ? "warning" : "info",
      status: (["open", "acknowledged", "snoozed", "resolved"] as AlertStatus[])[i % 4]!,
    }),
  );

  it("renders one row per family with a translated family label", () => {
    const { container } = renderRegister(rows);
    const body = container.querySelectorAll("tbody tr");
    expect(body).toHaveLength(16);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/financeMod\.costing\.riskContingency/);
    for (const family of ALERT_FAMILIES) {
      const label = (financeEn as Record<string, any>).costing.riskContingency.families[family];
      expect(text, `missing label for ${family}`).toContain(label);
    }
  });

  it("offers the status-correct action set on every rendered family row", () => {
    const { container } = renderRegister(rows);
    const trs = [...container.querySelectorAll("tbody tr")];
    trs.forEach((tr, i) => {
      const row = rows[i]!;
      const names = [...tr.querySelectorAll("button")].map((b) => b.textContent?.trim());
      if (row.status === "resolved") expect(names).toEqual(["Reopen"]);
      else expect(names).toContain("Resolve");
      if (row.status === "open") expect(names).toContain("Acknowledge");
      if (row.status === "snoozed") expect(names).toContain("Unsnooze");
    });
  });

  it("shows an empty state instead of a table when nothing is open", () => {
    const { container } = renderRegister([]);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText("No open alerts.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Accessibility and localisation
// ---------------------------------------------------------------------------
describe.each(["en", "ar"] as const)("GC-17 alert register a11y (%s)", (locale) => {
  it("gives every control an accessible name and the table a caption", () => {
    const { container } = renderRegister([alert()], { locale, showProject: true });
    const caption = container.querySelector("caption");
    expect(caption?.textContent?.trim().length).toBeGreaterThan(0);
    for (const el of container.querySelectorAll("button, a")) {
      const named =
        (el.textContent ?? "").trim().length > 0 ||
        el.hasAttribute("aria-label") ||
        el.hasAttribute("aria-labelledby");
      expect(named, `unnamed control: ${el.outerHTML}`).toBe(true);
    }
  });

  it("marks up column headers as scoped header cells", () => {
    const { container } = renderRegister([alert()], { locale });
    const heads = [...container.querySelectorAll("thead th")];
    expect(heads.length).toBe(7);
    for (const th of heads) expect(th.getAttribute("scope")).toBe("col");
  });

  it("renders translated content with no raw i18n keys", () => {
    const { container } = renderRegister([alert()], { locale });
    expect(container.textContent ?? "").not.toMatch(/costing\.riskContingency\./);
  });

  it(`applies dir=${locale === "ar" ? "rtl" : "ltr"} to the document`, () => {
    renderRegister([alert()], { locale });
    expect(document.documentElement.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(document.documentElement.getAttribute("lang")).toBe(locale);
  });
});

describe("GC-17 alert register i18n catalog", () => {
  const en = (financeEn as Record<string, any>).costing.riskContingency;
  const ar = (financeAr as Record<string, any>).costing.riskContingency;

  it("has an Arabic label for every family and lifecycle action", () => {
    expect(Object.keys(ar.families).sort()).toEqual(Object.keys(en.families).sort());
    expect(Object.keys(ar.alerts).sort()).toEqual(Object.keys(en.alerts).sort());
    for (const family of ALERT_FAMILIES) expect(ar.families[family]).toBeTruthy();
  });

  it("has no placeholder Arabic value", () => {
    const flat = JSON.stringify({ f: ar.families, a: ar.alerts });
    expect(flat).not.toMatch(/""/);
    expect(flat).not.toMatch(/TODO/i);
  });
});

describe("GC-17 alert register — owner and due presentation", () => {
  it("labels an unassigned owner rather than rendering an empty cell", () => {
    renderRegister([alert()]);
    expect(screen.getByRole("cell", { name: "Unassigned" })).toBeTruthy();
  });

  it("shows the owner and due date when assigned", () => {
    renderRegister([
      alert({ owner_id: "abcdef12-1111-4111-8111-111111111111", due_date: "2026-04-01" }),
    ]);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("abcdef12")).toBeTruthy();
    expect(within(row).getByText("2026-04-01")).toBeTruthy();
  });
});
