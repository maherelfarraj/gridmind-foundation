// P-163 — Server-only helpers for layout optimization runs (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { httpError } from "@/lib/pv-layout.server";
import { ringToLocal, type Ring } from "@/lib/pv-site.geo";
import type { AlternativeParams, AlternativeSiteConfig, TerrainSample } from "@/lib/pv/layout";
import {
  DEFAULT_UNIT_COSTS,
  DEFAULT_YIELD_REFERENCE,
  type UnitCosts,
  type YieldReference,
} from "@/lib/pv/optimize";

export const OPTIMIZATION_ENTITY = "layout_optimization_run";
export const OPTIMIZATION_RULE_KEY = "pv_layout_approval";
/** Terrain sampling cap so a run payload stays a reasonable jsonb document. */
export const MAX_TERRAIN_SAMPLES = 600;

export interface OptimizationRunRow {
  id: string;
  company_id: string;
  project_id: string;
  run_ref: string;
  name: string;
  scenario_type: string;
  status: string;
  revision_code: string;
  surface_id: string | null;
  weights: Record<string, number>;
  constraints: Record<string, unknown>;
  inputs: Record<string, unknown>;
  results: Record<string, unknown> | null;
  chosen_candidate: number | null;
  score: number | null;
  approval_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function auditOptimization(
  context: AuthContext,
  action: string,
  runId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await context.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "layout_optimization_runs",
    p_entity_id: runId,
    p_metadata: metadata as never,
  });
}

/** Next OPT-#### reference for a project, derived from the existing rows. */
export async function nextRunRef(context: AuthContext, projectId: string): Promise<string> {
  const { data, error } = await context.supabase
    .from("layout_optimization_runs")
    .select("run_ref")
    .eq("project_id", projectId);
  if (error) throw error;
  let max = 0;
  for (const row of (data ?? []) as { run_ref: string }[]) {
    const match = /^OPT-(\d{1,6})$/.exec(row.run_ref ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `OPT-${String(max + 1).padStart(4, "0")}`;
}

export async function loadRun(context: AuthContext, runId: string): Promise<OptimizationRunRow> {
  const { data, error } = await context.supabase
    .from("layout_optimization_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Optimization run not found.");
  return data as unknown as OptimizationRunRow;
}

export async function latestApprovalStatus(
  context: AuthContext,
  runId: string,
): Promise<string | null> {
  const { data, error } = await context.supabase
    .from("approval_instances")
    .select("status, requested_at")
    .eq("entity_type", OPTIMIZATION_ENTITY)
    .eq("entity_id", runId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as { status?: string } | undefined)?.status ?? null;
}

export interface OptimizationContext {
  companyId: string;
  siteConfigId: string | null;
  moduleId: string | null;
  site: AlternativeSiteConfig;
  base: AlternativeParams;
  costs: UnitCosts;
  yieldRef: YieldReference;
  surfaceId: string | null;
  sources: Record<string, string>;
}

/**
 * Gathers everything the engine needs: active site boundary and exclusions,
 * the first active module, optional terrain samples and the project yield
 * reference. Every value carries a source label for the audit trail.
 */
export async function buildOptimizationContext(
  context: AuthContext,
  projectId: string,
  surfaceId: string | null,
): Promise<OptimizationContext> {
  const sources: Record<string, string> = {};

  const { data: project, error: projectError } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project) httpError(404, "not_found", "Project not found.");
  const companyId = (project as { company_id: string }).company_id;

  const { data: siteRow, error: siteError } = await context.supabase
    .from("pv_site_configs")
    .select("id, boundary, exclusions, latitude, longitude, status")
    .eq("project_id", projectId)
    .in("status", ["active", "approved", "draft"])
    .order("status", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (siteError) throw siteError;
  if (!siteRow) httpError(409, "no_site_config", "Activate a site configuration first.");
  const site = siteRow as {
    id: string;
    boundary: { coordinates?: number[][][] } | null;
    exclusions: { polygon?: { coordinates?: number[][][] } }[] | null;
    latitude: number | null;
    longitude: number | null;
  };
  if (site.latitude === null || site.longitude === null) {
    httpError(409, "no_site_anchor", "The site configuration needs a latitude and longitude.");
  }
  const ring = (site.boundary?.coordinates?.[0] ?? []) as Ring;
  if (ring.length < 4) httpError(409, "no_boundary", "Draw the site boundary first.");
  const anchor = { lat: site.latitude as number, lon: site.longitude as number };
  sources.boundary = "pv_site_configs";

  const exclusions = (site.exclusions ?? []).map((e) =>
    ringToLocal((e.polygon?.coordinates?.[0] ?? []) as Ring, anchor),
  );

  const { data: moduleRow, error: moduleError } = await context.supabase
    .from("pv_equipment_library")
    .select("id, dimensions, electrical")
    .eq("category", "module")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (moduleError) throw moduleError;
  const dims = ((moduleRow as { dimensions?: Record<string, number> } | null)?.dimensions ??
    {}) as Record<string, number>;
  const electrical = ((moduleRow as { electrical?: Record<string, number> } | null)?.electrical ??
    {}) as Record<string, number>;
  sources.module = moduleRow ? "pv_equipment_library" : "default_580w_module";

  let terrainSamples: TerrainSample[] = [];
  let resolvedSurface = surfaceId;
  if (!resolvedSurface) {
    const { data: surface } = await context.supabase
      .from("terrain_surfaces")
      .select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    resolvedSurface = (surface as { id: string } | null)?.id ?? null;
  }
  if (resolvedSurface) {
    const { data: points, error: pointsError } = await context.supabase
      .from("terrain_points")
      .select("easting, northing, elevation_m")
      .eq("surface_id", resolvedSurface)
      .limit(MAX_TERRAIN_SAMPLES);
    if (pointsError) throw pointsError;
    terrainSamples = (
      (points ?? []) as { easting: number; northing: number; elevation_m: number }[]
    )
      .map((p) => ({ x: p.easting, y: p.northing, elevationM: p.elevation_m }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    if (terrainSamples.length > 0) sources.terrain = "terrain_points";
  }

  const { data: yieldRow } = await context.supabase
    .from("project_yield_config")
    .select("p50_mwh, ghi_kwh_m2, losses_pct")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const yieldCfg = yieldRow as { ghi_kwh_m2: number | null; losses_pct: number | null } | null;
  const specific =
    yieldCfg?.ghi_kwh_m2 && yieldCfg.ghi_kwh_m2 > 0
      ? yieldCfg.ghi_kwh_m2 * (1 - (yieldCfg.losses_pct ?? 15) / 100)
      : DEFAULT_YIELD_REFERENCE.specificYieldKwhPerKwp;
  sources.yield = yieldCfg ? "project_yield_config" : "engine_default";

  return {
    companyId,
    siteConfigId: site.id,
    moduleId: (moduleRow as { id: string } | null)?.id ?? null,
    surfaceId: resolvedSurface,
    sources,
    site: {
      boundary: ringToLocal(ring, anchor),
      exclusionZones: exclusions,
      latitude: anchor.lat,
      terrainRef: terrainSamples.length > 0 ? { samples: terrainSamples, slopeLimitPct: 8 } : null,
      equipmentPads: [
        { label: "Inverter station", widthM: 12, depthM: 6, count: 2, type: "inverter_station" },
        { label: "Transformer pad", widthM: 8, depthM: 6, count: 1 },
      ],
    },
    base: {
      module: {
        lengthMm: Number(dims.length_mm ?? dims.height_mm ?? 2278),
        widthMm: Number(dims.width_mm ?? 1134),
      },
      moduleWp: Number(electrical.pmax_w ?? 0) || 580,
      orientation: "portrait",
      modulesAcross: 28,
      modulesUp: 2,
      tiltDeg: 25,
      azimuthDeg: 180,
      gcr: 0.35,
      setbackM: 10,
      roadEveryNRows: 6,
      roadWidthM: 6,
      tracker: false,
    },
    costs: DEFAULT_UNIT_COSTS,
    yieldRef: { ...DEFAULT_YIELD_REFERENCE, specificYieldKwhPerKwp: Math.round(specific) },
  };
}
