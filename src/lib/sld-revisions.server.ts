// P-145 — Server-only helpers for SLD revision management, diffing and markups.
// Kept out of *.functions.ts so server-fn splitting cannot drop them.
import {
  diffGraphs,
  diffTotals,
  graphHash,
  LINEAGE_KEY,
  type DiffConnection,
  type DiffObject,
  type GraphDiff,
} from "@/lib/sld/diff";
import { cadHttpError, isRemoved, type CadDrawing } from "@/lib/sld-cad.server";
import { normalizeCanvasMeta, type SldMarkup } from "@/lib/sld/canvas-types";

export type RevisionRow = {
  id: string;
  drawing_id: string;
  company_id: string;
  revision_code: string;
  status: string;
  issue_reason: string | null;
  graph_hash: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_by: string | null;
  created_at: string;
  canvas: unknown;
};

const REVISION_COLUMNS =
  "id, drawing_id, company_id, revision_code, status, issue_reason, graph_hash, issued_by, issued_at, created_by, created_at, canvas";

export async function listRevisionRows(context: any, drawingId: string): Promise<RevisionRow[]> {
  const { data, error } = await context.supabase
    .from("sld_revisions")
    .select(REVISION_COLUMNS)
    .eq("drawing_id", drawingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RevisionRow[];
}

export async function loadRevision(context: any, revisionId: string): Promise<RevisionRow> {
  const { data, error } = await context.supabase
    .from("sld_revisions")
    .select(REVISION_COLUMNS)
    .eq("id", revisionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) cadHttpError(404, "revision_not_found", "Revision not found.");
  return data as RevisionRow;
}

export type RevisionGraph = { objects: DiffObject[]; connections: DiffConnection[] };

export async function loadRevisionGraph(context: any, revisionId: string): Promise<RevisionGraph> {
  const [{ data: objRows, error: objErr }, { data: connRows, error: connErr }] = await Promise.all([
    context.supabase
      .from("sld_objects")
      .select("id, symbol_type, tag, label, x, y, rotation, mirrored, layer_id, properties")
      .eq("revision_id", revisionId),
    context.supabase
      .from("sld_connections")
      .select(
        "id, from_object_id, from_port, to_object_id, to_port, connection_type, cable_number, properties",
      )
      .eq("revision_id", revisionId),
  ]);
  if (objErr) throw objErr;
  if (connErr) throw connErr;

  const objects: DiffObject[] = ((objRows ?? []) as any[])
    .filter((o) => !isRemoved(o.properties))
    .map((o) => ({
      id: o.id as string,
      symbol_type: o.symbol_type as string,
      tag: (o.tag ?? null) as string | null,
      x: Number(o.x),
      y: Number(o.y),
      rotation: Number(o.rotation),
      mirrored: Boolean(o.mirrored),
      layer_id: o.layer_id as string,
      properties: (o.properties ?? {}) as Record<string, unknown>,
    }));

  const liveIds = new Set(objects.map((o) => o.id));
  const connections: DiffConnection[] = ((connRows ?? []) as any[])
    .filter((c) => !isRemoved(c.properties))
    .filter((c) => liveIds.has(c.from_object_id) && liveIds.has(c.to_object_id))
    .map((c) => ({
      id: c.id as string,
      from_object_id: c.from_object_id as string,
      from_port: c.from_port as string,
      to_object_id: c.to_object_id as string,
      to_port: c.to_port as string,
      connection_type: c.connection_type as string,
      cable_number: (c.cable_number ?? null) as string | null,
      properties: (c.properties ?? {}) as Record<string, unknown>,
    }));

  return { objects, connections };
}

/** A → B → … → Z → AA. */
export function nextRevisionCode(existing: string[]): string {
  const letters = existing
    .map((c) => (c ?? "").trim().toUpperCase())
    .filter((c) => /^[A-Z]+$/.test(c));
  if (letters.length === 0) return "A";
  const value = (code: string) =>
    code.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
  const toCode = (n: number): string => {
    let out = "";
    let v = n;
    while (v > 0) {
      const rem = (v - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      v = Math.floor((v - 1) / 26);
    }
    return out || "A";
  };
  return toCode(Math.max(...letters.map(value)) + 1);
}

/** Stamp lineage so diffs can match objects across deep-copied revisions. */
export function withLineage(
  properties: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  const existing = properties?.[LINEAGE_KEY];
  return {
    ...(properties ?? {}),
    [LINEAGE_KEY]: typeof existing === "string" && existing ? existing : sourceId,
  };
}

export type CopyResult = { objectCount: number; connectionCount: number; hash: string };

/** Deep-copies a source revision's graph into a target revision. */
export async function copyGraphIntoRevision(
  context: any,
  companyId: string,
  sourceGraph: RevisionGraph,
  targetRevisionId: string,
  userId: string,
): Promise<CopyResult> {
  const idMap = new Map<string, string>();

  if (sourceGraph.objects.length > 0) {
    const payload = sourceGraph.objects.map((o) => ({
      company_id: companyId,
      revision_id: targetRevisionId,
      symbol_type: o.symbol_type,
      tag: o.tag,
      x: o.x,
      y: o.y,
      rotation: o.rotation,
      mirrored: o.mirrored,
      layer_id: o.layer_id,
      properties: withLineage(o.properties, o.id) as any,
      created_by: userId,
    }));
    const { data, error } = await context.supabase
      .from("sld_objects")
      .insert(payload as any)
      .select("id");
    if (error) throw error;
    const ids = ((data ?? []) as any[]).map((r) => r.id as string);
    sourceGraph.objects.forEach((o, i) => {
      if (ids[i]) idMap.set(o.id, ids[i]);
    });
  }

  const connPayload = sourceGraph.connections
    .map((c) => ({
      company_id: companyId,
      revision_id: targetRevisionId,
      from_object_id: idMap.get(c.from_object_id) ?? null,
      from_port: c.from_port,
      to_object_id: idMap.get(c.to_object_id) ?? null,
      to_port: c.to_port,
      connection_type: c.connection_type,
      cable_number: c.cable_number,
      properties: (c.properties ?? {}) as any,
      created_by: userId,
    }))
    .filter((c) => c.from_object_id && c.to_object_id);

  if (connPayload.length > 0) {
    const { error } = await context.supabase.from("sld_connections").insert(connPayload as any);
    if (error) throw error;
  }

  // The copy is structurally identical, so hash the source graph directly.
  const hash = await graphHash(sourceGraph.objects, sourceGraph.connections);
  return {
    objectCount: sourceGraph.objects.length,
    connectionCount: connPayload.length,
    hash,
  };
}

export async function hashRevision(context: any, revisionId: string): Promise<string> {
  const graph = await loadRevisionGraph(context, revisionId);
  return graphHash(graph.objects, graph.connections);
}

export type RevisionDiffPayload = {
  a: { id: string; revision_code: string; status: string; graph_hash: string | null };
  b: { id: string; revision_code: string; status: string; graph_hash: string | null };
  diff: GraphDiff;
  totals: ReturnType<typeof diffTotals>;
  identical: boolean;
};

export async function buildRevisionDiff(
  context: any,
  revisionIdA: string,
  revisionIdB: string,
): Promise<RevisionDiffPayload> {
  const [revA, revB] = await Promise.all([
    loadRevision(context, revisionIdA),
    loadRevision(context, revisionIdB),
  ]);
  if (revA.drawing_id !== revB.drawing_id) {
    cadHttpError(400, "revision_mismatch", "Both revisions must belong to the same drawing.");
  }
  const [graphA, graphB] = await Promise.all([
    loadRevisionGraph(context, revA.id),
    loadRevisionGraph(context, revB.id),
  ]);
  const diff = diffGraphs(graphA.objects, graphA.connections, graphB.objects, graphB.connections);
  const [hashA, hashB] = await Promise.all([
    graphHash(graphA.objects, graphA.connections),
    graphHash(graphB.objects, graphB.connections),
  ]);
  return {
    a: { id: revA.id, revision_code: revA.revision_code, status: revA.status, graph_hash: hashA },
    b: { id: revB.id, revision_code: revB.revision_code, status: revB.status, graph_hash: hashB },
    diff,
    totals: diffTotals(diff),
    identical: hashA === hashB,
  };
}

/** Flat CSV rows for the as-designed vs as-built comparison export. */
export function diffCsvRows(payload: RevisionDiffPayload) {
  const rows: Record<string, string>[] = [];
  const push = (change: string, tag: string | null, detail: string) =>
    rows.push({
      from_revision: payload.a.revision_code,
      to_revision: payload.b.revision_code,
      change,
      tag: tag ?? "",
      detail,
    });

  for (const o of payload.diff.added) push("added", o.tag, o.symbol_type);
  for (const o of payload.diff.removed) push("removed", o.tag, o.symbol_type);
  for (const m of payload.diff.moved)
    push("moved", m.tag, `(${m.from.x}, ${m.from.y}) → (${m.to.x}, ${m.to.y})`);
  for (const t of payload.diff.tagChanged)
    push("tag_changed", t.to, `${t.from ?? "—"} → ${t.to ?? "—"}`);
  for (const p of payload.diff.propertyChanged)
    push(
      "property_changed",
      p.tag,
      `${p.property}: ${String(p.from ?? "—")} → ${String(p.to ?? "—")}`,
    );
  for (const c of payload.diff.connectionChanged)
    push(
      `connection_${c.kind}`,
      c.cable_number,
      `${c.from_tag ?? "?"} → ${c.to_tag ?? "?"}${c.detail ? ` · ${c.detail}` : ""}`,
    );

  return rows;
}

// --- markups ---------------------------------------------------------------

export function revisionMarkups(revision: RevisionRow): SldMarkup[] {
  return normalizeCanvasMeta(revision.canvas).markups;
}

export async function saveRevisionMarkups(
  context: any,
  revisionId: string,
  markups: SldMarkup[],
  revision: RevisionRow,
) {
  const canvas = { ...normalizeCanvasMeta(revision.canvas), markups };
  const { error } = await context.supabase
    .from("sld_revisions")
    .update({ canvas: canvas as any } as any)
    .eq("id", revisionId);
  if (error) throw error;
}

export async function canResolveMarkup(
  context: any,
  companyId: string,
  markup: SldMarkup,
  userId: string,
): Promise<boolean> {
  if (markup.author_id && markup.author_id === userId) return true;
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", ["engineering_admin", "company_admin", "super_admin"])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Mirrors an SLD markup into document_markups when the drawing is tracked in
 * the drawing register, so the P-146 review UI shows the same comments.
 */
export async function mirrorMarkupToRegister(
  context: any,
  drawing: CadDrawing,
  markup: SldMarkup,
): Promise<boolean> {
  const { data: register } = await context.supabase
    .from("drawing_register")
    .select("id, current_revision_id")
    .eq("project_id", drawing.project_id)
    .eq("drawing_number", drawing.drawing_number)
    .maybeSingle();
  const revisionId = (register as any)?.current_revision_id as string | undefined;
  if (!revisionId) return false;

  const { error } = await context.supabase.from("document_markups").insert({
    company_id: drawing.company_id,
    revision_id: revisionId,
    reviewer_id: markup.author_id,
    page_number: 1,
    annotation: {
      source: "sld",
      sld_drawing_id: drawing.id,
      markup_id: markup.id,
      kind: markup.kind,
      note: markup.note,
      points: markup.points,
      linked_object_ids: markup.linked_object_ids,
    } as any,
    status: markup.status,
  } as any);
  return !error;
}
