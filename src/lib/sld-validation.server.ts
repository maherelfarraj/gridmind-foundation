// P-142 — Server-only helpers for the SLD connectivity/validation engine.
// Kept out of the *.functions.ts module so server-fn splitting cannot drop them.
import { isRemoved, type CadDrawing } from "./sld-cad.server";
import type { ConnEdge, ConnObject, ConnSymbolMeta, ValidationSnapshot } from "./sld/connectivity";
import type { CoordinationOptions } from "./sld/coordination";

export type ValidationGraph = {
  revisionId: string;
  revisionStatus: string | null;
  canvas: Record<string, unknown>;
  objects: ConnObject[];
  connections: ConnEdge[];
  symbolTypes: ConnSymbolMeta[];
  projectVoltagesKv: number[];
};

/** Reads the kV list declared on project_sld_config (P-054). */
export function parseProjectVoltages(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const entry of raw) {
    const kv =
      typeof entry === "number"
        ? entry
        : Number((entry as Record<string, unknown> | null)?.kv ?? NaN);
    if (Number.isFinite(kv) && kv > 0) out.push(kv);
  }
  return [...new Set(out)];
}

/** Loads everything the pure validators need for a drawing's current revision. */
export async function loadValidationGraph(
  context: any,
  drawing: CadDrawing,
): Promise<ValidationGraph | null> {
  if (!drawing.current_revision_id) return null;
  const revisionId = drawing.current_revision_id;

  const { data: revision, error: revErr } = await context.supabase
    .from("sld_revisions")
    .select("id, status, canvas")
    .eq("id", revisionId)
    .maybeSingle();
  if (revErr) throw revErr;

  const { data: objectRows, error: objErr } = await context.supabase
    .from("sld_objects")
    .select("id, symbol_type, tag, properties")
    .eq("revision_id", revisionId);
  if (objErr) throw objErr;

  const { data: connRows, error: connErr } = await context.supabase
    .from("sld_connections")
    .select(
      "id, connection_type, cable_number, from_object_id, from_port, to_object_id, to_port, properties",
    )
    .eq("revision_id", revisionId);
  if (connErr) throw connErr;

  const { data: symbolRows, error: symErr } = await context.supabase
    .from("sld_symbol_types")
    .select("type_key, display_name, category, ports, company_id")
    .or(`company_id.is.null,company_id.eq.${drawing.company_id}`);
  if (symErr) throw symErr;

  const { data: sldConfig, error: cfgErr } = await context.supabase
    .from("project_sld_config")
    .select("voltage_levels")
    .eq("project_id", drawing.project_id)
    .maybeSingle();
  if (cfgErr) throw cfgErr;

  const objects: ConnObject[] = ((objectRows ?? []) as any[])
    .filter((o) => !isRemoved(o.properties))
    .map((o) => ({
      id: o.id as string,
      symbol_type: o.symbol_type as string,
      tag: (o.tag ?? null) as string | null,
      properties: (o.properties ?? {}) as Record<string, unknown>,
    }));

  const connections: ConnEdge[] = ((connRows ?? []) as any[])
    .filter((c) => !isRemoved(c.properties))
    .map((c) => ({
      id: c.id as string,
      connection_type: c.connection_type as string,
      cable_number: (c.cable_number ?? null) as string | null,
      from_object_id: c.from_object_id as string,
      from_port: String(c.from_port ?? ""),
      to_object_id: c.to_object_id as string,
      to_port: String(c.to_port ?? ""),
      properties: (c.properties ?? {}) as Record<string, unknown>,
    }));

  // Company overrides win over the global registry entry for the same key.
  const byKey = new Map<string, ConnSymbolMeta>();
  for (const row of ((symbolRows ?? []) as any[]).sort((a, b) =>
    a.company_id === b.company_id ? 0 : a.company_id ? 1 : -1,
  )) {
    byKey.set(row.type_key as string, {
      type_key: row.type_key as string,
      display_name: (row.display_name ?? undefined) as string | undefined,
      category: String(row.category ?? ""),
      ports: Array.isArray(row.ports)
        ? (row.ports as any[]).map((p) => ({
            key: String(p?.key ?? ""),
            required: p?.required === true,
          }))
        : [],
    });
  }

  return {
    revisionId,
    revisionStatus: (revision as any)?.status ?? null,
    canvas: ((revision as any)?.canvas ?? {}) as Record<string, unknown>,
    objects,
    connections,
    symbolTypes: [...byKey.values()],
    projectVoltagesKv: parseProjectVoltages((sldConfig as any)?.voltage_levels),
  };
}

/** Merges the immutable validation snapshot into the revision canvas jsonb. */
export async function persistValidation(
  context: any,
  graph: ValidationGraph,
  snapshot: ValidationSnapshot,
) {
  const { error } = await context.supabase
    .from("sld_revisions")
    .update({ canvas: { ...graph.canvas, validation: snapshot } } as any)
    .eq("id", graph.revisionId);
  if (error) throw error;
}

/** Merges the coordination snapshot (P-143) into the revision canvas jsonb. */
export async function persistCoordination(
  context: any,
  graph: ValidationGraph,
  snapshot: unknown,
) {
  const { error } = await context.supabase
    .from("sld_revisions")
    .update({ canvas: { ...graph.canvas, coordination: snapshot } } as any)
    .eq("id", graph.revisionId);
  if (error) throw error;
}

/** Coordination bounds sourced from project_pv_config / project_bess_config (P-143). */
export async function loadCoordinationOptions(
  context: any,
  projectId: string,
): Promise<CoordinationOptions> {
  const { data, error } = await context.supabase
    .from("project_pv_config")
    .select("dc_ac_ratio")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;

  const target = Number((data as any)?.dc_ac_ratio);
  if (Number.isFinite(target) && target > 0) {
    // Configured design ratio widens the acceptable band symmetrically by 0.3.
    return {
      dcAcMin: Math.max(0.5, Number((target - 0.3).toFixed(2))),
      dcAcMax: Number((target + 0.3).toFixed(2)),
    };
  }
  return {};
}
