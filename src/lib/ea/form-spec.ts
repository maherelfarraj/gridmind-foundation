// P-169 — Input-sheet field spec derived from each calculator's own zod schema.
// Pure module: no React, no Supabase. The workspace form is generated from this,
// so a new calculator needs no bespoke UI to become editable.
import { z } from "zod";

export type EaFieldKind = "number" | "integer" | "text" | "boolean" | "enum" | "grid" | "list";

export type EaField = {
  name: string;
  label: string;
  kind: EaFieldKind;
  optional: boolean;
  unit: string | null;
  defaultValue: unknown;
  options?: string[];
  /** Column spec for `grid` (array of objects). */
  columns?: EaField[];
  /** Element kind for `list` (array of scalars). */
  itemKind?: "number" | "text";
  min?: number;
  max?: number;
};

/** Suffix → unit label. Longest match wins, so order matters. */
const UNIT_SUFFIXES: Array<[string, string]> = [
  ["Kvar", "kvar"],
  ["Kva", "kVA"],
  ["Mvar", "Mvar"],
  ["Mva", "MVA"],
  ["Kwh", "kWh"],
  ["Mwh", "MWh"],
  ["Kw", "kW"],
  ["Mw", "MW"],
  ["Kv", "kV"],
  ["Ka", "kA"],
  ["Mm2", "mm²"],
  ["Ohm", "Ω"],
  ["OhmM", "Ω·m"],
  ["Pct", "%"],
  ["Pu", "pu"],
  ["Hz", "Hz"],
  ["DegC", "°C"],
  ["Deg", "°"],
  ["Minutes", "min"],
  ["Hours", "h"],
  ["Seconds", "s"],
  ["Ah", "Ah"],
  ["Vdc", "V dc"],
  ["Km", "km"],
  ["Vac", "V ac"],
  ["Wh", "Wh"],
  ["A", "A"],
  ["V", "V"],
  ["M", "m"],
  ["S", "s"],
];

/** "backupMinutes" → "min"; unmatched names carry no unit. */
export function unitFor(name: string): string | null {
  for (const [suffix, unit] of UNIT_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return unit;
  }
  return null;
}

/** "dcBusVdc" → "Dc bus"; the unit is rendered separately. */
export function labelFor(name: string): string {
  const unit = unitFor(name);
  const base = unit ? name.slice(0, name.length - unitSuffixLength(name)) : name;
  const spaced = (base || name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function unitSuffixLength(name: string): number {
  for (const [suffix] of UNIT_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return suffix.length;
  }
  return 0;
}

type AnyDef = { typeName?: string; [k: string]: unknown };

function def(schema: z.ZodTypeAny): AnyDef {
  return (schema as unknown as { _def: AnyDef })._def ?? {};
}

type Unwrapped = { schema: z.ZodTypeAny; optional: boolean; defaultValue: unknown };

/** Strips default/optional/nullable/effects wrappers, keeping what they told us. */
function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let current = schema;
  let optional = false;
  let defaultValue: unknown = undefined;
  for (let guard = 0; guard < 12; guard += 1) {
    const d = def(current);
    switch (d.typeName) {
      case "ZodDefault": {
        const fn = d.defaultValue as (() => unknown) | undefined;
        if (defaultValue === undefined && typeof fn === "function") defaultValue = fn();
        current = d.innerType as z.ZodTypeAny;
        break;
      }
      case "ZodOptional":
      case "ZodNullable":
        optional = true;
        current = d.innerType as z.ZodTypeAny;
        break;
      case "ZodEffects":
        current = d.schema as z.ZodTypeAny;
        break;
      case "ZodBranded":
      case "ZodReadonly":
        current = d.type as z.ZodTypeAny;
        break;
      default:
        return { schema: current, optional, defaultValue };
    }
  }
  return { schema: current, optional, defaultValue };
}

function numberBounds(schema: z.ZodTypeAny): { int: boolean; min?: number; max?: number } {
  const checks = (def(schema).checks ?? []) as Array<{ kind: string; value?: number }>;
  let int = false;
  let min: number | undefined;
  let max: number | undefined;
  for (const c of checks) {
    if (c.kind === "int") int = true;
    if (c.kind === "min" && typeof c.value === "number") min = c.value;
    if (c.kind === "max" && typeof c.value === "number") max = c.value;
  }
  return { int, min, max };
}

function fieldFrom(name: string, schema: z.ZodTypeAny): EaField | null {
  const { schema: inner, optional, defaultValue } = unwrap(schema);
  const d = def(inner);
  const base = {
    name,
    label: labelFor(name),
    optional,
    unit: unitFor(name),
    defaultValue,
  };

  switch (d.typeName) {
    case "ZodNumber": {
      const { int, min, max } = numberBounds(inner);
      return { ...base, kind: int ? "integer" : "number", min, max };
    }
    case "ZodString":
      return { ...base, kind: "text" };
    case "ZodBoolean":
      return { ...base, kind: "boolean", defaultValue: defaultValue ?? false };
    case "ZodEnum":
      return { ...base, kind: "enum", options: (d.values as string[]) ?? [] };
    case "ZodNativeEnum":
      return {
        ...base,
        kind: "enum",
        options: Object.values((d.values ?? {}) as Record<string, string>),
      };
    case "ZodArray": {
      const element = unwrap(d.type as z.ZodTypeAny).schema;
      const elementDef = def(element);
      if (elementDef.typeName === "ZodObject") {
        return {
          ...base,
          kind: "grid",
          columns: fieldsOf(element as z.ZodObject<z.ZodRawShape>),
          defaultValue: [],
        };
      }
      if (elementDef.typeName === "ZodNumber" || elementDef.typeName === "ZodString") {
        return {
          ...base,
          kind: "list",
          itemKind: elementDef.typeName === "ZodNumber" ? "number" : "text",
          defaultValue: [],
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Ordered field list for a zod object schema; unsupported shapes are skipped. */
export function fieldsOf(schema: z.ZodTypeAny): EaField[] {
  const { schema: object } = unwrap(schema);
  const d = def(object);
  if (d.typeName !== "ZodObject") return [];
  const shape = (d.shape as () => z.ZodRawShape)();
  const out: EaField[] = [];
  for (const [name, child] of Object.entries(shape)) {
    const field = fieldFrom(name, child as z.ZodTypeAny);
    if (field) out.push(field);
  }
  return out;
}

/** Blank row for a grid column set (defaults applied, otherwise empty). */
export function emptyRow(columns: EaField[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of columns) {
    row[c.name] =
      c.defaultValue !== undefined
        ? c.defaultValue
        : c.kind === "boolean"
          ? false
          : c.kind === "enum"
            ? (c.options?.[0] ?? "")
            : "";
  }
  return row;
}

/** Form defaults for a calculator schema, merged over any stored input sheet. */
export function defaultsFor(
  schema: z.ZodTypeAny,
  stored?: Record<string, unknown> | null,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fieldsOf(schema)) {
    const existing = stored ? stored[field.name] : undefined;
    if (existing !== undefined) {
      values[field.name] = existing;
      continue;
    }
    if (field.defaultValue !== undefined) {
      values[field.name] = field.defaultValue;
      continue;
    }
    values[field.name] =
      field.kind === "grid" || field.kind === "list"
        ? []
        : field.kind === "boolean"
          ? false
          : field.kind === "enum"
            ? (field.options?.[0] ?? "")
            : "";
  }
  return values;
}

/** Coerces the string-heavy form state back into calculator-shaped values. */
export function coerceValues(
  fields: EaField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.kind === "grid") {
      const rows = Array.isArray(raw) ? raw : [];
      out[field.name] = rows.map((row) =>
        coerceValues(field.columns ?? [], (row ?? {}) as Record<string, unknown>),
      );
      continue;
    }
    if (field.kind === "list") {
      const items = Array.isArray(raw) ? raw : [];
      out[field.name] =
        field.itemKind === "number"
          ? items.map((v) => toNumber(v)).filter(isNum)
          : items.map(String);
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      const n = toNumber(raw);
      if (n === null) {
        if (!field.optional && field.defaultValue !== undefined)
          out[field.name] = field.defaultValue;
        continue;
      }
      out[field.name] = n;
      continue;
    }
    if (field.kind === "boolean") {
      out[field.name] = Boolean(raw);
      continue;
    }
    const text = raw === undefined || raw === null ? "" : String(raw);
    if (text === "" && field.optional) continue;
    out[field.name] = text;
  }
  return out;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isNum(v: number | null): v is number {
  return v !== null;
}
