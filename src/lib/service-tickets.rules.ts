// P-109 — Service tickets & SLA pure schemas, timers, credit math.
import { z } from "zod";

import { WORK_ORDER_PRIORITIES, type WorkOrderPriority } from "@/lib/work-orders.rules";

export const TICKET_CATEGORIES = [
  "corrective",
  "inspection",
  "warranty",
  "monitoring",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_client",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// ---- SLA policy map --------------------------------------------------------
export interface SlaPolicy {
  responseMinutes: number;
  resolutionMinutes: number;
}

export const SLA_POLICY: Record<WorkOrderPriority, SlaPolicy> = {
  emergency: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
  high: { responseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
  medium: { responseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
  low: { responseMinutes: 24 * 60, resolutionMinutes: 168 * 60 },
};

// Credit tiers (constants editable later)
export const CREDIT_RESPONSE_PCT = 5;
export const CREDIT_RESOLUTION_PCT = 10;
export const CREDIT_CAP_PCT = 20;

export function computeDueDates(
  priority: WorkOrderPriority,
  createdAtISO: string,
): { response_due_at: string; resolution_due_at: string } {
  const policy = SLA_POLICY[priority];
  const start = new Date(createdAtISO).getTime();
  return {
    response_due_at: new Date(start + policy.responseMinutes * 60_000).toISOString(),
    resolution_due_at: new Date(start + policy.resolutionMinutes * 60_000).toISOString(),
  };
}

export interface SlaSnapshot {
  response_due_at: string;
  resolution_due_at: string;
  responded_at: string | null;
  resolved_at: string | null;
}

export interface BreachEval {
  response_breached: boolean;
  resolution_breached: boolean;
  breach_minutes: number;
}

/**
 * Evaluate SLA breach flags at `now`.
 * response_breached: not responded and now > response_due_at,
 *                    OR responded_at > response_due_at.
 * resolution_breached: not resolved and now > resolution_due_at,
 *                    OR resolved_at > resolution_due_at.
 * breach_minutes: sum of minutes past each breached deadline (each capped at 0).
 */
export function evaluateBreach(sla: SlaSnapshot, now: Date = new Date()): BreachEval {
  const nowMs = now.getTime();
  const responseDue = new Date(sla.response_due_at).getTime();
  const resolutionDue = new Date(sla.resolution_due_at).getTime();

  const respondedMs = sla.responded_at ? new Date(sla.responded_at).getTime() : null;
  const resolvedMs = sla.resolved_at ? new Date(sla.resolved_at).getTime() : null;

  const responseBreachedAt = respondedMs != null ? respondedMs : nowMs;
  const responseBreached =
    (respondedMs == null && nowMs > responseDue) ||
    (respondedMs != null && respondedMs > responseDue);

  const resolutionBreachedAt = resolvedMs != null ? resolvedMs : nowMs;
  const resolutionBreached =
    (resolvedMs == null && nowMs > resolutionDue) ||
    (resolvedMs != null && resolvedMs > resolutionDue);

  let breach_minutes = 0;
  if (responseBreached) {
    breach_minutes += Math.max(0, Math.floor((responseBreachedAt - responseDue) / 60_000));
  }
  if (resolutionBreached) {
    breach_minutes += Math.max(0, Math.floor((resolutionBreachedAt - resolutionDue) / 60_000));
  }

  return {
    response_breached: responseBreached,
    resolution_breached: resolutionBreached,
    breach_minutes,
  };
}

// ---- credits ---------------------------------------------------------------
export interface CreditResult {
  credit_pct: number;
  credit_amount: number | null;
}

/**
 * SLA credit: response breach → 5%, resolution breach → 10%, cap 20%.
 * credit_amount = monthlyFee × credit_pct / 100 when monthlyFee is provided.
 */
export function computeCredit(opts: {
  response_breached: boolean;
  resolution_breached: boolean;
  monthlyFee?: number | null;
}): CreditResult {
  let pct = 0;
  if (opts.response_breached) pct += CREDIT_RESPONSE_PCT;
  if (opts.resolution_breached) pct += CREDIT_RESOLUTION_PCT;
  if (pct > CREDIT_CAP_PCT) pct = CREDIT_CAP_PCT;
  const fee = opts.monthlyFee ?? null;
  const amount = fee != null && fee >= 0 ? Number(((fee * pct) / 100).toFixed(2)) : null;
  return { credit_pct: pct, credit_amount: amount };
}

// ---- countdown classifier --------------------------------------------------
export type CountdownStatus = "on_track" | "warning" | "breached";

/**
 * Classify the remaining time for a countdown chip.
 * warning triggers when less than 25% of the total SLA window remains.
 */
export function classifyCountdown(opts: { createdAtISO: string; dueAtISO: string; now?: Date }): {
  status: CountdownStatus;
  msRemaining: number;
} {
  const created = new Date(opts.createdAtISO).getTime();
  const due = new Date(opts.dueAtISO).getTime();
  const now = (opts.now ?? new Date()).getTime();
  const total = Math.max(1, due - created);
  const remaining = due - now;
  if (remaining <= 0) return { status: "breached", msRemaining: remaining };
  if (remaining / total < 0.25) return { status: "warning", msRemaining: remaining };
  return { status: "on_track", msRemaining: remaining };
}

export function formatDuration(ms: number): string {
  const absMs = Math.abs(ms);
  const totalMinutes = Math.floor(absMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const sign = ms < 0 ? "-" : "";
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  return `${sign}${minutes}m`;
}

// ---- schemas ---------------------------------------------------------------
export const serviceTicketCreateSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.enum(TICKET_CATEGORIES).default("corrective"),
  priority: z.enum(WORK_ORDER_PRIORITIES).default("medium"),
  assigned_to: z.string().uuid().nullable().optional(),
  related_work_order_id: z.string().uuid().nullable().optional(),
});
export type ServiceTicketCreateInput = z.infer<typeof serviceTicketCreateSchema>;

export const serviceTicketUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  related_work_order_id: z.string().uuid().nullable().optional(),
});
export type ServiceTicketUpdateInput = z.infer<typeof serviceTicketUpdateSchema>;

export const applySlaCreditSchema = z.object({
  ticket_id: z.string().uuid(),
  monthly_fee: z.number().finite().min(0),
  currency_code: z.string().length(3).nullable().optional(),
});
export type ApplySlaCreditInput = z.infer<typeof applySlaCreditSchema>;
