// P-244 — locale isolation + export language sanity.
import { readFileSync } from "node:fs";

import { globSync } from "tinyglobby";
import { beforeEach, describe, expect, it } from "vitest";

import { LOCALE_STORAGE_KEY } from "@/lib/i18n";
import {
  cachedLocaleFor,
  clearCachedLocale,
  writeCachedLocale,
} from "@/lib/i18n/locale-storage";

describe("locale persistence isolation", () => {
  beforeEach(() => window.localStorage.clear());

  it("only reuses a cached locale for the user who set it", () => {
    writeCachedLocale("finance-lead", "ar");
    expect(cachedLocaleFor("finance-lead")).toBe("ar");
    // Admin signing in on the same shared machine must not inherit Arabic.
    expect(cachedLocaleFor("company-admin")).toBeNull();
    expect(cachedLocaleFor(null)).toBeNull();
  });

  it("forgets the cache on sign-out", () => {
    writeCachedLocale("vendor-user", "ar");
    clearCachedLocale();
    expect(cachedLocaleFor("vendor-user")).toBeNull();
  });

  it("discards legacy unscoped values", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "ar");
    expect(cachedLocaleFor("anyone")).toBeNull();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it("keeps three concurrent sessions independent", () => {
    const sessions = { finance: "ar", vendor: "ar", admin: "en" } as const;
    for (const [uid, loc] of Object.entries(sessions)) writeCachedLocale(uid, loc);
    // Last writer owns the shared slot; every other user falls back to profile.
    expect(cachedLocaleFor("admin")).toBe("en");
    expect(cachedLocaleFor("finance")).toBeNull();
  });
});

describe("export language sanity", () => {
  // Decision: PDF/CSV exports are business documents for NEPCO, lenders and
  // auditors — they stay English regardless of the UI locale.
  it("keeps i18n out of export generators", () => {
    const files = globSync(
      ["src/lib/**/*csv*.ts", "src/lib/**/*pdf*.ts", "src/lib/**/*report*.ts", "src/lib/gl.*.ts"],
      { cwd: process.cwd() },
    );
    expect(files.length).toBeGreaterThan(4);
    const leaks = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from ["']@\/lib\/i18n/.test(src) || /useI18n|useTranslation/.test(src);
    });
    expect(leaks, `export modules must not import UI translations: ${leaks.join(", ")}`).toEqual([]);
  });

  it("has no Arabic characters in export sources", () => {
    const files = globSync(["src/lib/**/*csv*.ts", "src/lib/**/*pdf*.ts", "src/lib/gl.*.ts"], {
      cwd: process.cwd(),
    });
    const arabic = files.filter((f) => /[\u0600-\u06FF]/.test(readFileSync(f, "utf8")));
    expect(arabic).toEqual([]);
  });
});
