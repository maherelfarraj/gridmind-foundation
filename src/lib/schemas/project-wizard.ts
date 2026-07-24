// P-034 — Shared zod schema for the project wizard basics step.
// Reused server-side at creation time (P-036).
import { z } from "zod";

import type { ProjectArchetype } from "@/lib/wizard-draft";

export const PROJECT_CODE_REGEX = /^[A-Z0-9-]{2,12}$/;

const baseObject = z.object({
  name: z.string().trim().min(3, "At least 3 characters").max(120),
  code: z
    .string()
    .trim()
    .regex(PROJECT_CODE_REGEX, "2–12 chars: A-Z, 0-9, hyphen"),
  capacity_mw: z.coerce.number().positive("Capacity must be > 0"),
  capacity_mwh: z.coerce.number().positive().optional(),
  site_name: z.string().trim().max(160).optional().or(z.literal("")),
  site_country: z.string().trim().max(80).optional().or(z.literal("")),
  site_region: z.string().trim().max(80).optional().or(z.literal("")),
  site_lat: z.coerce.number().min(-90).max(90).optional(),
  site_lng: z.coerce.number().min(-180).max(180).optional(),
  offtaker: z.string().trim().max(160).optional().or(z.literal("")),
  target_cod: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), "Target COD must be in the future"),
});

export function makeProjectBasicsSchema(archetype: ProjectArchetype) {
  return baseObject.superRefine((v, ctx) => {
    const needsMwh =
      archetype === "standalone_bess" || archetype === "hybrid_pv_bess";
    if (needsMwh && (v.capacity_mwh === undefined || v.capacity_mwh === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["capacity_mwh"],
        message: "MWh is required for BESS archetypes",
      });
    }
  });
}

export type ProjectBasics = z.infer<ReturnType<typeof makeProjectBasicsSchema>>;

/**
 * Suggest a project code from a name. Takes up to 3 alphanumeric initials of
 * words in `name`, appends `-<YYYY>`. Falls back to `PRJ-<YYYY>` when the
 * name yields nothing usable. Result always satisfies PROJECT_CODE_REGEX.
 */
export function suggestProjectCode(
  name: string,
  year: number = new Date().getFullYear(),
): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const prefix = initials || "PRJ";
  return `${prefix}-${year}`;
}

// ---------------------------------------------------------------------------
// P-035 — Project selection (template + gates + budget + departments).
// ---------------------------------------------------------------------------

export const PROJECT_PHASES = ["development", "ntp", "cod", "handover"] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const gateSchema = z.object({
  phase: z.enum(PROJECT_PHASES),
  name: z.string().trim().min(1, "Name required").max(120),
  sort_order: z.coerce.number().int().min(0).max(9999),
});
export type Gate = z.infer<typeof gateSchema>;

export const BUDGET_CATEGORIES = ["EPC", "BOS", "DEV", "OWN"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const budgetLineSchema = z.object({
  category: z.string().trim().min(1).max(24),
  code: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(120),
  share: z.coerce.number().min(0).max(1),
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;

export const PROJECT_DEPARTMENTS = [
  "engineering",
  "procurement",
  "construction",
  "hse",
  "finance",
  "legal",
  "om",
  "scada",
  "billing",
] as const;
export type ProjectDepartment = (typeof PROJECT_DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<ProjectDepartment, string> = {
  engineering: "Engineering",
  procurement: "Procurement",
  construction: "Construction",
  hse: "HSE",
  finance: "Finance",
  legal: "Legal",
  om: "O&M",
  scada: "SCADA",
  billing: "Billing",
};

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  development: "Development",
  ntp: "NTP",
  cod: "CoD",
  handover: "Handover",
};

export const departmentEnum = z.enum(PROJECT_DEPARTMENTS);

export const projectSelectionSchema = z.object({
  template_id: z.string().uuid().nullable(),
  gates: z.array(gateSchema).min(1, "At least one gate required"),
  budget_lines: z
    .array(budgetLineSchema)
    .min(1, "At least one budget line required")
    .refine(
      (lines) =>
        Math.abs(lines.reduce((s, l) => s + (l.share ?? 0), 0) - 1) < 0.005,
      "Budget line shares must sum to 100%",
    ),
  departments: z
    .array(departmentEnum)
    .min(1, "Pick at least one department"),
});
export type ProjectSelection = z.infer<typeof projectSelectionSchema>;

export const BLANK_SELECTION: ProjectSelection = {
  template_id: null,
  gates: [{ phase: "development", name: "Kickoff", sort_order: 1 }],
  budget_lines: [
    { category: "EPC", code: "TOT", label: "Total EPC", share: 1 },
  ],
  departments: ["engineering"],
};
