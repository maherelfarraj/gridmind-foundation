// P-264 — Controlled-document search server functions.
// The heavy lifting lives in the `search_documents` definer RPC (company-scoped,
// external-viewer-proof). This module is a thin RPC wrapper plus the filter
// facet loader for the search page.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  cleanFilters,
  isSearchable,
  normalizeQuery,
  type DocSearchHit,
} from "@/lib/documents-search.rules";

const searchInput = z.object({
  query: z.string().max(200),
  projectId: z.string().uuid().nullable().optional(),
  docType: z.string().max(80).nullable().optional(),
  status: z.string().max(40).nullable().optional(),
  discipline: z.string().max(80).nullable().optional(),
  retentionClass: z.string().max(40).nullable().optional(),
  from: z.string().max(40).nullable().optional(),
  to: z.string().max(40).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const searchDocuments = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => searchInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<DocSearchHit[]> => {
    requireSupabaseAuth(context);
    if (!isSearchable(data.query)) return [];
    const f = cleanFilters(data);
    const { data: rows, error } = await context.supabase.rpc("search_documents", {
      p_query: normalizeQuery(data.query),
      p_project: f.projectId ?? undefined,
      p_doc_type: f.docType ?? undefined,
      p_status: f.status ?? undefined,
      p_discipline: f.discipline ?? undefined,
      p_retention_class: f.retentionClass ?? undefined,
      p_from: f.from ?? undefined,
      p_to: f.to ?? undefined,
      p_limit: data.limit ?? 50,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as DocSearchHit[];
  });

export interface DocSearchFacets {
  projects: Array<{ id: string; name: string; code: string | null }>;
  docTypes: string[];
  disciplines: string[];
  statuses: string[];
  retentionClasses: string[];
}

export const getDocumentSearchFacets = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<DocSearchFacets> => {
    requireSupabaseAuth(context);
    const [projects, register] = await Promise.all([
      context.supabase.from("projects").select("id, name, code").order("name").limit(300),
      context.supabase
        .from("document_register")
        .select("doc_type, discipline, status, retention_class")
        .limit(2000),
    ]);
    if (projects.error) throw projects.error;
    if (register.error) throw register.error;
    const rows = (register.data ?? []) as Array<Record<string, string | null>>;
    const uniq = (key: string) =>
      [...new Set(rows.map((r) => r[key]).filter((v): v is string => Boolean(v)))].sort();
    return {
      projects: (projects.data ?? []) as DocSearchFacets["projects"],
      docTypes: uniq("doc_type"),
      disciplines: uniq("discipline"),
      statuses: uniq("status"),
      retentionClasses: uniq("retention_class"),
    };
  });

const contentInput = z.object({
  documentId: z.string().uuid(),
  text: z.string().max(400_000),
});

/**
 * Stores extracted text for a registered document so its body becomes
 * searchable (weight C). Text-based PDFs only — images/CAD stay metadata-only.
 */
export const setDocumentContentText = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => contentInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true; characters: number }> => {
    requireSupabaseAuth(context);
    const text = data.text.replace(/\s+/g, " ").trim();
    const { error } = await context.supabase
      .from("document_register")
      .update({
        content_text: text.length ? text : null,
        content_extracted_at: new Date().toISOString(),
      })
      .eq("id", data.documentId);
    if (error) throw error;
    return { ok: true, characters: text.length };
  });
