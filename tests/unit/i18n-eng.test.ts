// P-243 — Arabic pass: eng catalog parity + honesty label + no-translate guards.
import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/eng.en.json";
import ar from "@/lib/i18n/eng.ar.json";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, "");
}

function collectKeys(obj: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const nested of collectKeys(v, path)) out.add(nested);
      } else {
        out.add(baseKey(path));
      }
    }
  }
  return out;
}

describe("eng i18n catalog", () => {
  it("has identical keys in en and ar (ignoring plural suffixes)", () => {
    const enKeys = collectKeys(en);
    const arKeys = collectKeys(ar);

    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k));

    expect(missingInAr, `keys missing in eng.ar.json: ${missingInAr.join(", ")}`).toEqual([]);
    expect(missingInEn, `keys missing in eng.en.json: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("has the exact honesty-label Arabic string", () => {
    expect(ar.pv.simulation.honestyLabel).toBe(
      "نموذج GridMind الشفاف — لم يُتحقق منه بعد مقابل الأدوات التجارية",
    );
  });

  it("does not translate SLD connection-type symbol tags (stored enum values)", () => {
    const drawingDisciplines = ["civil", "structural", "electrical", "mechanical", "scada_controls", "survey", "general"];
    for (const key of Object.keys(en.drawings.disciplineLabels)) {
      expect(drawingDisciplines).toContain(key);
    }
    // Enum keys themselves (the object keys) must stay Latin identifiers in both catalogs.
    expect(Object.keys(en.sld.canvas.connectionTypeLabels).sort()).toEqual(
      Object.keys(ar.sld.canvas.connectionTypeLabels).sort(),
    );
    for (const key of Object.keys(ar.sld.canvas.connectionTypeLabels)) {
      expect(key).toMatch(/^[a-z_]+$/);
    }
  });

  it("does not translate math formulas / measurement symbol templates", () => {
    // The Δ (delta) measurement template and its {{placeholders}} must be identical
    // in structure across locales — only literal words may differ, never the symbol.
    expect(en.sld.canvas.status.measurement).toContain("Δ");
    expect(ar.sld.canvas.status.measurement).toContain("Δ");
    expect(en.sld.canvas.status.measurement).toContain("{{distance}}");
    expect(ar.sld.canvas.status.measurement).toContain("{{distance}}");
  });
});
