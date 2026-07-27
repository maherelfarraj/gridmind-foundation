// P-190 — Management of Change: pure rules, schemas and presentation maps.
// No server or React imports here so the whole file is unit-testable.
import { z } from "zod";

export const CR_STATUSES = [
  "draft",
  "assessment",
  "approved",
  "rejected",
  "implementing",
  "closed",
  "cancelled",
] as const;
export type CrStatus = (typeof CR_STATUSES)[number];

export interface ChangeTypeMeta {
  value: string;
  label: string;
  /** Plain-language description shown in the create dialog. */
  description: string;
  /** Token-only badge classes — never raw colour values. */
  badgeClass: string;
}

export const CHANGE_TYPES: ChangeTypeMeta[] = [
  {
    value: "design",
    label: "Design change",
    description: "An engineering decision changes the designed solution (layout, sizing, routing).",
    badgeClass: "bg-primary/10 text-primary",
  },
  {
    value: "vendor_substitution",
    label: "Vendor substitution",
    description: "A different supplier or product replaces the awarded one.",
    badgeClass: "bg-accent/15 text-accent",
  },
  {
    value: "site_condition",
    label: "Site condition",
    description: "Ground, access or weather realities differ from what was assumed.",
    badgeClass: "bg-warning/15 text-warning",
  },
  {
    value: "grid_requirement",
    label: "Grid requirement",
    description: "The utility or grid code imposes a new or revised requirement.",
    badgeClass: "bg-secondary text-secondary-foreground",
  },
  {
    value: "client_instruction",
    label: "Client instruction",
    description: "The client formally asks for something different from the contract scope.",
    badgeClass: "bg-primary/15 text-primary",
  },
  {
    value: "construction_deviation",
    label: "Construction deviation",
    description: "Work was, or must be, built differently from the issued-for-construction set.",
    badgeClass: "bg-destructive/10 text-destructive",
  },
  {
    value: "value_engineering",
    label: "Value engineering",
    description: "A proposal to reduce cost or schedule while keeping performance.",
    badgeClass: "bg-success/15 text-success",
  },
  {
    value: "obsolescence",
    label: "Obsolescence",
    description: "A specified item is discontinued or no longer procurable.",
    badgeClass: "bg-muted text-muted-foreground",
  },
  {
    value: "software_firmware",
    label: "Software / firmware",
    description: "A controller, inverter or SCADA software version change.",
    badgeClass: "bg-accent/10 text-accent",
  },
  {
    value: "scada_tag",
    label: "SCADA tag change",
    description: "Monitoring points, tag names or mappings change.",
    badgeClass: "bg-secondary/70 text-secondary-foreground",
  },
];

const TYPE_INDEX = new Map(CHANGE_TYPES.map((t) => [t.value, t]));

export function changeTypeMeta(value: string | null | undefined): ChangeTypeMeta {
  return (
    (value ? TYPE_INDEX.get(value) : undefined) ?? {
      value: value ?? "unknown",
      label: (value ?? "unknown").replaceAll("_", " "),
      description: "",
      badgeClass: "bg-muted text-muted-foreground",
    }
  );
}

export const CHANGE_TYPE_VALUES = CHANGE_TYPES.map((t) => t.value) as [string, ...string[]];

/* -------------------------------------------------------------------------- */
/* Aging                                                                      */
/* -------------------------------------------------------------------------- */

export const AGE_BUCKETS = ["0-7", "8-30", "31-90", ">90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageDays(from: string | Date, now: Date = new Date()): number {
  const start = typeof from === "string" ? new Date(from) : from;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000));
}

export function ageBucket(days: number): AgeBucket {
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 90) return "31-90";
  return ">90";
}

/** Tailwind token intensity for the aging heat table (never a raw colour). */
export function heatClass(count: number, max: number): string {
  if (count === 0) return "bg-card text-muted-foreground";
  const ratio = max > 0 ? count / max : 0;
  if (ratio > 0.75) return "bg-accent/40 text-foreground";
  if (ratio > 0.5) return "bg-accent/30 text-foreground";
  if (ratio > 0.25) return "bg-accent/20 text-foreground";
  return "bg-accent/10 text-foreground";
}

export const OPEN_STATUSES: CrStatus[] = ["draft", "assessment", "approved", "implementing"];

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as string[]).includes(status);
}

/** Impact areas that trigger the amber "not assessed" flag when empty. */
export function unassessedAreas(cr: {
  technical_impact: string | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
  energy_yield_impact: string | null;
  contract_impact: string | null;
  hse_impact: string | null;
}): string[] {
  const missing: string[] = [];
  if (!cr.technical_impact?.trim()) missing.push("technical");
  if (cr.cost_impact == null) missing.push("cost");
  if (cr.schedule_impact_days == null) missing.push("schedule");
  if (!cr.energy_yield_impact?.trim()) missing.push("energy yield");
  if (!cr.contract_impact?.trim()) missing.push("contract");
  if (!cr.hse_impact?.trim()) missing.push("HSE");
  return missing;
}

/* -------------------------------------------------------------------------- */
/* Date-range presets                                                          */
/* -------------------------------------------------------------------------- */

export const DATE_PRESETS = ["any", "7d", "30d", "90d", "ytd"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  any: "Any date",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
};

/** Resolve a preset to an ISO lower bound, or null for "any". */
export function presetSince(preset: DatePreset, now: Date = new Date()): string | null {
  if (preset === "any") return null;
  if (preset === "ytd") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                     */
/* -------------------------------------------------------------------------- */

export const listChangesSchema = z.object({
  statuses: z.array(z.enum(CR_STATUSES)).max(7).default([]),
  changeType: z.enum(CHANGE_TYPE_VALUES).nullish(),
  projectId: z.string().uuid().nullish(),
  datePreset: z.enum(DATE_PRESETS).default("any"),
  search: z.string().trim().max(120).default(""),
  page: z.number().int().min(1).max(500).default(1),
});
export type ListChangesInput = z.infer<typeof listChangesSchema>;

export const createChangeSchema = z.object({
  change_type: z.enum(CHANGE_TYPE_VALUES),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  reason: z.string().trim().min(3).max(5000),
  project_id: z.string().uuid().nullish(),
});

export const affectedSystemSchema = z.object({
  system: z.string().trim().min(1).max(120),
  entity_type: z.string().trim().max(60).default(""),
  entity_id: z.string().trim().max(60).default(""),
  note: z.string().trim().max(500).default(""),
});
export type AffectedSystem = z.infer<typeof affectedSystemSchema>;

export const updateImpactsSchema = z.object({
  id: z.string().uuid(),
  technical_impact: z.string().trim().max(5000).nullish(),
  cost_impact: z.number().finite().min(-1e12).max(1e12).nullish(),
  cost_impact_notes: z.string().trim().max(2000).nullish(),
  schedule_impact_days: z.number().int().min(-3650).max(3650).nullish(),
  schedule_impact_notes: z.string().trim().max(2000).nullish(),
  energy_yield_impact: z.string().trim().max(2000).nullish(),
  contract_impact: z.string().trim().max(2000).nullish(),
  hse_impact: z.string().trim().max(2000).nullish(),
  affected_systems: z.array(affectedSystemSchema).max(50).optional(),
});

export const transitionSchema = z.object({
  id: z.string().uuid(),
  to: z.enum(["approved", "rejected", "implementing", "closed", "cancelled"]),
  rejection_reason: z.string().trim().max(2000).optional(),
  closure_notes: z.string().trim().max(5000).optional(),
  updated_documents: z.array(z.string().trim().max(300)).max(50).optional(),
  updated_asbuilts: z.array(z.string().trim().max(300)).max(50).optional(),
});

export const evidenceSchema = z.object({
  id: z.string().uuid(),
  path: z.string().trim().min(3).max(400),
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().min(0).max(200_000_000).optional(),
});

/** Storage path convention: company-UUID first, private `documents` bucket. */
export function evidencePath(companyId: string, crId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return `${companyId}/moc-evidence/${crId}/${Date.now()}-${safe}`;
}
