// P-190 — Management of Change server functions (thin wrapper: imports + declarations only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  createChangeSchema,
  evidenceSchema,
  listChangesSchema,
  transitionSchema,
  updateImpactsSchema,
} from "@/lib/moc.rules";
import { assertSubstitutionReady } from "@/lib/moc.exec.server";
import {

  assertInternal,
  auditMoc,
  getChangeDetail,
  httpError,
  listChanges,
  listProjectOptions,
  loadDashboard,
  mocCompanyId,
  type ChangeDetail,
} from "@/lib/moc.server";

export const listChangeRequests = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listChangesSchema.parse(raw ?? {}))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return listChanges(context, data);
  });

export const listChangeProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return { rows: await listProjectOptions(context) };
  });

export const getChangeRequest = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<ChangeDetail> => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return getChangeDetail(context, data.id);
  });

export const createChangeRequest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => createChangeSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const companyId = await mocCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("change_requests")
      .insert({
        company_id: companyId,
        project_id: data.project_id ?? null,
        change_type: data.change_type,
        title: data.title,
        description: data.description,
        reason: data.reason,
        originator_id: context.user.id,
        created_by: context.user.id,
      } as never)
      .select("id, cr_number")
      .single();
    if (error) throw error;
    const created = row as unknown as { id: string; cr_number: string };
    await auditMoc(context, "moc.created", created.id, {
      cr_number: created.cr_number,
      change_type: data.change_type,
    });
    return created;
  });

export const updateChangeImpacts = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => updateImpactsSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const { id, affected_systems, ...fields } = data;
    const { data: current, error: readErr } = await context.supabase
      .from("change_requests")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) httpError(404, "not_found");
    if ((current as { status: string }).status !== "draft") httpError(409, "not_draft");

    const patch: Record<string, unknown> = { ...fields };
    if (affected_systems) patch.affected_systems = affected_systems;
    const { error } = await context.supabase
      .from("change_requests")
      .update(patch as never)
      .eq("id", id);
    if (error) throw error;
    await auditMoc(context, "moc.impacts_updated", id, { fields: Object.keys(patch) });
    return { ok: true };
  });

export const submitChangeRequest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    await assertSubstitutionReady(context, data.id);
    const { data: result, error } = await context.supabase.rpc("submit_change_request", {
      p_id: data.id,
    });
    if (error) httpError(400, error.message, error.message);

    await auditMoc(context, "moc.submitted", data.id, {});
    return { result };
  });

export const transitionChangeRequest = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => transitionSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const payload: Record<string, unknown> = {};
    if (data.rejection_reason) payload.rejection_reason = data.rejection_reason;
    if (data.closure_notes) payload.closure_notes = data.closure_notes;
    if (data.updated_documents) payload.updated_documents = data.updated_documents;
    if (data.updated_asbuilts) payload.updated_asbuilts = data.updated_asbuilts;
    const { data: result, error } = await context.supabase.rpc("transition_change_request", {
      p_id: data.id,
      p_to: data.to,
      p_payload: payload as never,
    });
    if (error) httpError(400, error.message, error.message);
    await auditMoc(context, `moc.transition.${data.to}`, data.id, payload);
    return { result };
  });

export const addChangeEvidence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => evidenceSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const { data: current, error: readErr } = await context.supabase
      .from("change_requests")
      .select("implementation_evidence, status")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) httpError(404, "not_found");
    const row = current as { implementation_evidence: unknown; status: string };
    if (row.status !== "implementing") httpError(409, "not_implementing");
    const existing = Array.isArray(row.implementation_evidence) ? row.implementation_evidence : [];
    const entry = {
      path: data.path,
      filename: data.filename,
      size: data.size ?? null,
      uploaded_by: context.user.id,
      uploaded_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("change_requests")
      .update({ implementation_evidence: [...existing, entry] } as never)
      .eq("id", data.id);
    if (error) throw error;
    await auditMoc(context, "moc.evidence_added", data.id, { filename: data.filename });
    return { entry };
  });

export const signChangeEvidenceUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ path: z.string().min(3).max(400) }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(data.path, 300);
    if (error) throw error;
    return { url: signed?.signedUrl ?? null };
  });

export const getMocDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    await assertInternal(context);
    return loadDashboard(context);
  });
