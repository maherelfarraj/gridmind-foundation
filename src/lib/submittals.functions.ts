// P-091 — Submittal server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  canWriteSubmittal,
  nextRevisionLabel,
  nextSubmittalNumber,
  REVIEW_DECISIONS,
  submittalCreateInput,
  submittalReviewInput,
  submittalReviseInput,
  SUBMITTAL_STATUSES,
  type SubmittalStatus,
} from "@/lib/submittals.rules";

export interface SubmittalRow {
  id: string;
  company_id: string;
  project_id: string;
  submittal_number: string;
  title: string;
  spec_section: string | null;
  revision: string;
  status: SubmittalStatus;
  due_date: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  file_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface SubmittalListItem extends SubmittalRow {
  project_name: string | null;
  project_code: string | null;
}
export interface SubmittalDetail {
  submittal: SubmittalListItem;
  revisions: SubmittalListItem[];
  file_url: string | null;
  permissions: { canWrite: boolean };
}

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
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best effort */
  }
}

function mapRow(r: any): SubmittalListItem {
  return {
    ...(r as SubmittalRow),
    project_name: r.projects?.name ?? null,
    project_code: r.projects?.code ?? null,
  };
}

async function allocateSubmittalNumber(
  context: AuthContext,
  companyId: string,
  projectId: string,
): Promise<string> {
  const { data, error } = await context.supabase
    .from("submittals")
    .select("submittal_number")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("submittal_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = ((data ?? []) as { submittal_number: string }[]).map(
    (r) => r.submittal_number,
  );
  return nextSubmittalNumber(list);
}

const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(SUBMITTAL_STATUSES).nullable().optional(),
  search: z.string().trim().max(200).nullable().optional(),
});

export const listSubmittals = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<SubmittalListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("submittals")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("submittal_number", { ascending: false })
      .order("revision", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    const term = (data.search ?? "").toLowerCase();
    const mapped = (rows ?? []).map(mapRow);
    if (!term) return mapped;
    return mapped.filter(
      (r) =>
        r.submittal_number.toLowerCase().includes(term) ||
        r.title.toLowerCase().includes(term) ||
        (r.spec_section ?? "").toLowerCase().includes(term),
    );
  });

export const getSubmittal = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<SubmittalDetail> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("submittals")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "submittal_not_found");
    const submittal = mapRow(row);

    const { data: revRows, error: rErr } = await context.supabase
      .from("submittals")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .eq("project_id", submittal.project_id)
      .eq("submittal_number", submittal.submittal_number)
      .order("revision", { ascending: true });
    if (rErr) throw rErr;
    const revisions = (revRows ?? []).map(mapRow);

    let file_url: string | null = null;
    if (submittal.file_path) {
      const { data: signed } = await context.supabase.storage
        .from("documents")
        .createSignedUrl(submittal.file_path, 600);
      file_url = signed?.signedUrl ?? null;
    }

    const roles = await currentRoles(context);
    return {
      submittal,
      revisions,
      file_url,
      permissions: { canWrite: canWriteSubmittal(roles) },
    };
  });

export const createSubmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => submittalCreateInput.parse(raw))
  .handler(async ({ data, context }): Promise<SubmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteSubmittal(roles)) httpError(403, "forbidden");

    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(400, "invalid_project");

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const number = await allocateSubmittalNumber(
        context,
        companyId,
        data.projectId,
      );
      const insertRow = {
        company_id: companyId,
        project_id: data.projectId,
        submittal_number: number,
        title: data.title,
        spec_section: data.specSection ?? null,
        revision: "R0",
        status: "draft",
        due_date: data.dueDate ?? null,
        file_path: data.filePath ?? null,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("submittals")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (!error && inserted) {
        await audit(
          context,
          "submittal.create",
          "submittals",
          (inserted as any).id,
          {
            submittal_number: number,
            project_id: data.projectId,
          },
        );
        return inserted as unknown as SubmittalRow;
      }
      lastErr = error;
      if ((error as any)?.code !== "23505") break;
    }
    throw lastErr ?? new Error("create_failed");
  });

export const submitSubmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<SubmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteSubmittal(roles)) httpError(403, "forbidden");

    const { data: updated, error } = await context.supabase
      .from("submittals")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "submittal_not_found");
    await audit(context, "submittal.submit", "submittals", data.id, {});
    return updated as unknown as SubmittalRow;
  });

export const reviewSubmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => submittalReviewInput.parse(raw))
  .handler(async ({ data, context }): Promise<SubmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteSubmittal(roles)) httpError(403, "forbidden");

    const patch: Record<string, unknown> = {
      status: data.status,
      reviewed_by: context.user!.id,
      reviewed_at: new Date().toISOString(),
      review_notes: data.reviewNotes ?? null,
    };
    const { data: updated, error } = await context.supabase
      .from("submittals")
      .update(patch as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "submittal_not_found");
    await audit(context, "submittal.review", "submittals", data.id, {
      status: data.status,
    });
    return updated as unknown as SubmittalRow;
  });

export const reviseSubmittal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => submittalReviseInput.parse(raw))
  .handler(async ({ data, context }): Promise<SubmittalRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteSubmittal(roles)) httpError(403, "forbidden");

    const { data: parent, error: pErr } = await context.supabase
      .from("submittals")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!parent) httpError(404, "submittal_not_found");

    const { data: sibs, error: sErr } = await context.supabase
      .from("submittals")
      .select("revision")
      .eq("company_id", companyId)
      .eq("project_id", (parent as any).project_id)
      .eq("submittal_number", (parent as any).submittal_number);
    if (sErr) throw sErr;
    const nextRev = nextRevisionLabel(
      ((sibs ?? []) as { revision: string }[]).map((r) => r.revision),
    );

    const insertRow = {
      company_id: companyId,
      project_id: (parent as any).project_id,
      submittal_number: (parent as any).submittal_number,
      title: data.title ?? (parent as any).title,
      spec_section: data.specSection ?? (parent as any).spec_section,
      revision: nextRev,
      status: "draft",
      due_date: data.dueDate ?? (parent as any).due_date,
      file_path: data.filePath ?? null,
      created_by: context.user!.id,
    };
    const { data: inserted, error } = await context.supabase
      .from("submittals")
      .insert(insertRow)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!inserted) throw new Error("revise_failed");
    await audit(
      context,
      "submittal.revise",
      "submittals",
      (inserted as any).id,
      {
        submittal_number: (parent as any).submittal_number,
        from: (parent as any).revision,
        to: nextRev,
      },
    );
    return inserted as unknown as SubmittalRow;
  });

const signInput = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
});
export const signSubmittalUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => signInput.parse(raw))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteSubmittal(roles)) httpError(403, "forbidden");
    const uuid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safe = data.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    const path = `${companyId}/submittals/${data.projectId}/${uuid}-${safe}`;
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return {
      bucket: "documents",
      path,
      signedUrl: signed.signedUrl,
      token: signed.token,
    };
  });

export const listSubmittalProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; code: string | null }[];
  });
