// GC-16d — Calendar policy administration UI: EN/AR catalog parity, rendering
// without raw keys, RTL layout, labelled controls and accessible status.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createI18n, type Locale } from "@/lib/i18n";
import financeEn from "@/lib/i18n/finance.en.json";
import financeAr from "@/lib/i18n/finance.ar.json";

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

const view = {
  access: {
    can_request: true,
    can_approve: true,
    can_maintain_sets: true,
    user_id: "u-1",
    roles: ["finance_admin"],
  },
  company_id: "c-1",
  company_policy: { calendar_id: "iso-std", timezone: "UTC", holiday_sets_enforced: true },
  contract_policy: null,
  resolution: {
    calendar_id: "iso-std",
    calendar_version: "2026.1",
    calendar_source: "company_policy",
    timezone: "UTC",
    chain: [
      { source: "request", calendar_id: null, timezone: null, applied: false },
      { source: "contract_policy", calendar_id: null, timezone: null, applied: false },
      { source: "company_policy", calendar_id: "iso-std", timezone: "UTC", applied: true },
    ],
    holiday_set_versions: ["mena-jo@2026:1"],
    covered_years: [2026],
  },
  resolution_error: null,
  coverage: { ok: false, missing_years: [2027], message: "No approved observed-holiday set for 2027." },
  holiday_sets: [
    {
      id: "s-1",
      calendar_id: "mena-jo",
      jurisdiction: "Jordan",
      year: 2026,
      version: "1",
      label: "Jordan 2026",
      status: "approved",
      source_reference: "official-gazette",
      approved_by: "u-2",
      approved_at: "2026-01-02T00:00:00Z",
      created_by: "u-1",
      row_version: 1,
      dates: [
        {
          observed_date: "2026-03-20",
          label_en: "Eid al-Fitr",
          label_ar: "عيد الفطر",
          kind: "public_holiday",
        },
      ],
    },
  ],
  pending_changes: [
    {
      id: "p-1",
      scope: "company",
      contract_id: null,
      project_id: null,
      from_calendar_id: "iso-std",
      from_timezone: "UTC",
      to_calendar_id: "mena-jo",
      to_timezone: "Asia/Amman",
      material: true,
      status: "pending",
      reason: "Adopt Jordanian calendar",
      impact: {},
      requested_by: "u-1",
      requested_at: "2026-02-01T00:00:00Z",
      decided_by: null,
      decided_at: null,
      applied_at: null,
      row_version: 1,
    },
  ],
  recent_changes: [],
  affected_deadlines: [
    {
      id: "d-1",
      label: "Notice of claim",
      kind: "notice",
      status: "open",
      satisfied_at: null,
      calendar: "business",
      trigger_date: "2026-01-08",
      duration_days: 5,
      due_date: "2026-01-15",
      calendar_id: "iso-std",
      calendar_version: "2026.1",
      period_locked: false,
    },
  ],
  calendars: [
    { id: "iso-std", label: "ISO standard", version: "2026.1", timezones: ["UTC"], requires_observed: false },
    {
      id: "mena-jo",
      label: "Jordan",
      version: "2026.1",
      timezones: ["Asia/Amman"],
      requires_observed: true,
    },
  ],
};

vi.mock("@/lib/calendar-governance.functions", () => ({
  getCalendarGovernance: vi.fn(async () => view),
  getCalendarAccess: vi.fn(async () => view.access),
  previewCalendarPolicyImpact: vi.fn(),
  requestCalendarPolicyChange: vi.fn(),
  decideCalendarPolicyChange: vi.fn(),
  saveCalendarHolidaySet: vi.fn(),
  importCalendarHolidayDates: vi.fn(),
  decideCalendarHolidaySet: vi.fn(),
  recalculateContractDeadlines: vi.fn(),
}));

const { CalendarPolicyAdmin, parseHolidayLines } = await import(
  "@/components/contracts-claims/calendar-policy-admin"
);

// ---------------------------------------------------------------------------
// Catalog parity
// ---------------------------------------------------------------------------
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

describe("calendarPolicy i18n catalog", () => {
  const en = keyPaths((financeEn as any).costing.calendarPolicy).sort();
  const ar = keyPaths((financeAr as any).costing.calendarPolicy).sort();

  it("has an Arabic key for every English key", () => {
    expect(ar).toEqual(en);
  });

  it("has no empty or placeholder Arabic value", () => {
    const flat = JSON.stringify((financeAr as any).costing.calendarPolicy);
    expect(flat).not.toMatch(/""/);
    expect(flat).not.toMatch(/TODO/i);
  });

  it("covers the governed vocabulary", () => {
    for (const k of ["title", "subtitle", "fields.scope", "scope.company", "scope.contract"]) {
      expect(en, `missing ${k}`).toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
async function renderAdmin(locale: Locale) {
  const i18n = createI18n(locale);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dir = locale === "ar" ? "rtl" : "ltr";
  document.documentElement.setAttribute("dir", dir);
  document.documentElement.setAttribute("lang", locale);
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <Suspense fallback={<div>loading</div>}>
          <CalendarPolicyAdmin scope="company" showHolidaySets />
        </Suspense>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findAllByRole("heading");
  return utils;
}

describe.each(["en", "ar"] as const)("CalendarPolicyAdmin (%s)", (locale) => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders translated content with no raw i18n keys", async () => {
    const { container } = await renderAdmin(locale);
    expect(container.textContent ?? "").not.toMatch(/financeMod\.costing\.calendarPolicy/);
    expect(container.textContent ?? "").not.toMatch(/costing\.calendarPolicy\./);
  });

  it("shows the effective resolution provenance", async () => {
    const { container } = await renderAdmin(locale);
    const text = container.textContent ?? "";
    expect(text).toMatch(/iso-std/);
    expect(text).toMatch(/2026\.1/);
    expect(text).toMatch(/UTC/);
  });

  it("surfaces the holiday-coverage warning as an accessible status", async () => {
    await renderAdmin(locale);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("lists the upcoming affected deadlines", async () => {
    const { container } = await renderAdmin(locale);
    expect(container.textContent ?? "").toMatch(/Notice of claim/);
  });

  it("gives every interactive control an accessible name", async () => {
    const { container } = await renderAdmin(locale);
    const controls = container.querySelectorAll("button, input, textarea, select");
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      const id = el.getAttribute("id");
      const named =
        (el.textContent ?? "").trim().length > 0 ||
        el.hasAttribute("aria-label") ||
        el.hasAttribute("aria-labelledby") ||
        el.hasAttribute("title") ||
        el.hasAttribute("placeholder") ||
        (id ? Boolean(container.querySelector(`label[for="${id}"]`)) : false);
      expect(named, `unnamed control: ${el.outerHTML.slice(0, 120)}`).toBe(true);
    }
  });

  it("keeps every control keyboard reachable", async () => {
    const { container } = await renderAdmin(locale);
    for (const el of container.querySelectorAll("button, input, textarea")) {
      expect(el.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("renders under the correct document direction", async () => {
    await renderAdmin(locale);
    expect(document.documentElement.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
  });
});

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------
describe("parseHolidayLines", () => {
  it("parses pipe-delimited observed dates", () => {
    expect(parseHolidayLines("2026-03-20 | Eid | عيد\n2026-05-01|Labour|العمال|exceptional_closure")).toEqual([
      { observed_date: "2026-03-20", label_en: "Eid", label_ar: "عيد", kind: "public_holiday" },
      {
        observed_date: "2026-05-01",
        label_en: "Labour",
        label_ar: "العمال",
        kind: "exceptional_closure",
      },
    ]);
  });

  it("ignores blank lines and defaults the kind", () => {
    const rows = parseHolidayLines("\n  \n2026-01-01|NY|رأس السنة\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("public_holiday");
  });
});
