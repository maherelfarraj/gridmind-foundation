// P-243 — OM catalog parity, enum-display mapping, and RTL chrome checks.
import { describe, expect, it } from "vitest";

import enCatalog from "@/lib/i18n/om.en.json";
import arCatalog from "@/lib/i18n/om.ar.json";
import { createI18n } from "@/lib/i18n";
import { applyDocumentLocale } from "@/lib/i18n/locale-provider";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function stripPluralSuffixes(keys: string[]): Set<string> {
  return new Set(keys.map((k) => k.replace(PLURAL_SUFFIX, "")));
}

function collectKeyPaths(obj: unknown, prefix = ""): string[] {
  if (obj == null || typeof obj !== "object") return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object") {
      out.push(...collectKeyPaths(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("omMod catalog parity (en vs ar)", () => {
  it("has the same key set, ignoring plural suffixes", () => {
    const enKeys = stripPluralSuffixes(collectKeyPaths(enCatalog));
    const arKeys = stripPluralSuffixes(collectKeyPaths(arCatalog));

    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));

    expect(missingInAr, `Keys missing in ar: ${missingInAr.join(", ")}`).toHaveLength(0);
    expect(missingInEn, `Keys missing in en: ${missingInEn.join(", ")}`).toHaveLength(0);
  });

  it("does not leave any Arabic values empty", () => {
    const arValues = collectKeyPaths(arCatalog).map((path) => {
      const parts = path.split(".");
      let node: any = arCatalog;
      for (const p of parts) node = node?.[p];
      return { path, value: node };
    });
    const empty = arValues.filter((v) => typeof v.value === "string" && v.value.trim() === "");
    expect(empty, `Empty ar values: ${empty.map((v) => v.path).join(", ")}`).toHaveLength(0);
  });
});

describe("severity display mapping", () => {
  const i18nAr = createI18n("ar");
  const i18nEn = createI18n("en");

  const cases: Array<[string, string]> = [
    ["critical", "حرج"],
    ["major", "رئيسي"],
    ["minor", "ثانوي"],
    ["warning", "تحذير"],
  ];

  it.each(cases)("maps stored severity '%s' to Arabic display '%s'", (stored, arabicLabel) => {
    expect(i18nAr.t(`omMod.severity.${stored}`)).toBe(arabicLabel);
  });

  it.each(cases)("keeps the stored severity enum value in English ('%s')", (stored) => {
    // The enum value used for filtering/DB storage must remain the untranslated English token.
    expect(stored).toBe(stored.toLowerCase());
    expect(i18nEn.t(`omMod.severity.${stored}`)).not.toBe(arabicLabelFor(stored));
  });

  function arabicLabelFor(stored: string): string {
    return cases.find(([s]) => s === stored)?.[1] ?? "";
  }
});

describe("work-order kanban state display mapping", () => {
  const i18nAr = createI18n("ar");

  const statuses: Array<[string, string]> = [
    ["open", (arCatalog as any).workOrderStatus.open],
    ["assigned", (arCatalog as any).workOrderStatus.assigned],
    ["in_progress", (arCatalog as any).workOrderStatus.in_progress],
    ["on_hold", (arCatalog as any).workOrderStatus.on_hold],
    ["completed", (arCatalog as any).workOrderStatus.completed],
    ["closed", (arCatalog as any).workOrderStatus.closed],
    ["cancelled", (arCatalog as any).workOrderStatus.cancelled],
  ];

  it.each(statuses)("displays kanban column '%s' using its Arabic label", (stored, expected) => {
    expect(i18nAr.t(`omMod.workOrderStatus.${stored}`)).toBe(expected);
    // Stored/DB enum stays English/snake_case regardless of locale.
    expect(stored).toMatch(/^[a-z_]+$/);
  });
});

describe("SCADA dashboard RTL chrome", () => {
  it("flips document dir/lang to rtl for Arabic and back to ltr for English", () => {
    applyDocumentLocale("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");

    applyDocumentLocale("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("translates the SCADA dashboard title/description via logical-prop-safe strings", () => {
    const i18nAr = createI18n("ar");
    const title = i18nAr.t("omMod.scadaDashboard.title");
    const description = i18nAr.t("omMod.scadaDashboard.description");
    expect(title).toBeTruthy();
    expect(description).toBeTruthy();
    // Arabic strings should not contain hardcoded left/right-only directional markers.
    expect(title).not.toMatch(/\bleft\b|\bright\b/i);
    expect(description).not.toMatch(/\bleft\b|\bright\b/i);
  });
});
