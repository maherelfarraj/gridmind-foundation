// P-155 — Server-only helpers for auto-generating an SLD from an approved PV
// layout. Kept out of *.functions.ts so server-fn splitting cannot drop them.
import { cadHttpError } from "@/lib/sld-cad.server";
import type {
  GenAssignmentRow,
  GenBlock,
  GenGraph,
  GenGridLimits,
  GenStringRow,
} from "@/lib/pv/sld-generate";

/** Postgres "undefined_table" — Batch 16 schema not applied in this environment. */
export const UNDEFINED_TABLE = "42P01";
export const B16_MISSING_NOTE = "Batch 16 schema not yet applied — preview only";

export function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return code === UNDEFINED_TABLE || message.includes("does not exist");
}

export interface ApprovedLayout {
  id: string;
  company_id: string;
  project_id: string;
  layout_number: string | null;
  name: string;
  status: string;
  site_config_id: string | null;
}

/** Loads the layout and enforces the approved-only governance rule (409). */
export async function requireApprovedLayout(
  context: any,
  layoutId: string,
): Promise<ApprovedLayout> {
  const { data, error } = await context.supabase
    .from("pv_layouts")
    .select("id, company_id, project_id, layout_number, name, status, site_config_id")
    .eq("id", layoutId)
    .maybeSingle();
  if (error) throw error;
  if (!data) cadHttpError(404, "layout_not_found", "Layout not found.");
  const row = data as ApprovedLayout;
  if (row.status !== "approved") {
    cadHttpError(
      409,
      "layout_not_approved",
      `Only approved layouts can generate an SLD — this layout is "${row.status}".`,
    );
  }
  return row;
}

export interface LayoutSource {
  strings: GenStringRow[];
  assignments: GenAssignmentRow[];
  blocks: GenBlock[];
  grid: GenGridLimits;
}

/** Reads strings, MPPT assignments, block centroids and site grid limits. */
export async function loadLayoutSource(
  context: any,
  layout: ApprovedLayout,
): Promise<LayoutSource> {
  const [strings, assignments, blocks, substation, project] = await Promise.all([
    context.supabase
      .from("pv_strings")
      .select(
        "id, string_label, block_id, combiner_label, inverter_station_label, mppt_index, modules_in_series, dc_power_kwp, voc_at_min_temp_v, vmp_at_max_temp_v",
      )
      .eq("layout_id", layout.id),
    context.supabase
      .from("pv_string_assignments")
      .select(
        "inverter_station_label, inverter_id, mppt_index, loading_pct, dc_ac_ratio, inverter_ac_kw, inverter_dc_kwp, mv_feeder, transformer",
      )
      .eq("layout_id", layout.id),
    context.supabase
      .from("pv_layout_blocks")
      .select("id, label, geometry")
      .eq("layout_id", layout.id),
    context.supabase
      .from("project_substation_config")
      .select("voltage_kv")
      .eq("project_id", layout.project_id)
      .maybeSingle(),
    context.supabase
      .from("projects")
      .select("capacity_mw, offtaker")
      .eq("id", layout.project_id)
      .maybeSingle(),
  ]);
  for (const res of [strings, assignments, blocks]) if (res.error) throw res.error;

  return {
    strings: (strings.data ?? []) as GenStringRow[],
    assignments: (assignments.data ?? []) as unknown as GenAssignmentRow[],
    blocks: ((blocks.data ?? []) as any[]).map((b) => ({
      id: b.id,
      label: b.label ?? null,
      centroid: centroidOf(b.geometry),
    })),
    grid: {
      voltageKv: substation.data?.voltage_kv ?? null,
      exportCapacityMw: project.data?.capacity_mw ?? null,
      importCapacityMw: null,
      utility: project.data?.offtaker ?? null,
    },
  };
}

/** Average of the geometry ring vertices; {0,0} when geometry is unusable. */
export function centroidOf(geometry: unknown): { x: number; y: number } {
  const g = geometry as { x?: number; y?: number; points?: { x: number; y: number }[] } | null;
  if (g && typeof g.x === "number" && typeof g.y === "number") return { x: g.x, y: g.y };
  const pts = g?.points ?? [];
  if (!Array.isArray(pts) || pts.length === 0) return { x: 0, y: 0 };
  const sum = pts.reduce((acc, p) => ({ x: acc.x + (p.x ?? 0), y: acc.y + (p.y ?? 0) }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

export function previewPayload(graph: GenGraph, layout: ApprovedLayout) {
  return {
    persisted: false as const,
    note: B16_MISSING_NOTE,
    drawingId: null,
    revisionId: null,
    layoutId: layout.id,
    counts: graph.counts,
    warnings: graph.warnings,
    objects: graph.objects,
    connections: graph.connections,
    diff: null,
  };
}
