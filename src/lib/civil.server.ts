// P-161 — Server-only helpers for civil analysis (kept out of the serverfn-split
// module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

import { buildElevationGrid, fillHoles, type ElevationGrid } from "@/lib/terrain/grid";
import { httpError } from "@/lib/terrain.server";

export type CivilFeatureRow = {
  id: string;
  company_id: string;
  project_id: string;
  surface_id: string | null;
  feature_ref: string;
  name: string;
  feature_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry: { type: string; coordinates: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>;
  status: string;
  revision_code: string;
  created_at: string;
};

export const CIVIL_FEATURE_COLUMNS =
  "id, company_id, project_id, surface_id, feature_ref, name, feature_type, geometry, properties, status, revision_code, created_at";

export async function loadSurface(
  context: AuthContext,
  surfaceId: string,
): Promise<{ id: string; company_id: string; project_id: string; grid_spacing_m: number; name: string; revision_code: string; analysis: Record<string, unknown> }> {
  const { data, error } = await context.supabase
    .from("terrain_surfaces")
    .select("id, company_id, project_id, grid_spacing_m, name, revision_code, analysis")
    .eq("id", surfaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "surface_not_found", "Terrain surface not found.");
  return {
    ...(data as any),
    analysis: ((data as any).analysis ?? {}) as Record<string, unknown>,
  };
}

/** Assemble the hole-filled elevation grid for a surface. */
export async function loadSurfaceGrid(
  context: AuthContext,
  surfaceId: string,
  spacing: number,
): Promise<ElevationGrid> {
  const { data, error } = await context.supabase
    .from("terrain_points")
    .select("easting, northing, elevation_m, grid_row, grid_col")
    .eq("surface_id", surfaceId)
    .limit(40000);
  if (error) throw error;
  const points = (data ?? []) as Array<{
    easting: number;
    northing: number;
    elevation_m: number;
    grid_row: number | null;
    grid_col: number | null;
  }>;
  if (points.length === 0) {
    httpError(400, "surface_empty", "This surface has no elevation points to analyse.");
  }
  return fillHoles(
    buildElevationGrid(
      points.map((p) => ({
        easting: p.easting,
        northing: p.northing,
        elevation_m: p.elevation_m,
        grid_row: p.grid_row,
        grid_col: p.grid_col,
      })),
      { spacing },
    ),
  );
}

export async function loadCivilFeature(
  context: AuthContext,
  featureId: string,
): Promise<CivilFeatureRow> {
  const { data, error } = await context.supabase
    .from("civil_features")
    .select(CIVIL_FEATURE_COLUMNS)
    .eq("id", featureId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "feature_not_found", "Civil feature not found.");
  return data as unknown as CivilFeatureRow;
}

/** pv_layout_blocks are REFERENCE ONLY for civil analysis — never written here. */
export async function loadLayoutBlocks(
  context: AuthContext,
  projectId: string,
  layoutId?: string | null,
): Promise<{
  layout: { id: string; name: string; status: string; params: Record<string, unknown> } | null;
  blocks: Array<{
    id: string;
    label: string | null;
    geometry: { type: string; coordinates: unknown };
    module_rows: number | null;
    block_type: string;
  }>;
}> {
  let query = context.supabase
    .from("pv_layouts")
    .select("id, name, status, params")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (layoutId) query = context.supabase
    .from("pv_layouts")
    .select("id, name, status, params")
    .eq("id", layoutId)
    .limit(1);

  const { data: layouts, error } = await query;
  if (error) throw error;
  const layout = (layouts?.[0] ?? null) as any;
  if (!layout) return { layout: null, blocks: [] };

  const { data: blocks, error: bErr } = await context.supabase
    .from("pv_layout_blocks")
    .select("id, label, geometry, module_rows, block_type")
    .eq("layout_id", layout.id)
    .order("sort_order", { ascending: true })
    .limit(2000);
  if (bErr) throw bErr;
  return {
    layout: { ...layout, params: (layout.params ?? {}) as Record<string, unknown> },
    blocks: (blocks ?? []) as any,
  };
}

export async function writeAuditLog(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: (entityId ?? null) as unknown as string,
      p_metadata: metadata as any,
    });
  } catch {
    // audit must never fail the request
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function nextFeatureRef(
  context: AuthContext,
  projectId: string,
  prefix: string,
): Promise<number> {
  const { data, error } = await context.supabase
    .from("civil_features")
    .select("feature_ref")
    .eq("project_id", projectId)
    .like("feature_ref", `${prefix}-%`);
  if (error) throw error;
  let max = 0;
  for (const row of (data ?? []) as Array<{ feature_ref: string }>) {
    const n = Number(row.feature_ref.slice(prefix.length + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/* ---------------------------------------------------------------------------
 * P-162 — Civil feature editor helpers
 * ------------------------------------------------------------------------ */

import {
  formatFeatureRef,
  geometryMatchesType,
  isReadOnlyStatus,
  nextRevisionCode,
  allowedGeometryTypes,
} from "@/lib/civil/feature-types";
import type { GeoJsonGeometry } from "@/lib/civil/geom";

/** Server-side geometry-kind gate. The DB CHECK is the final authority. */
export function assertGeometryKind(featureType: string, geometry: GeoJsonGeometry): void {
  if (!geometryMatchesType(featureType, geometry?.type)) {
    httpError(
      400,
      "geometry_kind_mismatch",
      `A ${featureType.replace(/_/g, " ")} must be drawn as ${allowedGeometryTypes(featureType).join(" or ") || "a supported geometry"}.`,
    );
  }
}

/** Approved / superseded features are frozen until a new revision is cut. */
export function assertFeatureEditable(feature: CivilFeatureRow): void {
  if (isReadOnlyStatus(feature.status)) {
    httpError(
      409,
      "feature_read_only",
      `${feature.feature_ref} is ${feature.status} and read-only. Create a new revision to edit it.`,
    );
  }
}

export async function suggestCivilRef(context: AuthContext, projectId: string): Promise<string> {
  return formatFeatureRef(await nextFeatureRef(context, projectId, "CVL"));
}

/** Reserve N sequential CVL refs (import path). */
export async function reserveCivilRefs(
  context: AuthContext,
  projectId: string,
  count: number,
): Promise<string[]> {
  const start = await nextFeatureRef(context, projectId, "CVL");
  return Array.from({ length: count }, (_, i) => formatFeatureRef(start + i));
}

export function bumpRevision(code: string): string {
  return nextRevisionCode(code);
}

/** Project anchor used for KML lon/lat export; falls back to the null island. */
export async function projectAnchor(
  context: AuthContext,
  projectId: string,
): Promise<{ lon: number; lat: number; name: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("name, latitude, longitude")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as { name?: string; latitude?: number | null; longitude?: number | null };
  return {
    lon: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : 0,
    lat: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : 0,
    name: row.name ?? "Project",
  };
}
