// P-145 — SLD revision management server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { objectsToCsv } from "@/lib/csv";
import { cadAudit, cadHttpError, hasCadWriteRole, loadCadDrawing } from "@/lib/sld-cad.server";
import {
  buildRevisionDiff,
  canResolveMarkup,
  copyGraphIntoRevision,
  diffCsvRows,
  hashRevision,
  listRevisionRows,
  loadRevision,
  loadRevisionGraph,
  mirrorMarkupToRegister,
  nextRevisionCode,
  revisionMarkups,
  saveRevisionMarkups,
} from "@/lib/sld-revisions.server";
import type { SldMarkup } from "@/lib/sld/canvas-types";

const drawingInput = z.object({ drawingId: z.string().uuid() });

const createInput = z.object({
  drawingId: z.string().uuid(),
  issueReason: z.string().trim().max(500).default(""),
  /** "as_built" is the only reason allowed to branch off a locked drawing. */
  reason: z.enum(["revision", "as_built"]).default("revision"),
});

const compareInput = z.object({
  revisionIdA: z.string().uuid(),
  revisionIdB: z.string().uuid(),
});

/** Revision timeline for the drawing detail (oldest → newest). */
export const listSldRevisions = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    const rows = await listRevisionRows(context, drawing.id);

    const userIds = Array.from(
      new Set(rows.flatMap((r) => [r.created_by, r.issued_by]).filter(Boolean) as string[]),
    );
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const p of (profiles ?? []) as any[]) names.set(p.id, p.full_name ?? "");
    }

    return {
      drawing: {
        id: drawing.id,
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        title: drawing.title,
        status: drawing.status,
        locked: drawing.locked,
        current_revision_id: drawing.current_revision_id,
      },
      canWrite: await hasCadWriteRole(context, drawing.company_id),
      revisions: rows.map((r) => ({
        id: r.id,
        revision_code: r.revision_code,
        status: r.status,
        issue_reason: r.issue_reason,
        graph_hash: r.graph_hash,
        created_at: r.created_at,
        issued_at: r.issued_at,
        created_by_name: r.created_by ? (names.get(r.created_by) ?? null) : null,
        issued_by_name: r.issued_by ? (names.get(r.issued_by) ?? null) : null,
        is_current: r.id === drawing.current_revision_id,
        markup_count: revisionMarkups(r).length,
        open_markups: revisionMarkups(r).filter((m) => m.status === "open").length,
      })),
    };
  });

/** Deep-copies the current revision into the next code (A → B → C …). */
export const createSldRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) {
      cadHttpError(403, "forbidden", "Engineering role required to issue a revision.");
    }
    const asBuilt = data.reason === "as_built";
    if (drawing.locked && !asBuilt) {
      cadHttpError(
        409,
        "drawing_locked",
        "This drawing is locked — only an as-built revision may be created.",
      );
    }

    const rows = await listRevisionRows(context, drawing.id);
    const source = drawing.current_revision_id
      ? (rows.find((r) => r.id === drawing.current_revision_id) ?? rows[rows.length - 1])
      : rows[rows.length - 1];
    if (!source)
      cadHttpError(409, "no_source_revision", "Draw something before issuing a revision.");

    const graph = await loadRevisionGraph(context, source.id);
    const code = nextRevisionCode(rows.map((r) => r.revision_code));

    const { data: created, error } = await context.supabase
      .from("sld_revisions")
      .insert({
        company_id: drawing.company_id,
        drawing_id: drawing.id,
        revision_code: code,
        status: asBuilt ? "as_built" : "draft",
        issue_reason: data.issueReason || null,
        canvas: source.canvas as any,
        created_by: context.user.id,
        issued_by: context.user.id,
        issued_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    const revisionId = (created as any).id as string;

    const copy = await copyGraphIntoRevision(
      context,
      drawing.company_id,
      graph,
      revisionId,
      context.user.id,
    );

    await context.supabase
      .from("sld_revisions")
      .update({ graph_hash: copy.hash } as any)
      .eq("id", revisionId);

    // Older revisions become read-only history.
    await context.supabase
      .from("sld_revisions")
      .update({ status: "superseded" } as any)
      .eq("id", source.id)
      .in("status", ["draft", "under_review"]);

    const drawingPatch: Record<string, unknown> = { current_revision_id: revisionId };
    if (asBuilt) drawingPatch.status = "as_built";
    await context.supabase
      .from("sld_drawings")
      .update(drawingPatch as any)
      .eq("id", drawing.id);

    await cadAudit(context, asBuilt ? "sld.as_built_created" : "sld.revision_created", drawing.id, {
      revision_id: revisionId,
      revision_code: code,
      source_revision_id: source.id,
      issue_reason: data.issueReason || null,
      graph_hash: copy.hash,
      objects: copy.objectCount,
      connections: copy.connectionCount,
    });

    return {
      revision_id: revisionId,
      revision_code: code,
      graph_hash: copy.hash,
      objects: copy.objectCount,
      connections: copy.connectionCount,
    };
  });

/** Authoritative server-side diff between two revisions of one drawing. */
export const compareSldRevisions = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => compareInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const payload = await buildRevisionDiff(context, data.revisionIdA, data.revisionIdB);
    const [graphA, graphB] = await Promise.all([
      loadRevisionGraph(context, data.revisionIdA),
      loadRevisionGraph(context, data.revisionIdB),
    ]);
    return { ...payload, graphA, graphB };
  });

/** Creates an as-built revision from the IFC revision (or the current one). */
export const markAsBuilt = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) {
      cadHttpError(403, "forbidden", "Engineering role required to mark as-built.");
    }

    const rows = await listRevisionRows(context, drawing.id);
    const ifc = [...rows].reverse().find((r) => r.status === "ifc");
    const source =
      ifc ?? rows.find((r) => r.id === drawing.current_revision_id) ?? rows[rows.length - 1];
    if (!source) cadHttpError(409, "no_source_revision", "Nothing to mark as-built.");

    const graph = await loadRevisionGraph(context, source.id);
    const code = nextRevisionCode(rows.map((r) => r.revision_code));

    const { data: created, error } = await context.supabase
      .from("sld_revisions")
      .insert({
        company_id: drawing.company_id,
        drawing_id: drawing.id,
        revision_code: code,
        status: "as_built",
        issue_reason: `As-built from revision ${source.revision_code}`,
        canvas: source.canvas as any,
        created_by: context.user.id,
        issued_by: context.user.id,
        issued_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    const revisionId = (created as any).id as string;

    const copy = await copyGraphIntoRevision(
      context,
      drawing.company_id,
      graph,
      revisionId,
      context.user.id,
    );
    await context.supabase
      .from("sld_revisions")
      .update({ graph_hash: copy.hash } as any)
      .eq("id", revisionId);
    await context.supabase
      .from("sld_drawings")
      .update({ current_revision_id: revisionId, status: "as_built" } as any)
      .eq("id", drawing.id);

    await cadAudit(context, "sld.as_built_created", drawing.id, {
      revision_id: revisionId,
      revision_code: code,
      source_revision_id: source.id,
      source_status: source.status,
      graph_hash: copy.hash,
    });

    return { revision_id: revisionId, revision_code: code, source_revision_id: source.id };
  });

/** As-designed (IFC) vs as-built comparison, ready for the summary card. */
export const compareAsDesignedAsBuilt = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    const rows = await listRevisionRows(context, drawing.id);
    const ifc = [...rows].reverse().find((r) => r.status === "ifc");
    const asBuilt = [...rows].reverse().find((r) => r.status === "as_built");
    if (!ifc || !asBuilt) {
      return {
        available: false as const,
        ifc_id: ifc?.id ?? null,
        as_built_id: asBuilt?.id ?? null,
      };
    }
    const payload = await buildRevisionDiff(context, ifc.id, asBuilt.id);
    return { available: true as const, ...payload };
  });

/** CSV of any revision diff. Export-lock gated (423 when locked). */
export const exportRevisionDiffCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => compareInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const revA = await loadRevision(context, data.revisionIdA);
    const drawing = await loadCadDrawing(context, revA.drawing_id);

    try {
      await assertExportAllowed(context.supabase, drawing.project_id, "sld_revision_diff");
    } catch (err) {
      if ((err as { code?: string }).code === "export_locked") {
        cadHttpError(423, "export_locked", "Export blocked: this project has an active lock.");
      }
      throw err;
    }

    const payload = await buildRevisionDiff(context, data.revisionIdA, data.revisionIdB);
    const rows = diffCsvRows(payload);
    const filename = `${drawing.drawing_number}-diff-${payload.a.revision_code}-${payload.b.revision_code}.csv`;

    await cadAudit(context, "sld.revision_diff_exported", drawing.id, {
      revision_a: payload.a.id,
      revision_b: payload.b.id,
      rows: rows.length,
    });

    return { filename, csv: objectsToCsv(rows), row_count: rows.length, totals: payload.totals };
  });

// --- markups ---------------------------------------------------------------

const markupInput = z.object({
  drawingId: z.string().uuid(),
  markup: z.object({
    id: z.string().min(1).max(80),
    kind: z.enum(["cloud", "note", "arrow"]),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(200),
    note: z.string().trim().max(2000).default(""),
    linked_object_ids: z.array(z.string().min(1).max(80)).max(200).default([]),
  }),
});

const resolveInput = z.object({
  drawingId: z.string().uuid(),
  markupId: z.string().min(1).max(80),
  status: z.enum(["open", "resolved"]).default("resolved"),
});

/** Adds a cloud/note/arrow to the current revision's markup layer. */
export const addSldMarkup = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => markupInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!drawing.current_revision_id) cadHttpError(409, "no_revision", "No revision to mark up.");
    const revision = await loadRevision(context, drawing.current_revision_id);

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.user.id)
      .maybeSingle();

    const markup: SldMarkup = {
      id: data.markup.id,
      kind: data.markup.kind,
      points: data.markup.points,
      note: data.markup.note,
      author_id: context.user.id,
      author_name: ((profile as any)?.full_name as string) ?? null,
      status: "open",
      linked_object_ids: data.markup.linked_object_ids,
      created_at: new Date().toISOString(),
      resolved_by: null,
      resolved_at: null,
    };

    const existing = revisionMarkups(revision).filter((m) => m.id !== markup.id);
    await saveRevisionMarkups(context, revision.id, [...existing, markup], revision);
    const mirrored = await mirrorMarkupToRegister(context, drawing, markup);

    await cadAudit(context, "sld.markup_added", drawing.id, {
      revision_id: revision.id,
      markup_id: markup.id,
      kind: markup.kind,
      linked_objects: markup.linked_object_ids.length,
      mirrored_to_register: mirrored,
    });

    return { markup, mirrored };
  });

/** Resolve/reopen a markup — author or engineering_admin only. */
export const resolveSldMarkup = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => resolveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!drawing.current_revision_id) cadHttpError(409, "no_revision", "No revision to update.");
    const revision = await loadRevision(context, drawing.current_revision_id);

    const markups = revisionMarkups(revision);
    const target = markups.find((m) => m.id === data.markupId);
    if (!target) cadHttpError(404, "markup_not_found", "Markup not found.");
    if (!(await canResolveMarkup(context, drawing.company_id, target!, context.user.id))) {
      cadHttpError(403, "forbidden", "Only the author or an engineering admin can resolve this.");
    }

    const resolved = data.status === "resolved";
    const updated = markups.map((m) =>
      m.id === data.markupId
        ? {
            ...m,
            status: data.status,
            resolved_by: resolved ? context.user.id : null,
            resolved_at: resolved ? new Date().toISOString() : null,
          }
        : m,
    );
    await saveRevisionMarkups(context, revision.id, updated, revision);

    await cadAudit(context, resolved ? "sld.markup_resolved" : "sld.markup_reopened", drawing.id, {
      revision_id: revision.id,
      markup_id: data.markupId,
    });

    return { markup_id: data.markupId, status: data.status };
  });
