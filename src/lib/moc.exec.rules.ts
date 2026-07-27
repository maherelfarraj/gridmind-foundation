// P-191 — Controlled change execution: pure rules and schemas (unit-testable).
import { z } from "zod";

export const TASK_STATUSES = ["pending", "done", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ImplementationTask {
  id: string;
  change_request_id: string;
  entity_type: string | null;
  entity_id: string | null;
  owner_role: string;
  title: string;
  status: TaskStatus;
  evidence: Array<{ note: string; by: string | null; at: string }>;
  done_at: string | null;
  created_at: string;
}

/** Progress = tasks resolved (done or skipped) over total. */
export function taskProgress(tasks: Array<{ status: string }>): {
  total: number;
  resolved: number;
  pending: number;
  pct: number;
} {
  const total = tasks.length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const resolved = total - pending;
  return { total, resolved, pending, pct: total === 0 ? 0 : Math.round((resolved / total) * 100) };
}

export function canCloseChange(
  tasks: Array<{ status: string }>,
  evidenceCount: number,
  closureNotes: string,
): boolean {
  return (
    tasks.every((t) => t.status !== "pending") &&
    evidenceCount > 0 &&
    closureNotes.trim().length > 0
  );
}

/** Parse the `open_tasks_remaining:n` postgres error into a friendly message. */
export function parseOpenTasksError(message: string): number | null {
  const m = /open_tasks_remaining:(\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}

export const OWNER_ROLE_LABELS: Record<string, string> = {
  project_admin: "Project admin",
  company_admin: "Company admin",
  procurement_manager: "Procurement",
  engineer: "Engineering",
  site_supervisor: "Site supervision",
  qaqc_inspector: "QA/QC",
  hse_officer: "HSE",
  finance_manager: "Finance",
};

export function ownerRoleLabel(role: string): string {
  return OWNER_ROLE_LABELS[role] ?? role.replaceAll("_", " ");
}

/* -------------------------------------------------------------------------- */
/* Vendor substitution                                                         */
/* -------------------------------------------------------------------------- */

export const EQUIVALENCE_ITEMS = [
  "Electrical ratings match",
  "Mechanical interface compatible",
  "Certifications valid (IEC/UL)",
  "Warranty terms ≥ original",
  "Datasheet attached",
] as const;
export type EquivalenceItem = (typeof EQUIVALENCE_ITEMS)[number];

export const equivalenceRowSchema = z.object({
  item: z.string().trim().min(1).max(120),
  checked: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
});
export type EquivalenceRow = z.infer<typeof equivalenceRowSchema>;

export function defaultEquivalence(): EquivalenceRow[] {
  return EQUIVALENCE_ITEMS.map((item) => ({ item, checked: false, note: "" }));
}

/** Merge stored rows onto the canonical five-item checklist. */
export function normalizeEquivalence(raw: unknown): EquivalenceRow[] {
  const stored = Array.isArray(raw) ? raw : [];
  const index = new Map<string, EquivalenceRow>();
  for (const entry of stored) {
    const parsed = equivalenceRowSchema.safeParse(entry);
    if (parsed.success) index.set(parsed.data.item, parsed.data);
  }
  return EQUIVALENCE_ITEMS.map(
    (item) => index.get(item) ?? { item, checked: false, note: "" },
  );
}

/** All five canonical items must be checked before a substitution may be submitted. */
export function equivalenceComplete(rows: unknown): boolean {
  const normalized = normalizeEquivalence(rows);
  return normalized.length === EQUIVALENCE_ITEMS.length && normalized.every((r) => r.checked);
}

export const substitutionSchema = z.object({
  id: z.string().uuid(),
  old_vendor_id: z.string().uuid().nullish(),
  new_vendor_id: z.string().uuid().nullish(),
  equivalence: z.array(equivalenceRowSchema).max(20).default([]),
});

export const taskStatusSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(["done", "skipped", "pending"]),
  note: z.string().trim().max(1000).default(""),
});

export const closeChangeSchema = z.object({
  id: z.string().uuid(),
  closure_notes: z.string().trim().min(3).max(5000),
  updated_documents: z.array(z.string().trim().max(300)).max(50).default([]),
  updated_asbuilts: z.array(z.string().trim().max(300)).max(50).default([]),
});

/** Entities that carry a change-control banner + server-side block. */
export const CHANGE_CONTROLLED_ENTITIES = [
  "purchase_order",
  "rfq",
  "bom_snapshot",
  "sld_drawing",
  "document",
  "work_order",
] as const;
export type ChangeControlledEntity = (typeof CHANGE_CONTROLLED_ENTITIES)[number];
