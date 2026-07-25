// P-082 — Lender DD server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  currentCompanyId,
  hasAnyRole,
  httpError,
  writeAudit,
} from "@/lib/project-finance-shared";
import {
  DdStatusChangeSchema,
  DdUpsertSchema,
  type DdItemRow,
} from "@/lib/project-finance.rules";

const WRITE_ROLES = [
  "finance_admin",
  "legal_admin",
  "company_admin",
] as const;

function toRow(r: any): DdItemRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    category: r.category,
    title: r.title,
    description: r.description ?? null,
    status: r.status,
    due_date: r.due_date ?? null,
    owner_id: r.owner_id ?? null,
    document_path: r.document_path ?? null,
    response_note: r.response_note ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function loadDd(ctx: AuthContext, id: string): Promise<DdItemRow> {
  const { data, error } = await ctx.supabase
    .from("lender_dd_items" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  return toRow(data);
}

export const listDdItems = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ project_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: DdItemRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("lender_dd_items" as any)
      .select("*")
      .eq("project_id", data.project_id)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      members: Array<{ id: string; email: string | null; full_name: string | null }>;
    }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context as AuthContext);
      const { data, error } = await context.supabase
        .from("profiles" as any)
        .select("id, email, full_name")
        .eq("company_id", companyId)
        .order("email", { ascending: true });
      if (error) throw error;
      return {
        members: ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          email: r.email ?? null,
          full_name: r.full_name ?? null,
        })),
      };
    },
  );

export const upsertDdItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DdUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<DdItemRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    const companyId = await currentCompanyId(context as AuthContext);

    const payload: Record<string, unknown> = {
      project_id: data.project_id,
      category: data.category,
      title: data.title,
      description: data.description ?? null,
      due_date: data.due_date ?? null,
      owner_id: data.owner_id ?? null,
      response_note: data.response_note ?? null,
      document_path: data.document_path ?? null,
    };

    if (data.id) {
      const { data: upd, error } = await context.supabase
        .from("lender_dd_items" as any)
        .update(payload as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = toRow(upd);
      await writeAudit(
        context as AuthContext,
        "dd.update",
        "lender_dd_items",
        row.id,
        { project_id: row.project_id, category: row.category },
      );
      return row;
    }

    const { data: ins, error } = await context.supabase
      .from("lender_dd_items" as any)
      .insert({
        ...payload,
        company_id: companyId,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = toRow(ins);
    await writeAudit(
      context as AuthContext,
      "dd.create",
      "lender_dd_items",
      row.id,
      { project_id: row.project_id, category: row.category, title: row.title },
    );
    return row;
  });

export const changeDdStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => DdStatusChangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<DdItemRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    const before = await loadDd(context as AuthContext, data.id);
    const { data: upd, error } = await context.supabase
      .from("lender_dd_items" as any)
      .update({
        status: data.status,
        response_note: data.note ?? before.response_note,
      } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = toRow(upd);
    await writeAudit(
      context as AuthContext,
      "dd.status_change",
      "lender_dd_items",
      row.id,
      { from: before.status, to: row.status, note: data.note ?? null },
    );
    return row;
  });

/**
 * Returns a signed upload URL for a document in the `documents` bucket rooted at
 * `{company_id}/lender-dd/{project_id}/…`. Client PUTs the file, then persists
 * the returned `path` on the DD row.
 */
export const signDdDocumentUploadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        filename: z.string().min(1).max(300),
      })
      .parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ path: string; token: string }> => {
      requireSupabaseAuth(context);
      if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
        httpError(403, "forbidden");
      }
      const companyId = await currentCompanyId(context as AuthContext);
      const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const stamp = Date.now();
      const path = `${companyId}/lender-dd/${data.projectId}/${stamp}_${safeName}`;
      const { data: signed, error } = await context.supabase.storage
        .from("documents")
        .createSignedUploadUrl(path);
      if (error) throw error;
      return { path, token: signed?.token ?? "" };
    },
  );

export const signDdDocumentDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ path: z.string().min(1) }).parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ url: string | null }> => {
      requireSupabaseAuth(context);
      const { data: signed, error } = await context.supabase.storage
        .from("documents")
        .createSignedUrl(data.path, 300);
      if (error) return { url: null };
      return { url: signed?.signedUrl ?? null };
    },
  );
