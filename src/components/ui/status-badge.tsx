// POL-3 — Canonical status badge. ONE semantic status→tone map for the whole app.
// Never write a bespoke badge colour: add the status key here instead.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "active" | "positive" | "neutral" | "attention" | "critical" | "inactive";

/** Tone → Badge variant. Defined once so every module renders identically. */
const TONE_VARIANT: Record<
  StatusTone,
  "soft" | "success" | "muted" | "warning" | "danger" | "mutedOutline"
> = {
  active: "soft",
  positive: "success",
  neutral: "muted",
  attention: "warning",
  critical: "danger",
  inactive: "mutedOutline",
};

/** Canonical status → tone map. Keys are normalised (lowercase, `_` separated). */
export const STATUS_TONES: Record<string, StatusTone> = {
  // active / in-flight
  active: "active",
  open: "active",
  in_progress: "active",
  in_review: "active",
  ongoing: "active",
  issued: "active",
  running: "active",
  assigned: "active",
  acknowledged: "active",
  development: "active",
  engineering: "active",
  procurement: "active",
  construction: "active",
  commissioning: "active",
  operations: "active",

  // positive / done
  approved: "positive",
  passed: "positive",
  pass: "positive",
  complete: "positive",
  completed: "positive",
  closed: "positive",
  received: "positive",
  resolved: "positive",
  verified: "positive",
  signed: "positive",
  released: "positive",
  healthy: "positive",
  cleared: "positive",
  compliant: "positive",
  accepted: "positive",
  paid: "positive",
  awarded: "positive",
  certified: "positive",
  on_track: "positive",
  on_target: "positive",
  confirmed: "positive",
  matched: "positive",
  delivered: "positive",
  submitted: "positive",
  cod: "positive",
  ntp: "positive",

  // neutral / not started
  pending: "neutral",
  scheduled: "neutral",
  draft: "neutral",
  planned: "neutral",
  new: "neutral",
  queued: "neutral",
  not_started: "neutral",
  unassigned: "neutral",
  info: "neutral",
  todo: "neutral",

  // attention / warning
  warning: "attention",
  at_risk: "attention",
  expiring: "attention",
  expiring_soon: "attention",
  pending_approval: "attention",
  awaiting_approval: "attention",
  on_hold: "attention",
  hold: "attention",
  partially_received: "attention",
  partial: "attention",
  minor: "attention",
  major: "attention",
  degraded: "attention",
  escalated: "attention",
  revise: "attention",
  revise_resubmit: "attention",
  needs_attention: "attention",
  due_soon: "attention",
  conditional: "attention",
  watch: "attention",
  approved_with_variance: "attention",
  under_review: "attention",
  invited: "attention",

  // critical
  rejected: "critical",
  failed: "critical",
  fail: "critical",
  blocked: "critical",
  breached: "critical",
  overdue: "critical",
  critical: "critical",
  emergency: "critical",
  expired: "critical",
  non_compliant: "critical",
  stopped: "critical",
  terminated: "critical",
  error: "critical",
  a: "critical",
  has_defects: "critical",
  variance_blocked: "critical",
  delayed: "critical",
  underperforming: "critical",

  // inactive / terminal-but-not-success
  locked: "inactive",
  superseded: "inactive",
  cancelled: "inactive",
  canceled: "inactive",
  archived: "inactive",
  withdrawn: "inactive",
  void: "inactive",
  waived: "inactive",
  inactive: "inactive",
  handover: "inactive",
  suspended: "inactive",
};

export function normalizeStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Resolve any raw status string to its canonical tone. */
export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONES[normalizeStatus(status)] ?? "neutral";
}

/** Human label: "pending_approval" → "Pending approval". */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  const s = normalizeStatus(status).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface StatusBadgeProps {
  /** Raw status/severity/phase value from the database. */
  status: string | null | undefined;
  /** Override the displayed text (tone still derives from `status`). */
  label?: ReactNode;
  /** Force a tone when the value is contextual (e.g. a computed "overdue"). */
  tone?: StatusTone;
  icon?: LucideIcon;
  className?: string;
}

export function StatusBadge({ status, label, tone, icon: Icon, className }: StatusBadgeProps) {
  const resolved = tone ?? statusTone(status);
  return (
    <Badge
      variant={TONE_VARIANT[resolved]}
      className={cn("gap-1 whitespace-nowrap font-medium", className)}
    >
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      {label ?? statusLabel(status)}
    </Badge>
  );
}
