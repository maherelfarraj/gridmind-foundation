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
    expect(flatten(resources.ar.translation).sort()).toEqual(
      flatten(resources.en.translation).sort(),
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
  const files = ["src/components/user-menu.tsx"];

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
