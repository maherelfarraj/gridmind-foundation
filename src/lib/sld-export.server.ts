// P-147 — Server-only helpers for SLD import/export.
// Kept out of *.functions.ts so server-fn splitting cannot drop them.
import { assertExportAllowed } from "@/lib/export-guard";
import { cadHttpError, type CadDrawing } from "@/lib/sld-cad.server";
import { loadRevisionGraph, nextRevisionCode, listRevisionRows } from "@/lib/sld-revisions.server";
import { normalizeCanvasMeta, SHEET_SIZES, type SheetSize } from "@/lib/sld/canvas-types";
import { graphHash } from "@/lib/sld/diff";
import { planRetag } from "@/lib/sld/tagging";
import type { LegendRow, TitleBlockRow } from "@/lib/sld/schedules";
import {
  toSvg,
  toDxf,
  toJson,
  toCsv,
  isValidDxf,
  type ExportConnection,
  type ExportGraph,
  type ExportObject,
  type ExportSheet,
  type ExportSymbol,
} from "@/lib/sld/exporters";

export const SLD_EXPORT_FORMATS = ["svg", "pdf", "png", "json", "csv", "dxf"] as const;
export type SldExportFormat = (typeof SLD_EXPORT_FORMATS)[number];

export const EXPORT_BUCKET = "drawings";

export type ExportBundle = {
  revisionId: string;
  revisionCode: string | null;
  graph: ExportGraph;
  symbols: ExportSymbol[];
  sheet: ExportSheet;
  legend: LegendRow[];
};

/** Typed 423 for locked projects; every export fn calls this first. */
export async function assertSldExportAllowed(context: any, projectId: string) {
  try {
    await assertExportAllowed(context.supabase, projectId, "sld_drawing");
  } catch (err) {
    if ((err as { code?: string }).code === "export_locked") {
      cadHttpError(423, "export_locked", "Export blocked: this project has an active lock.");
    }
    throw err;
  }
}

export async function loadExportSymbols(context: any, companyId: string): Promise<ExportSymbol[]> {
  const { data, error } = await context.supabase
    .from("sld_symbol_types")
    .select("type_key, display_name, svg_body, ports, tag_prefix, company_id")
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw error;

  const byKey = new Map<string, ExportSymbol & { tag_prefix: string }>();
  for (const row of ((data ?? []) as any[]).sort((a, b) =>
    a.company_id === b.company_id ? 0 : a.company_id ? 1 : -1,
  )) {
    byKey.set(row.type_key as string, {
      type_key: row.type_key as string,
      display_name: (row.display_name ?? null) as string | null,
      svg_body: (row.svg_body ?? "") as string,
      ports: Array.isArray(row.ports)
        ? (row.ports as any[]).map((p) => ({
            key: String(p.key),
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
          }))
        : [],
      tag_prefix: String(row.tag_prefix ?? "EQ"),
    });
  }
  return [...byKey.values()];
}

function sheetSizeOf(value: string | null | undefined): SheetSize {
  return (value && value in SHEET_SIZES ? value : "A1") as SheetSize;
}

/** Everything the pure exporters need for the drawing's current revision. */
export async function loadExportBundle(context: any, drawing: CadDrawing): Promise<ExportBundle> {
  const revisionId = drawing.current_revision_id;
  if (!revisionId) cadHttpError(409, "no_revision", "This drawing has no revision to export.");

  const [{ data: revision }, rawGraph, symbols, { data: schedules }] = await Promise.all([
    context.supabase
      .from("sld_revisions")
      .select("id, revision_code, status, canvas")
      .eq("id", revisionId)
      .maybeSingle(),
    loadRevisionGraph(context, revisionId as string),
    loadExportSymbols(context, drawing.company_id),
    context.supabase
      .from("sld_schedules")
      .select("schedule_type, rows")
      .eq("revision_id", revisionId),
  ]);

  const meta = normalizeCanvasMeta((revision as any)?.canvas ?? {});
  const rows = (schedules ?? []) as Array<{ schedule_type: string; rows: any }>;
  const titleRows = (rows.find((r) => r.schedule_type === "title_block")?.rows ??
    []) as TitleBlockRow[];
  const legend = (rows.find((r) => r.schedule_type === "legend")?.rows ?? []) as LegendRow[];

  const fallbackTitle: TitleBlockRow = {
    drawing_number: drawing.drawing_number,
    title: drawing.title,
    revision_code: ((revision as any)?.revision_code ?? null) as string | null,
    status: drawing.status,
    sheet_size: drawing.sheet_size,
    project_name: null,
    drawn_by: null,
  };

  return {
    revisionId: revisionId as string,
    revisionCode: ((revision as any)?.revision_code ?? null) as string | null,
    graph: {
      objects: rawGraph.objects as unknown as ExportObject[],
      connections: rawGraph.connections as unknown as ExportConnection[],
    },
    symbols,
    sheet: {
      size: sheetSizeOf(drawing.sheet_size),
      titleBlock: titleRows[0] ?? fallbackTitle,
      legend,
      layers: meta.layers.map((l) => ({ id: l.id, name: l.name })),
    },
    legend,
  };
}

export function exportBaseName(drawing: CadDrawing, revisionCode: string | null): string {
  return `${drawing.drawing_number}${revisionCode ? `-${revisionCode}` : ""}`.replace(
    /[^A-Za-z0-9._-]/g,
    "-",
  );
}

/** Server-rendered payloads. PDF/PNG are rasterized client-side from the SVG. */
export function buildExportPayload(
  bundle: ExportBundle,
  format: SldExportFormat,
): { text: string | null; mime: string; warnings: string[] } {
  if (format === "json") {
    return {
      text: JSON.stringify(toJson(bundle.graph), null, 2),
      mime: "application/json",
      warnings: [],
    };
  }
  if (format === "csv") {
    const rows = bundle.graph.objects.map((o) => ({
      tag: o.tag ?? "",
      symbol_type: o.symbol_type,
      label: o.label ?? "",
      layer: o.layer_id,
      x_mm: o.x,
      y_mm: o.y,
      rotation: o.rotation ?? 0,
    }));
    return { text: toCsv(rows), mime: "text/csv", warnings: [] };
  }
  if (format === "dxf") {
    const { dxf, warnings } = toDxf(bundle.graph, bundle.symbols, bundle.sheet);
    if (!isValidDxf(dxf)) {
      cadHttpError(500, "dxf_invalid", "Generated DXF failed its structural check.");
    }
    return { text: dxf, mime: "application/dxf", warnings };
  }
  // svg, and the source document for png/pdf
  return {
    text: toSvg(bundle.graph, bundle.symbols, bundle.sheet),
    mime: "image/svg+xml",
    warnings: [],
  };
}

/** Uploads to the drawings bucket at company-UUID-first paths and registers a row. */
export async function storeExportArtifact(
  context: any,
  drawing: CadDrawing,
  revisionId: string,
  format: SldExportFormat,
  fileName: string,
  body: string,
  mime: string,
): Promise<{ storage_path: string; file_size_bytes: number }> {
  const storagePath = `${drawing.company_id}/${drawing.project_id}/sld-exports/${revisionId}/${fileName}`;
  const bytes = new TextEncoder().encode(body);

  const { error: upErr } = await context.supabase.storage
    .from(EXPORT_BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: true });
  if (upErr) throw upErr;

  const { error } = await context.supabase.from("sld_export_artifacts").insert({
    company_id: drawing.company_id,
    revision_id: revisionId,
    format,
    storage_path: storagePath,
    file_name: fileName,
    file_size_bytes: bytes.byteLength,
    created_by: context.user.id,
  } as any);
  if (error) throw error;

  return { storage_path: storagePath, file_size_bytes: bytes.byteLength };
}

export async function listExportArtifacts(context: any, revisionId: string) {
  const { data, error } = await context.supabase
    .from("sld_export_artifacts")
    .select("id, format, file_name, storage_path, file_size_bytes, created_at")
    .eq("revision_id", revisionId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw error;
  return (data ?? []) as any[];
}

// --- import ----------------------------------------------------------------

/**
 * Imports a validated graph into a BRAND NEW draft revision — an existing
 * revision is never mutated. Tags and cable numbers are regenerated (P-141).
 */
export async function importGraphAsNewRevision(
  context: any,
  drawing: CadDrawing,
  graph: ExportGraph,
  symbols: Array<ExportSymbol & { tag_prefix?: string }>,
): Promise<{
  revision_id: string;
  revision_code: string;
  object_count: number;
  connection_count: number;
  graph_hash: string;
}> {
  const rows = await listRevisionRows(context, drawing.id);
  const source = drawing.current_revision_id
    ? rows.find((r) => r.id === drawing.current_revision_id)
    : rows[rows.length - 1];
  const meta = normalizeCanvasMeta(source?.canvas ?? {});
  const code = nextRevisionCode(rows.map((r) => r.revision_code));

  const plan = planRetag(
    graph.objects.map((o) => ({
      id: o.id,
      symbol_type: o.symbol_type,
      tag: o.tag ?? null,
      x: o.x,
      y: o.y,
    })),
    graph.connections.map((c) => ({
      id: c.id,
      from_object_id: c.from_object_id,
      to_object_id: c.to_object_id,
      connection_type: c.connection_type,
      cable_number: c.cable_number ?? null,
    })),
    symbols.map((s) => ({ type_key: s.type_key, tag_prefix: s.tag_prefix ?? "EQ" })),
    meta.areas,
    { force: true },
  );
  const tagById = new Map(plan.tags.map((t) => [t.id, t.tag]));
  const cableById = new Map(plan.cables.map((c) => [c.id, c.cable_number]));

  const { data: created, error: revErr } = await context.supabase
    .from("sld_revisions")
    .insert({
      company_id: drawing.company_id,
      drawing_id: drawing.id,
      revision_code: code,
      status: "draft",
      issue_reason: "Imported from JSON",
      canvas: meta as any,
      created_by: context.user.id,
    } as any)
    .select("id")
    .single();
  if (revErr) throw revErr;
  const revisionId = (created as any).id as string;

  const idMap = new Map<string, string>();
  if (graph.objects.length > 0) {
    const payload = graph.objects.map((o) => ({
      company_id: drawing.company_id,
      revision_id: revisionId,
      symbol_type: o.symbol_type,
      tag: tagById.get(o.id) ?? o.tag ?? null,
      label: o.label ?? null,
      x: o.x,
      y: o.y,
      rotation: ((Math.round((o.rotation ?? 0) / 90) * 90) % 360) as number,
      mirrored: Boolean(o.mirrored),
      layer_id: o.layer_id || "default",
      properties: (o.properties ?? {}) as any,
      created_by: context.user.id,
    }));
    const { data, error } = await context.supabase
      .from("sld_objects")
      .insert(payload as any)
      .select("id");
    if (error) throw error;
    const ids = ((data ?? []) as any[]).map((r) => r.id as string);
    graph.objects.forEach((o, i) => {
      if (ids[i]) idMap.set(o.id, ids[i]);
    });
  }

  const connPayload = graph.connections
    .map((c) => ({
      company_id: drawing.company_id,
      revision_id: revisionId,
      from_object_id: idMap.get(c.from_object_id) ?? null,
      from_port: c.from_port,
      to_object_id: idMap.get(c.to_object_id) ?? null,
      to_port: c.to_port,
      connection_type: c.connection_type,
      cable_number: cableById.get(c.id) ?? c.cable_number ?? null,
      properties: (c.properties ?? {}) as any,
      created_by: context.user.id,
    }))
    .filter((c) => c.from_object_id && c.to_object_id);
  if (connPayload.length > 0) {
    const { error } = await context.supabase.from("sld_connections").insert(connPayload as any);
    if (error) throw error;
  }

  const hash = await graphHash(graph.objects as any, graph.connections as any);
  await context.supabase
    .from("sld_revisions")
    .update({ graph_hash: hash } as any)
    .eq("id", revisionId);
  await context.supabase
    .from("sld_drawings")
    .update({ current_revision_id: revisionId } as any)
    .eq("id", drawing.id);

  return {
    revision_id: revisionId,
    revision_code: code,
    object_count: graph.objects.length,
    connection_count: connPayload.length,
    graph_hash: hash,
  };
}
