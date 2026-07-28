// P-265 — Supersedure chain + revision comparison server functions.
// Chain walking lives in the `document_history` / `document_current_in_lineage`
// definer RPCs (company-scoped, external-viewer-proof).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { CHANGE_SUMMARY_MIN, type LineageNode } from "@/lib/documents-history.rules";

const idInput = z.object({ documentId: z.string().uuid() });

export interface DocumentRecord {
  id: string;
  doc_number: string | null;
  title: string;
  doc_type: string;
  discipline: string | null;
  current_revision: string;
  status: string;
  retention_class: string;
  change_summary: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

const RECORD_COLUMNS =
  "id, doc_number, title, doc_type, discipline, current_revision, status, retention_class, change_summary, supersedes_id, superseded_by_id, storage_path, file_name, mime_type, project_id, created_at, updated_at";

export const getDocumentRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ data, context }): Promise<DocumentRecord | null> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("document_register")
      .select(RECORD_COLUMNS)
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw error;
    return (row ?? null) as DocumentRecord | null;
  });

export const getDocumentHistory = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ data, context }): Promise<LineageNode[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("document_history", {
      p_doc_id: data.documentId,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as LineageNode[];
  });

export interface CurrentInLineage {
  id: string;
  doc_number: string | null;
  title: string;
  current_revision: string;
  status: string;
  is_self: boolean;
}

export const getCurrentInLineage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => idInput.parse(raw))
  .handler(async ({ data, context }): Promise<CurrentInLineage | null> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("document_current_in_lineage", {
      p_doc_id: data.documentId,
    });
    if (error) throw error;
    const list = (rows ?? []) as unknown as CurrentInLineage[];
    return list[0] ?? null;
  });

const revisionInput = z.object({
  supersedesId: z.string().uuid(),
  revision: z.string().min(1).max(20),
  changeSummary: z.string().min(CHANGE_SUMMARY_MIN).max(2000),
  title: z.string().min(1).max(300).optional(),
  storagePath: z.string().max(500).nullable().optional(),
  fileName: z.string().max(300).nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(),
});

/**
 * Registers a new revision of an issued document. The database flips the
 * previous revision to `superseded` and links it forward — never the client.
 */
export const registerRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => revisionInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const { data: parent, error: parentError } = await context.supabase
      .from("document_register")
      .select(
        "company_id, project_id, doc_type, title, discipline, retention_class, owner_id, tags, metadata, storage_path, file_name, mime_type",
      )
      .eq("id", data.supersedesId)
      .maybeSingle();
    if (parentError) throw parentError;
    if (!parent) throw new Error("document_not_found");
    const p = parent as Record<string, unknown>;

    const { data: inserted, error } = await context.supabase
      .from("document_register")
      .insert({
        company_id: p.company_id as string,
        project_id: (p.project_id as string | null) ?? null,
        doc_type: p.doc_type as string,
        title: data.title ?? (p.title as string),
        discipline: (p.discipline as string | null) ?? null,
        retention_class: p.retention_class as never,
        owner_id: (p.owner_id as string | null) ?? null,
        tags: (p.tags as string[]) ?? [],
        metadata: (p.metadata as never) ?? ({} as never),
        current_revision: data.revision,
        status: "issued" as never,
        change_summary: data.changeSummary.trim(),
        supersedes_id: data.supersedesId,
        storage_path: data.storagePath ?? (p.storage_path as string | null) ?? null,
        file_name: data.fileName ?? (p.file_name as string | null) ?? null,
        mime_type: data.mimeType ?? (p.mime_type as string | null) ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: (inserted as { id: string }).id };
  });
