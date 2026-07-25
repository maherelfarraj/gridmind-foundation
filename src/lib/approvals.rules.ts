// P-111 — Approval engine: shared enums, schemas, helpers.
import { z } from "zod";

export const APPROVAL_ROLES = [
  "super_admin",
  "company_admin",
  "billing_admin",
  "project_admin",
  "engineering_admin",
  "procurement_admin",
  "construction_admin",
  "hse_admin",
  "finance_admin",
  "legal_admin",
  "om_admin",
  "scada_admin",
] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export const APPROVAL_ENTITY_TYPES = [
  "purchase_order",
  "proposal_pricing",
  "project_phase_gate",
  "contract",
  "change_order",
  "custom",
] as const;

export const APPROVAL_INSTANCE_STATUSES = [
  "pending",
  "in_progress",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalInstanceStatus = (typeof APPROVAL_INSTANCE_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "skipped"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const chainStepSchema = z.object({
  step_order: z.number().int().min(1),
  role: z.enum(APPROVAL_ROLES),
  sla_hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullable()
    .optional(),
});
export type ChainStepInput = z.infer<typeof chainStepSchema>;

export const approvalRuleInputSchema = z.object({
  id: z.string().uuid().optional(),
  rule_key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscore only"),
  name: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  entity_type: z.string().min(2).max(64),
  threshold_amount: z.number().nonnegative().max(1e12).nullable().optional(),
  threshold_currency: z.string().length(3),
  sla_hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365),
  escalation_role: z.enum(APPROVAL_ROLES).nullable().optional(),
  blocks_export: z.boolean(),
  is_active: z.boolean(),
  steps: z.array(chainStepSchema).min(1),
});
export type ApprovalRuleInput = z.infer<typeof approvalRuleInputSchema>;

export const startApprovalSchema = z.object({
  rule_key: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().uuid(),
  amount: z.number().nonnegative().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const decideApprovalSchema = z
  .object({
    approval_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    comment: z.string().max(4000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.decision !== "rejected" || (typeof v.comment === "string" && v.comment.trim().length > 0),
    { message: "comment_required_on_reject", path: ["comment"] },
  );

export const cancelInstanceSchema = z.object({
  instance_id: z.string().uuid(),
});

export const toggleRuleSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
});
