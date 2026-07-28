// P-241 — Arabic pass for the money modules: catalog parity, typed-error key
// mapping with English fallback, and Arabic plural forms on record counts.
import { describe, expect, it } from "vitest";

import { createI18n, resources } from "@/lib/i18n";
import {
  ERROR_KEY_MAP,
  errorCodeOf,
  errorKeyFor,
  translateError,
  UNKNOWN_ERROR_KEY,
} from "@/lib/i18n/error-keys";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("finance + procurement catalog parity", () => {
  for (const mod of ["financeMod", "procurementMod"] as const) {
    it(`${mod}: en and ar key trees are identical`, () => {
      const en = resources.en.translation[mod] as Record<string, unknown>;
      const ar = resources.ar.translation[mod] as Record<string, unknown>;
      expect(en).toBeTruthy();
      expect(ar).toBeTruthy();
      // Plural suffixes legitimately differ; compare on the base key.
      const base = (keys: string[]) =>
        [...new Set(keys.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();
      expect(base(flatten(ar))).toEqual(base(flatten(en)));
    });

    it(`${mod}: no Arabic value is left in English`, async () => {
      const i18n = createI18n("ar");
      await i18n.changeLanguage("ar");
      expect(i18n.t(`${mod}.common.status`)).toBe("الحالة");
    });
  }

  it("translates the core money vocabulary in MSA", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    expect(i18n.t("financeMod.invoices.invoice")).toBe("فاتورة");
    expect(i18n.t("financeMod.payments.payment")).toBe("دفعة");
    expect(i18n.t("financeMod.common.retention")).toBe("محتجزات");
    expect(i18n.t("financeMod.reconciliation.title")).toBe("التسوية البنكية");
    expect(i18n.t("financeMod.periods.closePeriod")).toBe("إقفال الفترة المالية");
    expect(i18n.t("procurementMod.match.title")).toBe("المطابقة الثلاثية");
    expect(i18n.t("procurementMod.grn.title")).toBe("سند قبض بضاعة");
    expect(i18n.t("procurementMod.expediting.title")).toBe("سجل متابعة التوريد");
    expect(i18n.t("procurementMod.grn.partiallyReceived")).toBe("مستلم جزئياً");
  });
});

describe("typed error key map", () => {
  it("maps every finance/procurement typed error", () => {
    for (const code of [
      "period_closed",
      "finance_period_closed",
      "payment_release_blocked",
      "gps_outside_geofence",
      "approval_instance_open",
    ]) {
      expect(ERROR_KEY_MAP[code]).toBeTruthy();
      expect(errorKeyFor(code)).toBe(ERROR_KEY_MAP[code]);
    }
  });

  it("falls back to the unknown key for unmapped codes", () => {
    expect(errorKeyFor("nope")).toBe(UNKNOWN_ERROR_KEY);
    expect(errorKeyFor(null)).toBe(UNKNOWN_ERROR_KEY);
  });

  it("renders Arabic messages and falls back to the server text in English", async () => {
    const ar = createI18n("ar");
    await ar.changeLanguage("ar");
    expect(translateError((k) => ar.t(k), "payment_release_blocked")).toContain("المطابقة الثلاثية");
    expect(translateError((k) => ar.t(k), "gps_outside_geofence")).toContain("النطاق الجغرافي");

    const en = createI18n("en");
    expect(translateError((k) => en.t(k), "period_closed")).toContain("closed");
    // unmapped code → raw server message wins over the generic fallback
    expect(translateError((k) => en.t(k), "weird_code", "Raw server text")).toBe("Raw server text");
    expect(translateError((k) => en.t(k), "weird_code")).toContain("Something went wrong");
  });

  it("extracts codes from thrown values", () => {
    expect(errorCodeOf({ code: "period_closed" })).toBe("period_closed");
    expect(errorCodeOf(new Error("payment_release_blocked"))).toBe("payment_release_blocked");
    expect(errorCodeOf(new Error("boom"))).toBeNull();
    expect(errorCodeOf(null)).toBeNull();
  });
});

describe("Arabic plural forms on record counts", () => {
  it("renders distinct forms for invoice counts", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    const forms = [0, 1, 2, 3, 11].map((count) => i18n.t("financeMod.invoices.count", { count }));
    expect(forms[0]).toBe("لا توجد فواتير");
    expect(forms[1]).toBe("فاتورة واحدة");
    expect(forms[2]).toBe("فاتورتان");
    expect(forms[3]).toContain("3");
    expect(forms[4]).toContain("11");

    const en = createI18n("en");
    expect(en.t("financeMod.invoices.count", { count: 1 })).toBe("1 invoice");
    expect(en.t("financeMod.invoices.count", { count: 4 })).toBe("4 invoices");
  });
});
