// P-141 — Server-only helpers for the SLD tagging engine.
// Kept out of the *.functions.ts module so server-fn splitting cannot drop them.
import { cadHttpError, isRemoved, type CadDrawing } from "./sld-cad.server";
import type { TagArea, TaggableConnection, TaggableObject } from "./sld/tagging";

/** Once a revision reaches these states, tags are frozen. */
export const TAG_FROZEN_STATUSES = ["approved", "ifc", "as_built", "superseded"] as const;

export function assertRetaggable(drawing: CadDrawing, revisionStatus: string | null) {
  if (drawing.locked) {
    cadHttpError(409, "drawing_locked", "This drawing is locked — tags cannot be changed.");
  }
  const status = revisionStatus ?? drawing.status;
  if ((TAG_FROZEN_STATUSES as readonly string[]).includes(status)) {
    cadHttpError(
      409,
      "tags_frozen",
      `Tags are frozen once a revision is "${status.replace(/_/g, " ")}". Create a new revision to retag.`,
    );
  }
}

export type RetagGraph = {
  revisionId: string;
  revisionStatus: string | null;
  areas: TagArea[];
  objects: TaggableObject[];
  connections: TaggableConnection[];
  symbolTypes: Array<{ type_key: string; tag_prefix: string }>;
};

export function parseAreas(canvas: unknown): TagArea[] {
  const raw = (canvas as any)?.areas;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a: any) => a && typeof a === "object" && a.bounds)
    .map((a: any, i: number) => ({
      id: String(a.id ?? i + 1),
      name: String(a.name ?? `Area ${i + 1}`),
      code: a.code ? String(a.code) : undefined,
      bounds: {
        x: Number(a.bounds.x) || 0,
        y: Number(a.bounds.y) || 0,
        w: Number(a.bounds.w) || 0,
        h: Number(a.bounds.h) || 0,
      },
    }));
}

/** Loads the graph the tagging engine operates on for the drawing's current revision. */
export async function loadRetagGraph(context: any, drawing: CadDrawing): Promise<RetagGraph> {
  if (!drawing.current_revision_id)
    cadHttpError(404, "revision_not_found", "No revision to retag.");
  const revisionId = drawing.current_revision_id as string;

  const { data: revision, error: revErr } = await context.supabase
    .from("sld_revisions")
    .select("id, status, canvas")
    .eq("id", revisionId)
    .maybeSingle();
  if (revErr) throw revErr;

  const { data: objectRows, error: objErr } = await context.supabase
    .from("sld_objects")
    .select("id, symbol_type, tag, x, y, properties")
    .eq("revision_id", revisionId);
  if (objErr) throw objErr;

  const { data: connRows, error: connErr } = await context.supabase
    .from("sld_connections")
    .select("id, connection_type, cable_number, from_object_id, to_object_id, properties")
    .eq("revision_id", revisionId);
  if (connErr) throw connErr;

  const { data: symbolRows, error: symErr } = await context.supabase
    .from("sld_symbol_types")
    .select("type_key, tag_prefix, company_id")
    .or(`company_id.is.null,company_id.eq.${drawing.company_id}`);
  if (symErr) throw symErr;

  const objects = ((objectRows ?? []) as any[])
    .filter((o) => !isRemoved(o.properties))
    .map((o) => ({
      id: o.id as string,
      symbol_type: o.symbol_type as string,
      tag: (o.tag ?? null) as string | null,
      x: Number(o.x) || 0,
      y: Number(o.y) || 0,
    }));

  const connections = ((connRows ?? []) as any[])
    .filter((c) => !isRemoved(c.properties))
    .map((c) => ({
      id: c.id as string,
      connection_type: c.connection_type as string,
      cable_number: (c.cable_number ?? null) as string | null,
      from_object_id: c.from_object_id as string,
      to_object_id: c.to_object_id as string,
    }));

  // Company overrides win over the global registry entry for the same key.
  const prefixes = new Map<string, string>();
  for (const row of ((symbolRows ?? []) as any[]).sort((a, b) =>
    a.company_id === b.company_id ? 0 : a.company_id ? 1 : -1,
  )) {
    if (row.tag_prefix) prefixes.set(row.type_key as string, row.tag_prefix as string);
  }

  return {
    revisionId,
    revisionStatus: (revision as any)?.status ?? null,
    areas: parseAreas((revision as any)?.canvas),
    objects,
    connections,
    symbolTypes: [...prefixes.entries()].map(([type_key, tag_prefix]) => ({
      type_key,
      tag_prefix,
    })),
  };
}
