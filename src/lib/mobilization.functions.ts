// P-084 — Mobilization checklist server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  computeProgress,
  defaultSeedItems,
  deriveChecklistStatus,
  ITEM_STATUSES,
  MOBILIZATION_CATEGORIES,
  MOBILIZATION_STATUSES,
  type ChecklistItem,
  type MobilizationCategory,
  type MobilizationStatus,
  type RosterEntry,
} from "@/lib/mobilization.rules";

// ---------------------------------------------------------------------------
// row type
// ---------------------------------------------------------------------------
export interface MobilizationRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  status: MobilizationStatus;
  items: ChecklistItem[];
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MobilizationHeaderChip {
  status: MobilizationStatus | "none";
}

export interface ProjectPickOption {
  id: string;
  name: string;
  code: string;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function loadChecklistOrThrow(
  context: AuthContext,
  id: string,
): Promise<MobilizationRow> {
  const { data, error } = await context.supabase
    .from("mobilization_checklists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "checklist_not_found");
  return data as MobilizationRow;
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "mobilization_checklists",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
const projectIdInput = z.object({ projectId: z.string().uuid() });
const checklistIdInput = z.object({ checklistId: z.string().uuid() });

const createInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
});

const toggleItemInput = z.object({
  checklistId: z.string().uuid(),
  itemKey: z.string().min(1),
  status: z.enum(ITEM_STATUSES),
  notes: z.string().max(2000).nullable().optional(),
});

const rosterInput = z.object({
  checklistId: z.string().uuid(),
  itemKey: z.string().min(1),
  roster: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        company: z.string().trim().min(1).max(120),
        inducted_at: z.string().min(1),
      }),
    )
    .max(500),
});

const evidenceInput = z.object({
  checklistId: z.string().uuid(),
  itemKey: z.string().min(1),
  evidencePath: z.string().min(1).max(1024),
});

// ---------------------------------------------------------------------------
// project picker (company-scoped, minimal fields)
// ---------------------------------------------------------------------------
export const listCompanyProjectsForMobilization = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ProjectPickOption[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ProjectPickOption[];
  });

// ---------------------------------------------------------------------------
// list + get
// ---------------------------------------------------------------------------
export const listMobilizationChecklists = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("mobilization_checklists")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as MobilizationRow[];
  });

export const getMobilizationChecklist = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => checklistIdInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    return loadChecklistOrThrow(context, data.checklistId);
  });

/**
 * Lightweight header chip for the project detail layout.
 * - "complete": at least one complete checklist exists → chip hidden by UI.
 * - "in_progress" / "not_started": derived from latest non-complete row.
 * - "none": no checklists at all.
 */
export const getMobilizationHeaderChip = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationHeaderChip> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("mobilization_checklists")
      .select("status")
      .eq("project_id", data.projectId);
    if (error) throw error;
    const list = (rows ?? []) as { status: MobilizationStatus }[];
    if (list.length === 0) return { status: "none" };
    if (list.some((r) => r.status === "complete")) return { status: "complete" };
    if (list.some((r) => r.status === "in_progress"))
      return { status: "in_progress" };
    return { status: "not_started" };
  });

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------
export const createMobilizationChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    // Look up project's company for tenancy.
    const { data: proj, error: projErr } = await context.supabase
      .from("projects")
      .select("id, company_id, name")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!proj) httpError(404, "project_not_found");
    const items = defaultSeedItems();
    const name = data.name?.trim() || "Site mobilization";
    const insert = {
      company_id: (proj as any).company_id as string,
      project_id: data.projectId,
      name,
      status: "not_started" as MobilizationStatus,
      items,
      created_by: context.user!.id,
    };
    const { data: row, error } = await context.supabase
      .from("mobilization_checklists")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (error) {
      if ((error as any).code === "23505") httpError(409, "duplicate_name");
      throw error;
    }
    const created = row as MobilizationRow;
    await audit(context, "mobilization.create", created.id, {
      project_id: created.project_id,
      name,
      item_count: items.length,
    });
    return created;
  });

async function persistItemMutation(
  context: AuthContext,
  checklistId: string,
  mutate: (items: ChecklistItem[]) => ChecklistItem[],
): Promise<MobilizationRow> {
  const current = await loadChecklistOrThrow(context, checklistId);
  if (current.status === "complete") httpError(409, "checklist_complete");
  const nextItems = mutate([...current.items]);
  const nextStatus = deriveChecklistStatus(nextItems);
  const started_at =
    current.started_at ?? (nextStatus !== "not_started" ? nowIso() : null);
  const { data: row, error } = await context.supabase
    .from("mobilization_checklists")
    .update({
      items: nextItems as any,
      status: nextStatus,
      started_at,
    } as any)
    .eq("id", checklistId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!row) httpError(404, "checklist_not_found");
  return row as MobilizationRow;
}

export const toggleMobilizationItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => toggleItemInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    const uid = context.user!.id;
    const updated = await persistItemMutation(context, data.checklistId, (items) => {
      const idx = items.findIndex((i) => i.key === data.itemKey);
      if (idx === -1) httpError(404, "item_not_found");
      const cur = items[idx]!;
      const isComplete = data.status === "complete";
      items[idx] = {
        ...cur,
        status: data.status,
        notes: data.notes ?? cur.notes,
        completed_by: isComplete ? uid : null,
        completed_at: isComplete ? nowIso() : null,
      };
      return items;
    });
    await audit(context, "mobilization.item_complete", updated.id, {
      item_key: data.itemKey,
      status: data.status,
    });
    return updated;
  });

export const updateInductionRoster = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => rosterInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    const uid = context.user!.id;
    const updated = await persistItemMutation(context, data.checklistId, (items) => {
      const idx = items.findIndex((i) => i.key === data.itemKey);
      if (idx === -1) httpError(404, "item_not_found");
      const cur = items[idx]!;
      const roster: RosterEntry[] = data.roster;
      // roster length > 0 promotes item to in_progress; leaving completion to explicit toggle.
      const nextItemStatus =
        cur.status === "complete"
          ? "complete"
          : roster.length > 0
            ? "in_progress"
            : "not_started";
      items[idx] = {
        ...cur,
        roster,
        status: nextItemStatus,
        completed_by:
          nextItemStatus === "complete" ? (cur.completed_by ?? uid) : cur.completed_by,
      };
      return items;
    });
    await audit(context, "mobilization.item_complete", updated.id, {
      item_key: data.itemKey,
      roster_size: data.roster.length,
    });
    return updated;
  });

export const attachMobilizationEvidence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evidenceInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    const updated = await persistItemMutation(context, data.checklistId, (items) => {
      const idx = items.findIndex((i) => i.key === data.itemKey);
      if (idx === -1) httpError(404, "item_not_found");
      items[idx] = { ...items[idx]!, evidence_path: data.evidencePath };
      return items;
    });
    await audit(context, "mobilization.item_complete", updated.id, {
      item_key: data.itemKey,
      evidence_path: data.evidencePath,
    });
    return updated;
  });

export const completeMobilizationChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => checklistIdInput.parse(input))
  .handler(async ({ data, context }): Promise<MobilizationRow> => {
    requireSupabaseAuth(context);
    const current = await loadChecklistOrThrow(context, data.checklistId);
    if (current.status === "complete") return current;
    const progress = computeProgress(current.items);
    if (!progress.allRequiredDone) {
      httpError(422, "required_items_incomplete", "Required items are not complete");
    }
    const { data: row, error } = await context.supabase
      .from("mobilization_checklists")
      .update({
        status: "complete" as MobilizationStatus,
        completed_at: nowIso(),
      } as any)
      .eq("id", data.checklistId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "checklist_not_found");
    const done = row as MobilizationRow;
    await audit(context, "mobilization.complete", done.id, {
      project_id: done.project_id,
    });
    return done;
  });

// Re-export enum tuples for consumers that don't want to import rules directly.
export { MOBILIZATION_CATEGORIES, MOBILIZATION_STATUSES };
