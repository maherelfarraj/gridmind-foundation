// P-240 — Nav labels live in nav-map.ts as English strings; the catalogs mirror
// them under `navItems` keyed by the exact English label. Missing keys fall back
// to the English label so a new nav entry never renders blank.
import type { TFunction } from "i18next";

export function translateNavLabel(t: TFunction, label: string): string {
  return t(`navItems.${label}`, { defaultValue: label });
}
