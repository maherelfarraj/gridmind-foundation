// P-106 — Pure schemas + math for work orders.
import { z } from "zod";

export const WORK_ORDER_TYPES = ["preventive", "corrective", "predictive", "inspection"] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_PRIORITIES = ["low", "medium", "high", "emergency"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ORDER_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_SOURCES = ["manual", "pm_plan", "alarm"] as const;
export type WorkOrderSource = (typeof WORK_ORDER_SOURCES)[number];

// ---- line items -----------------------------------------------------------
export const partLineSchema = z.object({
  spare_part_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(240),
  qty: z.number().finite().min(0),
  unit_cost: z.number().finite().min(0),
});
export type PartLine = z.infer<typeof partLineSchema>;

export const laborLineSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  hours: z.number().finite().min(0),
  rate: z.number().finite().min(0),
  date: z.string().min(1), // ISO date
});
export type LaborLine = z.infer<typeof laborLineSchema>;

// ---- server-side money math (2dp round) -----------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTotalCost(parts: readonly PartLine[], labor: readonly LaborLine[]): number {
  const partsSum = parts.reduce((acc, p) => acc + p.qty * p.unit_cost, 0);
  const laborSum = labor.reduce((acc, l) => acc + l.hours * l.rate, 0);
  return round2(partsSum + laborSum);
}

// ---- mutation input schemas ----------------------------------------------
export const workOrderCreateSchema = z.object({
  project_id: z.string().uuid(),
  equipment_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  type: z.enum(WORK_ORDER_TYPES),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  scheduled_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  source: z.enum(WORK_ORDER_SOURCES).optional(),
});
export type WorkOrderCreateInput = z.infer<typeof workOrderCreateSchema>;

export const workOrderAssignSchema = z.object({
  id: z.string().uuid(),
  assigned_to: z.string().uuid().nullable(),
});

export const workOrderStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(WORK_ORDER_STATUSES),
});

export const capturePartsSchema = z.object({
  id: z.string().uuid(),
  parts: z.array(partLineSchema).max(200),
});

export const captureLaborSchema = z.object({
  id: z.string().uuid(),
  labor: z.array(laborLineSchema).max(200),
});

export const workOrderCloseSchema = z
  .object({
    id: z.string().uuid(),
    resolution_notes: z.string().trim().min(3).max(4000),
    failure_cause: z.string().trim().max(2000).optional().nullable(),
    is_corrective: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.is_corrective && (!v.failure_cause || v.failure_cause.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure_cause"],
        message: "failure_cause is required for corrective work orders",
      });
    }
  });

// ---- transition graph -----------------------------------------------------
const ALLOWED: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "on_hold", "open", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  completed: ["closed", "in_progress"],
  closed: [],
  cancelled: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}
