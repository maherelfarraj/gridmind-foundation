// P-239 — i18n foundation tests: dir flip, Arabic six plural forms, and a
// hardcoded-string guard over the chrome files this batch touched.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";
import { createI18n, dirFor, isLocale, LOCALES, resources } from "@/lib/i18n";

describe("locale switching", () => {
  it("flips direction with the locale", () => {
    expect(dirFor("en")).toBe("ltr");
    expect(dirFor("ar")).toBe("rtl");
  });

  it("validates locale codes", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(LOCALES).toEqual(["en", "ar"]);
  });

  it("swaps strings when the language changes", async () => {
    const i18n = createI18n("en");
    expect(i18n.t("nav.dashboard")).toBe("Dashboard");
    await i18n.changeLanguage("ar");
    expect(i18n.t("nav.dashboard")).toBe("لوحة المتابعة");
    expect(i18n.t("domain.purchaseOrder")).toBe("أمر شراء");
    expect(i18n.t("domain.bankGuarantee")).toBe("ضمان بنكي");
  });

  it("keeps both catalogs structurally identical", () => {
    const flatten = (obj: Record<string, unknown>, prefix = ""): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object"
          ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );
    // Plural suffixes legitimately differ (Arabic has six categories), so
    // parity is checked on the base key.
    const base = (keys: string[]) => [
      ...new Set(keys.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, ""))),
    ];
    expect(base(flatten(resources.ar.translation)).sort()).toEqual(
      base(flatten(resources.en.translation)).sort(),
    );
  });

});

describe("Arabic plural forms", () => {
  it("renders all six categories distinctly", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    const rendered = [0, 1, 2, 3, 11, 100].map((count) =>
      i18n.t("dashboard.projectCount", { count }),
    );
    expect(rendered[0]).toBe("لا توجد مشاريع");
    expect(rendered[1]).toBe("مشروع واحد");
    expect(rendered[2]).toBe("مشروعان");
    expect(rendered[3]).toContain("3");
    expect(rendered[4]).toContain("11");
    expect(rendered[5]).toContain("100");
    expect(new Set(rendered).size).toBe(6);
  });

  it("still renders English plurals", () => {
    const i18n = createI18n("en");
    expect(i18n.t("dashboard.openItems", { count: 1 })).toBe("One open item");
    expect(i18n.t("dashboard.openItems", { count: 5 })).toBe("5 open items");
  });
});

describe("locale-aware formatting", () => {
  it("uses Western digits in Arabic for now", () => {
    expect(formatNumber(1234.5, "ar")).toMatch(/1/);
    expect(formatNumber(1234.5, "ar")).not.toMatch(/[٠-٩]/);
    expect(formatCurrency(1000, "en", "USD")).toContain("1,000");
  });

  it("formats dates through Intl and guards bad input", () => {
    expect(formatDate("2026-09-15", "en")).toContain("2026");
    expect(formatDate("not-a-date", "ar")).toBe("—");
  });
});

describe("no raw hardcoded chrome strings", () => {
  const files = [
    "src/components/user-menu.tsx",
    "src/components/notifications-bell.tsx",
    "src/components/offline/offline-badge.tsx",
    "src/components/company-switcher.tsx",
    "src/routes/index.tsx",
    "src/routes/_authenticated/dashboard.tsx",
  ];

  it("routes user-facing chrome text through t()", () => {
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ',.!?-]{2,})\s*</g)].map((m) =>
        m[1].trim(),
      );
      expect(jsxText, `${file} has literal JSX text: ${jsxText.join(" | ")}`).toEqual([]);
    }
  });
});

// P-240 — chrome + nav + dashboard Arabic pass.
describe("P-240 nav + activity catalogs", () => {
  it("covers every nav-map label with an Arabic translation", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/nav-map.ts"), "utf8");
    const labels = [...new Set([...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]))];
    const nav = resources.ar.translation.navItems as Record<string, string>;
    const missing = labels.filter((l) => !nav[l]);
    expect(missing, `untranslated nav labels: ${missing.join(" | ")}`).toEqual([]);
    // Every Arabic nav label must actually differ from English (no lazy copies),
    // apart from deliberate brand/acronym passthroughs.
    const untouched = labels.filter((l) => nav[l] === l);
    expect(untouched).toEqual([]);
  });

  it("keeps H₂ intact in the Green H₂ translations", () => {
    const nav = resources.ar.translation.navItems as Record<string, string>;
    expect(nav["Green H₂"]).toContain("H₂");
    expect(nav["Green H₂"]).toContain("الهيدروجين الأخضر");
    expect(nav["Green H₂ projects"]).toContain("H₂");
  });

  it("translates common audit actions and falls back to English otherwise", () => {
    const i18n = createI18n("ar");
    const actions = resources.en.translation.activity.actions as Record<string, string>;
    expect(Object.keys(actions).length).toBeGreaterThanOrEqual(15);
    expect(i18n.t("activity.actions.approved")).toBe("اعتمد");
    expect(i18n.t("activity.actions.delivery_proposed")).toBe("اقترح موعد تسليم لـ");
    expect(i18n.t("activity.actions.frobnicated", { defaultValue: "Frobnicated" })).toBe(
      "Frobnicated",
    );
    expect(i18n.t("activity.entities.purchase_orders")).toBe("أمر شراء");
    expect(i18n.t("activity.entities.widgets", { defaultValue: "Widget" })).toBe("Widget");
  });

  it("localizes landing and chrome strings", () => {
    const i18n = createI18n("ar");
    expect(i18n.t("landing.headline")).toBe("نظام تشغيل مشاريع الطاقة المتجددة");
    expect(i18n.t("chrome.markAllRead")).toBe("تعليم الكل كمقروء");
    expect(i18n.t("chrome.offline")).toBe("غير متصل");
    expect(i18n.t("dashboard.punchBreakdown", { a: 1, b: 2, c: 3 })).toContain("1");
  });
});
