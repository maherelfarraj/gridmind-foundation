// P-107 — Pure schemas + defaults for preventive maintenance plans.
import { z } from "zod";

export const PM_FREQUENCIES = ["weekly", "monthly", "quarterly", "semiannual", "annual"] as const;
export type PmFrequency = (typeof PM_FREQUENCIES)[number];

export const FREQUENCY_DEFAULT_DAYS: Record<PmFrequency, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  annual: 365,
};

export const pmChecklistStepSchema = z.object({
  step: z.string().trim().min(1).max(400),
  required: z.boolean().default(true),
});
export type PmChecklistStep = z.infer<typeof pmChecklistStepSchema>;

export const pmPlanUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  equipment_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  frequency: z.enum(PM_FREQUENCIES),
  interval_days: z.number().int().min(1).max(3650),
  next_due_date: z.string().min(1), // ISO date
  checklist: z.array(pmChecklistStepSchema).max(200).default([]),
  estimated_hours: z.number().finite().min(0).max(9999).nullable().optional(),
  default_assignee: z.string().uuid().nullable().optional(),
  auto_generate: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type PmPlanUpsertInput = z.infer<typeof pmPlanUpsertSchema>;

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
