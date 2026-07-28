// P-242 B2 — Arabic pass for the field-mobile module: catalog parity, typed
// hold-point/geofence error keys, and Arabic plural forms on crew counts.
import { describe, expect, it } from "vitest";

import { createI18n, resources } from "@/lib/i18n";
import {
  ERROR_KEY_MAP,
  errorCodeOf,
  translateError,
  UNKNOWN_ERROR_KEY,
} from "@/lib/i18n/error-keys";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const base = (keys: string[]) =>
  [...new Set(keys.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();

describe("fieldMod catalog parity", () => {
  it("en and ar key trees are identical", () => {
    const en = resources.en.translation.fieldMod as Record<string, unknown>;
    const ar = resources.ar.translation.fieldMod as Record<string, unknown>;
    expect(en).toBeTruthy();
    expect(ar).toBeTruthy();
    expect(base(flatten(ar))).toEqual(base(flatten(en)));
  });

  it("no Arabic value is left in English", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    expect(i18n.t("fieldMod.common.save")).toBe("حفظ");
    expect(i18n.t("fieldMod.offline.queueTitle")).toBe("قائمة انتظار العمل دون اتصال");
  });
});

describe("typed error keys (hold point / geofence)", () => {
  it("maps hold_point_open and its alias to the field catalog", () => {
    expect(ERROR_KEY_MAP.hold_point_open).toBe("fieldMod.errors.hold_point_open");
    expect(ERROR_KEY_MAP.open_hold_point).toBe("fieldMod.errors.hold_point_open");
  });

  it("renders the localized Arabic hold-point message", async () => {
    const ar = createI18n("ar");
    await ar.changeLanguage("ar");
    const msg = translateError((k) => ar.t(k), "hold_point_open");
    expect(msg).toBe("نقطة توقف مفتوحة — التوقيع مطلوب قبل استمرار العمل");
    expect(translateError((k) => ar.t(k), "open_hold_point")).toBe(msg);
  });

  it("renders the localized Arabic geofence message with distance interpolation", async () => {
    const ar = createI18n("ar");
    await ar.changeLanguage("ar");
    const msg = ar.t("fieldMod.errors.gps_outside_geofence", { distance: 2.4 });
    expect(msg).toContain("2.4");
    expect(msg).toContain("خارج نطاق الموقع المعتمد");
  });

  it("falls back to English for an unmapped code", async () => {
    const en = createI18n("en");
    expect(translateError((k) => en.t(k), "weird_field_code", "Raw server text")).toBe(
      "Raw server text",
    );
    expect(translateError((k) => en.t(k), "weird_field_code")).toBe(en.t(UNKNOWN_ERROR_KEY));
  });

  it("extracts codes from thrown values", () => {
    expect(errorCodeOf({ code: "hold_point_open" })).toBe("hold_point_open");
    expect(errorCodeOf(new Error("hold_point_open"))).toBe("hold_point_open");
    expect(errorCodeOf(new Error("boom"))).toBeNull();
  });
});

describe("Arabic plural forms on crew counts", () => {
  it("renders distinct forms for crewCount", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    const forms = [0, 1, 2, 3, 11, 100].map((count) =>
      i18n.t("fieldMod.dpr.manpower.crewCount", { count }),
    );
    expect(forms[0]).toBe("لا يوجد طاقم");
    expect(forms[1]).toBe("فرد طاقم واحد");
    expect(forms[2]).toBe("فردا طاقم");
    expect(forms[3]).toContain("3");
    expect(forms[4]).toContain("11");
    expect(forms[5]).toContain("100");
    expect(new Set(forms).size).toBe(6);
  });

  it("renders distinct forms for the offline pending badge", async () => {
    const i18n = createI18n("ar");
    await i18n.changeLanguage("ar");
    const forms = [0, 1, 2, 3, 11].map((count) =>
      i18n.t("fieldMod.offline.pendingBadge", { count }),
    );
    expect(new Set(forms).size).toBe(5);

    const en = createI18n("en");
    expect(en.t("fieldMod.offline.pendingBadge", { count: 1 })).toBe("One item pending sync");
    expect(en.t("fieldMod.offline.pendingBadge", { count: 4 })).toBe("4 items pending sync");
  });
});
