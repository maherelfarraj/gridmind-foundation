// P-168 — Protection schedule / relay-settings domain constants and mapping helpers.
// Pure module: no React, no Supabase, no route imports. Shared by the server layer,
// the UI and the tests.

export const PROTECTION_DEVICE_TYPES = [
  "circuit_breaker",
  "fuse",
  "relay",
  "contactor",
  "disconnector",
  "mccb",
  "acb",
  "vcb",
  "other",
] as const;
export type ProtectionDeviceType = (typeof PROTECTION_DEVICE_TYPES)[number];

export const PROTECTION_DEVICE_SOURCES = ["sld", "manual"] as const;
export type ProtectionDeviceSource = (typeof PROTECTION_DEVICE_SOURCES)[number];

/** ANSI/IEEE C37.2 device-function picklist offered on the relay-settings grid. */
export const ANSI_FUNCTION_CODES = [
  "50",
  "51",
  "50N",
  "51N",
  "27",
  "59",
  "59N",
  "81",
  "25",
  "46",
  "49",
] as const;
export type AnsiFunctionCode = (typeof ANSI_FUNCTION_CODES)[number];

export const ANSI_FUNCTION_LABELS: Record<AnsiFunctionCode, string> = {
  "50": "Instantaneous overcurrent",
  "51": "Time overcurrent",
  "50N": "Instantaneous earth-fault overcurrent",
  "51N": "Time earth-fault overcurrent",
  "27": "Undervoltage",
  "59": "Overvoltage",
  "59N": "Neutral displacement / residual overvoltage",
  "81": "Under/over frequency",
  "25": "Synchronism check",
  "46": "Negative-sequence / phase-balance current",
  "49": "Thermal overload",
};

export function isAnsiFunctionCode(value: string): value is AnsiFunctionCode {
  return (ANSI_FUNCTION_CODES as readonly string[]).includes(value);
}

/** Batch 16 SLD symbol types that represent a protection device. */
export const SLD_PROTECTION_SYMBOLS: Record<string, ProtectionDeviceType> = {
  circuit_breaker: "circuit_breaker",
  breaker: "circuit_breaker",
  vcb: "vcb",
  acb: "acb",
  mccb: "mccb",
  fuse: "fuse",
  relay: "relay",
  protection_relay: "relay",
  contactor: "contactor",
  disconnector: "disconnector",
  isolator: "disconnector",
  switch_disconnector: "disconnector",
};

export function isProtectionSymbol(symbolType: string): boolean {
  return Object.prototype.hasOwnProperty.call(SLD_PROTECTION_SYMBOLS, symbolType);
}

export type SldProtectionObject = {
  id: string;
  symbol_type: string;
  tag: string | null;
  label: string | null;
  properties: Record<string, unknown> | null;
};

export type MappedProtectionDevice = {
  sld_object_id: string;
  tag: string;
  device_type: ProtectionDeviceType;
  ansi_codes: string[];
  voltage_kv: number | null;
  rated_current_a: number | null;
  breaking_capacity_ka: number | null;
  making_capacity_ka: number | null;
  ct_ratio: string | null;
  vt_ratio: string | null;
  curve_type: string | null;
  notes: string | null;
  sort_order: number;
};

function numProp(bag: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = bag[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function textProp(bag: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = bag[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function codeList(bag: Record<string, unknown>): string[] {
  const raw = bag.ansi_codes ?? bag.ansiCodes ?? bag.functions;
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,;/]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Maps protection-class SLD objects into ea_protection_devices rows. Objects with no
 * tag are skipped — the tag is the idempotency key of the upsert. Later duplicates of
 * the same tag are dropped so the batch never self-conflicts.
 */
export function mapSldObjectsToDevices(objects: SldProtectionObject[]): MappedProtectionDevice[] {
  const seen = new Set<string>();
  const out: MappedProtectionDevice[] = [];
  objects.forEach((obj, index) => {
    if (!isProtectionSymbol(obj.symbol_type)) return;
    const tag = (obj.tag ?? "").trim();
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    const bag = (obj.properties ?? {}) as Record<string, unknown>;
    out.push({
      sld_object_id: obj.id,
      tag,
      device_type: SLD_PROTECTION_SYMBOLS[obj.symbol_type],
      ansi_codes: codeList(bag),
      voltage_kv: numProp(bag, "voltage_kv", "voltageKv", "kv", "un_kv"),
      rated_current_a: numProp(bag, "rated_current_a", "ratedCurrentA", "in_a", "current_a"),
      breaking_capacity_ka: numProp(bag, "breaking_capacity_ka", "icu_ka", "breakingKa"),
      making_capacity_ka: numProp(bag, "making_capacity_ka", "icm_ka", "makingKa"),
      ct_ratio: textProp(bag, "ct_ratio", "ctRatio"),
      vt_ratio: textProp(bag, "vt_ratio", "vtRatio"),
      curve_type: textProp(bag, "curve_type", "curve"),
      notes: obj.label && obj.label.trim() !== "" ? obj.label.trim() : null,
      sort_order: index,
    });
  });
  return out;
}

/** Next relay-settings revision for a device: highest existing + 1, or 0 when empty. */
export function nextSettingRevision(existing: number[]): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing) + 1;
}

export const GRID_CODE_RESPONSE_STATUSES = [
  "open",
  "evidence_pending",
  "compliant",
  "non_compliant",
  "not_applicable",
] as const;
export type GridCodeResponseStatus = (typeof GRID_CODE_RESPONSE_STATUSES)[number];

export type GridCodeItem = {
  code: string;
  category: string;
  requirement: string;
  evidence_required?: boolean;
};

export const NEPCO_TEMPLATE_CAVEAT =
  "Starter template only — verify every item against the currently issued NEPCO grid code before use.";
