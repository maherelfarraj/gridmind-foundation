// GC-12 — Shared presentation helpers for EVM surfaces.
import type { EvmMeasures } from "@/lib/evm.report.rules";
import { formatCostingMoney } from "@/lib/costing.rules";

/** Money, or an em dash when the measure is not computable. */
export function money(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined ? "—" : formatCostingMoney(value, currency);
}

/** Index/ratio to three decimals. Zero is a real value and is shown as 0.000. */
export function ratio(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(3);
}

/** Percentage to one decimal. */
export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

export function days(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(Math.round(value));
}

/** CPI/SPI tone: below 1 is adverse, at or above is favourable. */
export function indexTone(
  value: number | null,
  threshold: number,
): "neutral" | "good" | "warning" | "bad" {
  if (value === null) return "neutral";
  if (value < threshold) return "bad";
  if (value < 1) return "warning";
  return "good";
}

/** Variance tone: negative is adverse in EVM by convention. */
export function varianceTone(value: number | null): "neutral" | "good" | "warning" | "bad" {
  if (value === null) return "neutral";
  if (value < 0) return "bad";
  return "good";
}

export interface FormulaRow {
  key: "eac_bottom_up" | "eac_cpi" | "eac_cpi_spi" | "eac_ac_plus_remaining";
  value: number | null;
}

/** All EAC variants side by side so the official selection is auditable. */
export function formulaRows(m: EvmMeasures): FormulaRow[] {
  return [
    { key: "eac_bottom_up", value: m.eac_bottom_up },
    { key: "eac_cpi", value: m.eac_cpi },
    { key: "eac_cpi_spi", value: m.eac_cpi_spi },
    { key: "eac_ac_plus_remaining", value: m.eac_ac_plus_remaining },
  ];
}
