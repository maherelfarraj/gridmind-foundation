// P-191 — Controlled change execution: server-only helpers.
// Kept out of *.functions.ts so tss-serverfn-split cannot drop them.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { httpError } from "@/lib/moc.server";
import {
  equivalenceComplete,
  normalizeEquivalence,
  type EquivalenceRow,
  type ImplementationTask,
} from "@/lib/moc.exec.rules";

const CONTROLLING_STATUSES = ["assessment", "approved", "implementing"];

export interface BlockingChange {
  id: string;
  cr_number: string;
  title: string;
  status: string;
  change_type: string;
}

export async function loadTasks(
  context: AuthContext,
  changeRequestId: string,
): Promise<ImplementationTask[]> {
  const { data, error } = await context.supabase
    .from("moc_implementation_tasks")
    .select(
      "id, change_request_id, entity_type, entity_id, owner_role, title, status, evidence, done_at, created_at",
    )
    .eq("change_request_id", changeRequestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as ImplementationTask[]).map((row) => ({
    ...row,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
  }));
}

export async function generateTasks(context: AuthContext, crId: string): Promise<number> {
  const { data, error } = await context.supabase.rpc("generate_implementation_tasks", {
    p_change_request_id: crId,
  });
  if (error) httpError(400, error.message, error.message);
  return Number(data ?? 0);
}

export async function setTaskStatus(
  context: AuthContext,
  input: { task_id: string; status: "done" | "skipped" | "pending"; note: string },
): Promise<ImplementationTask> {
  const { data: current, error: readErr } = await context.supabase
    .from("moc_implementation_tasks")
    .select("id, evidence, change_request_id")
    .eq("id", input.task_id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) httpError(404, "task_not_found");
  const row = current as unknown as { evidence: unknown; change_request_id: string };

  if (input.status === "done" && input.note.trim().length === 0) {
    httpError(400, "evidence_required", "An evidence note is required to complete a task.");
  }

  const evidence = Array.isArray(row.evidence) ? (row.evidence as unknown[]) : [];
  const nextEvidence =
    input.note.trim().length > 0
      ? [
          ...evidence,
          { note: input.note.trim(), by: context.user!.id, at: new Date().toISOString() },
        ]
      : evidence;

  const { data: updated, error } = await context.supabase
    .from("moc_implementation_tasks")
    .update({
      status: input.status,
      evidence: nextEvidence,
      done_by: input.status === "pending" ? null : context.user!.id,
      done_at: input.status === "pending" ? null : new Date().toISOString(),
    } as never)
    .eq("id", input.task_id)
    .select(
      "id, change_request_id, entity_type, entity_id, owner_role, title, status, evidence, done_at, created_at",
    )
    .single();
  if (error) {
    if ((error as { code?: string }).code === "42501") httpError(403, "forbidden");
    throw error;
  }
  return updated as unknown as ImplementationTask;
}

export async function closeChange(
  context: AuthContext,
  input: {
    id: string;
    closure_notes: string;
    updated_documents: string[];
    updated_asbuilts: string[];
  },
): Promise<void> {
  const { error } = await context.supabase.rpc("close_change_request", {
    p_id: input.id,
    p_closure_notes: input.closure_notes,
    p_updated_documents: input.updated_documents as never,
    p_updated_asbuilts: input.updated_asbuilts as never,
  });
  if (error) httpError(409, error.message, error.message);
}

/* -------------------------------------------------------------------------- */
/* Change-control blocking                                                     */
/* -------------------------------------------------------------------------- */

export async function underChangeControl(
  context: AuthContext,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("is_under_change_control", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) throw error;
  return data === true;
}

/** The open change requests that freeze a given record, for the amber banner. */
export async function blockingChanges(
  context: AuthContext,
  entityType: string,
  entityId: string,
): Promise<BlockingChange[]> {
  const { data: open, error } = await context.supabase
    .from("change_requests")
    .select("id, cr_number, title, status, change_type, affected_systems")
    .in("status", CONTROLLING_STATUSES);
  if (error) throw error;

  const rows = (open ?? []) as unknown as Array<BlockingChange & { affected_systems: unknown }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hit = new Map<string, BlockingChange>();

  for (const row of rows) {
    const systems = Array.isArray(row.affected_systems) ? row.affected_systems : [];
    const matches = (systems as Array<Record<string, unknown>>).some(
      (s) => s?.entity_type === entityType && s?.entity_id === entityId,
    );
    if (matches) {
      hit.set(row.id, {
        id: row.id,
        cr_number: row.cr_number,
        title: row.title,
        status: row.status,
        change_type: row.change_type,
      });
    }
  }

  const { data: links } = await context.supabase
    .from("entity_links")
    .select("source_id")
    .eq("source_type", "change_request")
    .eq("link_type", "impacts")
    .eq("target_type", entityType)
    .eq("target_id", entityId);
  for (const link of (links ?? []) as Array<{ source_id: string }>) {
    const row = byId.get(link.source_id);
    if (row) {
      hit.set(row.id, {
        id: row.id,
        cr_number: row.cr_number,
        title: row.title,
        status: row.status,
        change_type: row.change_type,
      });
    }
  }
  return Array.from(hit.values());
}

async function isCompanyAdmin(context: AuthContext): Promise<boolean> {
  const { data } = await context.supabase.rpc("has_company_role", { p_role: "company_admin" });
  return data === true;
}

/**
 * Server-side re-check used by issuePo / issueRfq.
 * Blocks with 409 `under_change_control` unless a company admin supplies a reason,
 * in which case a `moc.override` audit row is written.
 */
export async function assertNotUnderChangeControl(
  context: AuthContext,
  entityType: string,
  entityId: string,
  overrideReason?: string | null,
): Promise<void> {
  const blocked = await underChangeControl(context, entityType, entityId);
  if (!blocked) return;

  const reason = overrideReason?.trim() ?? "";
  if (reason.length === 0) {
    httpError(
      409,
      "under_change_control",
      "This record is frozen by an open change request. Close the change, or override with a reason.",
    );
  }
  if (!(await isCompanyAdmin(context))) {
    httpError(403, "override_forbidden", "Only company admins can override change control.");
  }
  const crs = await blockingChanges(context, entityType, entityId);
  await context.supabase.rpc("write_audit_log", {
    p_action: "moc.override",
    p_entity: entityType,
    p_entity_id: entityId,
    p_metadata: {
      reason,
      change_requests: crs.map((c) => c.cr_number),
    } as never,
  });
}

/* -------------------------------------------------------------------------- */
/* Vendor substitution                                                         */
/* -------------------------------------------------------------------------- */

export interface SubstitutionState {
  old_vendor_id: string | null;
  new_vendor_id: string | null;
  equivalence: EquivalenceRow[];
  vendors: Array<{ id: string; name: string; status: string }>;
  suggestedPackages: Array<{
    id: string;
    kind: "purchase_order" | "rfq";
    label: string;
    status: string;
  }>;
}

export async function loadSubstitution(
  context: AuthContext,
  crId: string,
): Promise<SubstitutionState> {
  const { data: cr, error } = await context.supabase
    .from("change_requests")
    .select("metadata, project_id")
    .eq("id", crId)
    .maybeSingle();
  if (error) throw error;
  if (!cr) httpError(404, "not_found");
  const meta = ((cr as { metadata: unknown }).metadata ?? {}) as Record<string, unknown>;
  const projectId = (cr as { project_id: string | null }).project_id;
  const oldVendorId = (meta.old_vendor_id as string | null) ?? null;

  const { data: vendors } = await context.supabase
    .from("vendors")
    .select("id, name, status")
    .order("name", { ascending: true });

  const suggested: SubstitutionState["suggestedPackages"] = [];
  if (oldVendorId) {
    let poQuery = context.supabase
      .from("purchase_orders")
      .select("id, po_number, status, project_id")
      .eq("vendor_id", oldVendorId);
    if (projectId) poQuery = poQuery.eq("project_id", projectId);
    const { data: pos } = await poQuery;
    for (const po of (pos ?? []) as Array<{ id: string; po_number: string; status: string }>) {
      suggested.push({ id: po.id, kind: "purchase_order", label: po.po_number, status: po.status });
    }

    const { data: bids } = await context.supabase
      .from("rfq_bids")
      .select("rfq_id, rfqs(id, rfq_number, status, project_id)")
      .eq("vendor_id", oldVendorId);
    for (const bid of (bids ?? []) as Array<{
      rfqs: { id: string; rfq_number: string | null; status: string; project_id: string } | null;
    }>) {
      const rfq = bid.rfqs;
      if (!rfq) continue;
      if (projectId && rfq.project_id !== projectId) continue;
      if (suggested.some((s) => s.id === rfq.id)) continue;
      suggested.push({
        id: rfq.id,
        kind: "rfq",
        label: rfq.rfq_number ?? "Draft RFQ",
        status: rfq.status,
      });
    }
  }

  return {
    old_vendor_id: oldVendorId,
    new_vendor_id: (meta.new_vendor_id as string | null) ?? null,
    equivalence: normalizeEquivalence(meta.equivalence),
    vendors: (vendors ?? []) as Array<{ id: string; name: string; status: string }>,
    suggestedPackages: suggested,
  };
}

export async function saveSubstitution(
  context: AuthContext,
  input: {
    id: string;
    old_vendor_id?: string | null;
    new_vendor_id?: string | null;
    equivalence: EquivalenceRow[];
  },
): Promise<void> {
  const { data: cr, error: readErr } = await context.supabase
    .from("change_requests")
    .select("metadata, status")
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!cr) httpError(404, "not_found");
  const row = cr as { metadata: unknown; status: string };
  if (row.status !== "draft") httpError(409, "not_draft");
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const { error } = await context.supabase
    .from("change_requests")
    .update({
      metadata: {
        ...meta,
        old_vendor_id: input.old_vendor_id ?? null,
        new_vendor_id: input.new_vendor_id ?? null,
        equivalence: normalizeEquivalence(input.equivalence),
      },
    } as never)
    .eq("id", input.id);
  if (error) throw error;
}

/** Re-validated server-side before a vendor substitution may be submitted. */
export async function assertSubstitutionReady(context: AuthContext, crId: string): Promise<void> {
  const { data, error } = await context.supabase
    .from("change_requests")
    .select("change_type, metadata")
    .eq("id", crId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  const row = data as { change_type: string; metadata: unknown };
  if (row.change_type !== "vendor_substitution") return;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  if (!meta.new_vendor_id) {
    httpError(400, "new_vendor_required", "Pick the replacement vendor first.");
  }
  if (!equivalenceComplete(meta.equivalence)) {
    httpError(
      400,
      "equivalence_incomplete",
      "All five technical equivalence checks must be confirmed before submitting.",
    );
  }
}

/**
 * On closure of a vendor substitution, record the permanent supersedes link
 * old vendor → new vendor so the digital thread keeps the history.
 */
export async function writeSupersedesLinks(context: AuthContext, crId: string): Promise<void> {
  const { data } = await context.supabase
    .from("change_requests")
    .select("change_type, company_id, metadata")
    .eq("id", crId)
    .maybeSingle();
  if (!data) return;
  const row = data as { change_type: string; company_id: string; metadata: unknown };
  if (row.change_type !== "vendor_substitution") return;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const oldId = meta.old_vendor_id as string | undefined;
  const newId = meta.new_vendor_id as string | undefined;
  if (!oldId || !newId) return;
  await context.supabase.rpc("link_entities", {
    p_source_type: "vendor",
    p_source_id: newId,
    p_link_type: "supersedes",
    p_target_type: "vendor",
    p_target_id: oldId,
    p_company_id: row.company_id,
    p_metadata: { change_request_id: crId } as never,
  });
}
