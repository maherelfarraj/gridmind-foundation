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
