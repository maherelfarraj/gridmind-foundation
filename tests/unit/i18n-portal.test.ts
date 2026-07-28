// P-242 A3 — Arabic pass for the vendor portal module: catalog parity and
// typed error keys for the vendor portal surfaces.
import { describe, expect, it } from "vitest";

import { createI18n, resources } from "@/lib/i18n";
import { ERROR_KEY_MAP, translateError, UNKNOWN_ERROR_KEY } from "@/lib/i18n/error-keys";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const base = (keys: string[]) =>
  [...new Set(keys.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();

describe("portalMod catalog parity", () => {
  it("en and ar key trees are identical", () => {
    const en = resources.en.translation.portalMod as Record<string, unknown>;
    const ar = resources.ar.translation.portalMod as Record<string, unknown>;
    expect(en).toBeTruthy();
    expect(ar).toBeTruthy();
    expect(base(flatten(ar))).toEqual(base(flatten(en)));
  });

  it("contains the required Arabic vendor-portal phrases", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    expect(i18n.t("portalMod.po.acknowledge")).toBe("تأكيد الاستلام");
    expect(i18n.t("portalMod.po.proposeDelivery")).toBe("اقتراح موعد التسليم");
    expect(i18n.t("portalMod.propose.pendingBuyerConfirmation")).toBe(
      "مقترح — بانتظار تأكيد المشتريات",
    );
    expect(i18n.t("portalMod.dashboard.kpiPendingAck")).toBe("بانتظار تأكيد الاستلام");
    expect(i18n.t("portalMod.dashboard.kpiNextRequiredBy")).toBe("مطلوب التسليم قبل");
  });
});

describe("typed error keys (vendor portal)", () => {
  it("maps vendor_portal_access_denied to the portal catalog", () => {
    expect(ERROR_KEY_MAP.vendor_portal_access_denied).toBe(
      "portalMod.errors.vendor_portal_access_denied",
    );
  });

  it("renders the localized Arabic access-denied message", async () => {
    const ar = createI18n("ar");
    await ar.changeLanguage("ar");
    const msg = translateError((k) => ar.t(k), "vendor_portal_access_denied");
    expect(msg).toBe("انتهت صلاحية الوصول أو تم إلغاؤه");
  });

  it("falls back to English for an unmapped code", async () => {
    const en = createI18n("en");
    expect(translateError((k) => en.t(k), "weird_portal_code", "Raw server text")).toBe(
      "Raw server text",
    );
    expect(translateError((k) => en.t(k), "weird_portal_code")).toBe(en.t(UNKNOWN_ERROR_KEY));
  });
});
