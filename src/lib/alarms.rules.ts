// P-105 — Pure helpers for the alarm rules engine (evaluator + hysteresis + schemas).
import { z } from "zod";

import { TELEMETRY_METRICS } from "@/lib/telemetry-ingest";

export const ALARM_CONDITIONS = ["gt", "gte", "lt", "lte", "eq", "ne"] as const;
export type AlarmCondition = (typeof ALARM_CONDITIONS)[number];

export const ALARM_SEVERITIES = ["info", "warning", "major", "critical"] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];

export const ALARM_STATUSES = ["active", "acknowledged", "cleared"] as const;
export type AlarmStatus = (typeof ALARM_STATUSES)[number];

// Roles that make sense as notify targets. Kept in sync with public.app_role.
export const NOTIFY_ROLES = [
  "om_admin",
  "scada_admin",
  "company_admin",
  "project_admin",
  "engineering_admin",
  "hse_admin",
  "field_technician",
  "foreman",
] as const;
export type NotifyRole = (typeof NOTIFY_ROLES)[number];

/** Does `value` breach `threshold` under the given condition? */
export function evaluateCondition(
  condition: AlarmCondition,
  value: number,
  threshold: number,
): boolean {
  switch (condition) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "ne":
      return value !== threshold;
  }
}

/**
 * Hysteresis clear. An alarm only clears when the value moves BACK past
 * `threshold ∓ dead_band` in the safe direction. E.g. rule `lt 100` with
 * dead_band 20 stays active while value < 120, clears when value >= 120.
 */
export function hasCleared(
  condition: AlarmCondition,
  value: number,
  threshold: number,
  deadBand: number,
): boolean {
  const db = Math.max(0, deadBand);
  switch (condition) {
    case "gt":
    case "gte":
      // breach: value above threshold; clear when value <= threshold - db
      return value <= threshold - db;
    case "lt":
    case "lte":
      // breach: value below threshold; clear when value >= threshold + db
      return value >= threshold + db;
    case "eq":
      return value !== threshold && Math.abs(value - threshold) > db;
    case "ne":
      return value === threshold;
  }
}

export const escalationStepSchema = z.object({
  after_minutes: z.number().int().min(0).max(60 * 24 * 30),
  notify_role: z.enum(NOTIFY_ROLES),
});
export const escalationRouteSchema = z.array(escalationStepSchema).max(10);
export type EscalationStep = z.infer<typeof escalationStepSchema>;

export const alarmRuleInputSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  metric: z.enum(TELEMETRY_METRICS),
  condition: z.enum(ALARM_CONDITIONS),
  threshold: z.number().finite(),
  dead_band: z.number().finite().min(0).default(0),
  duration_seconds: z.number().int().min(0).max(60 * 60 * 24).default(0),
  severity: z.enum(ALARM_SEVERITIES).default("warning"),
  escalation_route: escalationRouteSchema.default([]),
  enabled: z.boolean().default(true),
});
export type AlarmRuleInput = z.infer<typeof alarmRuleInputSchema>;

export const acknowledgeInputSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(3, "Note is required").max(500),
});
