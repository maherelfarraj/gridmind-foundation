// P-150 — Per-category field + column definitions for the PV equipment library.
import type { PvCategory, PvEquipmentRow } from "@/lib/pv-library.schemas";

export interface NumField {
  key: string;
  label: string;
  unit?: string;
  step?: string;
}

const MODULE_ELECTRICAL: NumField[] = [
  { key: "pmax_w", label: "Pmax", unit: "W" },
  { key: "voc_v", label: "Voc", unit: "V", step: "0.01" },
  { key: "isc_a", label: "Isc", unit: "A", step: "0.01" },
  { key: "vmp_v", label: "Vmp", unit: "V", step: "0.01" },
  { key: "imp_a", label: "Imp", unit: "A", step: "0.01" },
  { key: "efficiency_pct", label: "Module efficiency", unit: "%", step: "0.01" },
  { key: "cells", label: "Cells", unit: "#" },
  { key: "bifaciality_pct", label: "Bifaciality", unit: "%", step: "0.1" },
];

const INVERTER_ELECTRICAL: NumField[] = [
  { key: "ac_kw", label: "AC rating", unit: "kW", step: "0.1" },
  { key: "mppt_count", label: "MPPT count", unit: "#" },
  { key: "mppt_v_min", label: "MPPT V min", unit: "V" },
  { key: "mppt_v_max", label: "MPPT V max", unit: "V" },
  { key: "max_dc_v", label: "Max DC voltage", unit: "V" },
  { key: "max_dc_a", label: "Max DC current", unit: "A", step: "0.1" },
  { key: "euro_efficiency_pct", label: "Euro efficiency", unit: "%", step: "0.01" },
  { key: "efficiency_pct", label: "Max efficiency", unit: "%", step: "0.01" },
];

const GENERIC_ELECTRICAL: NumField[] = [
  { key: "rated_kva", label: "Rated power", unit: "kVA", step: "0.1" },
  { key: "rated_voltage_v", label: "Rated voltage", unit: "V" },
  { key: "rated_current_a", label: "Rated current", unit: "A", step: "0.1" },
  { key: "efficiency_pct", label: "Efficiency", unit: "%", step: "0.01" },
];

const BESS_ELECTRICAL: NumField[] = [
  { key: "energy_kwh", label: "Usable energy", unit: "kWh", step: "0.1" },
  { key: "ac_kw", label: "AC power", unit: "kW", step: "0.1" },
  { key: "rated_voltage_v", label: "DC voltage", unit: "V" },
  { key: "efficiency_pct", label: "Round-trip efficiency", unit: "%", step: "0.01" },
];

export function electricalFields(category: PvCategory): NumField[] {
  switch (category) {
    case "module":
      return MODULE_ELECTRICAL;
    case "inverter":
    case "optimizer":
      return INVERTER_ELECTRICAL;
    case "bess":
      return BESS_ELECTRICAL;
    default:
      return GENERIC_ELECTRICAL;
  }
}

export const TEMP_COEFF_FIELDS: NumField[] = [
  { key: "pmax_pct_per_c", label: "Pmax coeff", unit: "%/°C", step: "0.001" },
  { key: "voc_pct_per_c", label: "Voc coeff", unit: "%/°C", step: "0.001" },
  { key: "isc_pct_per_c", label: "Isc coeff", unit: "%/°C", step: "0.001" },
  { key: "noct_c", label: "NOCT", unit: "°C", step: "0.1" },
];

export const DEGRADATION_FIELDS: NumField[] = [
  { key: "year_one_pct", label: "Year-1 degradation", unit: "%", step: "0.01" },
  { key: "annual_pct", label: "Annual degradation", unit: "%", step: "0.01" },
];

export const DIMENSION_FIELDS: NumField[] = [
  { key: "length_mm", label: "Length", unit: "mm" },
  { key: "width_mm", label: "Width", unit: "mm" },
  { key: "depth_mm", label: "Depth / thickness", unit: "mm" },
  { key: "weight_kg", label: "Weight", unit: "kg", step: "0.1" },
];

export const LIMIT_FIELDS: NumField[] = [
  { key: "max_system_voltage_v", label: "Max system voltage", unit: "V" },
  { key: "max_series_fuse_a", label: "Max series fuse", unit: "A", step: "0.1" },
  { key: "operating_temp_min_c", label: "Operating temp min", unit: "°C", step: "0.1" },
  { key: "operating_temp_max_c", label: "Operating temp max", unit: "°C", step: "0.1" },
];

export interface TableColumn {
  label: string;
  value: (row: PvEquipmentRow) => string;
}

function n(v: unknown, unit = "", digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const num = Number(v);
  if (!Number.isFinite(num)) return "—";
  const s = Number.isInteger(num) ? String(num) : num.toFixed(digits).replace(/\.?0+$/, "");
  return unit ? `${s} ${unit}` : s;
}

export function tableColumns(category: PvCategory): TableColumn[] {
  if (category === "module") {
    return [
      { label: "Pmax", value: (r) => n(r.electrical.pmax_w, "W") },
      { label: "Voc", value: (r) => n(r.electrical.voc_v, "V") },
      { label: "Vmp", value: (r) => n(r.electrical.vmp_v, "V") },
      {
        label: "Temp coeff (Pmax / Voc)",
        value: (r) =>
          `${n(r.temp_coefficients.pmax_pct_per_c, "%/°C", 3)} / ${n(
            r.temp_coefficients.voc_pct_per_c,
            "%/°C",
            3,
          )}`,
      },
    ];
  }
  if (category === "inverter" || category === "optimizer") {
    return [
      { label: "AC kW", value: (r) => n(r.electrical.ac_kw, "kW") },
      { label: "MPPT", value: (r) => n(r.electrical.mppt_count) },
      {
        label: "MPPT window",
        value: (r) =>
          r.electrical.mppt_v_min == null && r.electrical.mppt_v_max == null
            ? "—"
            : `${n(r.electrical.mppt_v_min)}–${n(r.electrical.mppt_v_max, "V")}`,
      },
      { label: "Max DC V", value: (r) => n(r.electrical.max_dc_v, "V") },
      { label: "Euro η", value: (r) => n(r.electrical.euro_efficiency_pct, "%") },
    ];
  }
  if (category === "bess") {
    return [
      { label: "Energy", value: (r) => n(r.electrical.energy_kwh, "kWh") },
      { label: "Power", value: (r) => n(r.electrical.ac_kw, "kW") },
      { label: "RTE", value: (r) => n(r.electrical.efficiency_pct, "%") },
      { label: "Weight", value: (r) => n(r.dimensions.weight_kg, "kg") },
    ];
  }
  return [
    { label: "Rating", value: (r) => n(r.electrical.rated_kva, "kVA") },
    { label: "Voltage", value: (r) => n(r.electrical.rated_voltage_v, "V") },
    { label: "Current", value: (r) => n(r.electrical.rated_current_a, "A") },
    { label: "Weight", value: (r) => n(r.dimensions.weight_kg, "kg") },
  ];
}

export const formatSpec = n;
