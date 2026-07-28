// P-267 — Retention report + turnover dossier server functions.
// Reads go through the guarded definer routines; dossier registration is
// engine-owned (register_turnover_dossier) so the package is always a
// permanent controlled document.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { DisposalQueueRow, RetentionSummaryRow } from "@/lib/document-retention.rules";
import { compileDossierChapters } from "@/lib/turnover-dossier.server";
import { detectGaps, gapCount, type DossierChapter } from "@/lib/turnover-dossier.rules";

export interface DossierCompilation {
  chapters: DossierChapter[];
  gaps: ReturnType<typeof detectGaps>;
  gapTotal: number;
  complete: boolean;
  project: { id: string; name: string; code: string | null; targetCod: string | null };
}

export const getRetentionSummary = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid().nullable().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<RetentionSummaryRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("document_retention_summary", {
      p_project_id: data.projectId ?? undefined,
    });
    if (error) throw error;
    return (rows ?? []) as RetentionSummaryRow[];
  });

export const getDisposalQueue = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        withinDays: z.number().int().min(0).max(3650).default(90),
        projectId: z.string().uuid().nullable().optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<DisposalQueueRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase.rpc("document_disposal_queue", {
      p_within_days: data.withinDays,
      p_project_id: data.projectId ?? undefined,
    });
    if (error) throw error;
    return (rows ?? []) as DisposalQueueRow[];
  });

export const compileTurnoverDossier = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<DossierCompilation> => {
    requireSupabaseAuth(context);

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", context.user.id)
      .single();
    const companyId = profile?.company_id as string | undefined;
    if (!companyId) throw new Error("not_authorized");

    const { data: project, error: projectErr } = await context.supabase
      .from("projects")
      .select("id, name, code, target_cod")
      .eq("id", data.projectId)
      .eq("company_id", companyId)
      .single();
    if (projectErr) throw projectErr;

    const chapters = await compileDossierChapters(context.supabase, companyId, data.projectId);
    const gaps = detectGaps(chapters);

    return {
      chapters,
      gaps,
      gapTotal: gapCount(gaps),
      complete: gaps.length === 0,
      project: {
        id: project.id as string,
        name: project.name as string,
        code: (project.code as string) ?? null,
        targetCod: (project.target_cod as string) ?? null,
      },
    };
  });

export const registerTurnoverDossier = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        complete: z.boolean(),
        gaps: z.array(z.record(z.string(), z.unknown())).default([]),
        chapters: z.array(z.record(z.string(), z.unknown())).default([]),
        storagePath: z.string().nullable().optional(),
      })
      .parse(raw),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ dossierId: string; documentId: string; docNumber: string }> => {
      requireSupabaseAuth(context);
      const { data: rows, error } = await context.supabase.rpc("register_turnover_dossier", {
        p_project_id: data.projectId,
        p_complete: data.complete,
        p_gaps: data.gaps as unknown as never,
        p_chapters: data.chapters as unknown as never,
        p_storage_path: data.storagePath ?? undefined,
      });
      if (error) throw error;
      const row = (rows ?? [])[0] as
        | { dossier_id: string; document_id: string; doc_number: string }
        | undefined;
      if (!row) throw new Error("dossier_registration_failed");
      return {
        dossierId: row.dossier_id,
        documentId: row.document_id,
        docNumber: row.doc_number,
      };
    },
  );

export const listTurnoverDossiers = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("turnover_dossiers")
      .select(
        "id, dossier_number, complete, gap_count, chapters, generated_at, document_id, project_id",
      )
      .eq("project_id", data.projectId)
      .order("generated_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });
