// P-151 — Server-only helpers for PV site configurations (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  defaultWeatherMeta,
  type PvBoundary,
  type PvExclusion,
  type PvSiteConfigRow,
  type PvWeatherMeta,
  type PvWeatherSource,
} from "@/lib/pv-site.schemas";

export const PV_SITE_BUCKET = "documents";
export const PV_SITE_ALLOWED_EXTENSIONS = ["csv", "tmy", "epw", "txt", "xlsx", "json"];
export const PV_SITE_WRITE_ROLES = [
  "engineering_admin",
  "engineer",
  "project_admin",
  "company_admin",
  "super_admin",
];

export function httpError(status: number, code: string, message?: string, extra?: object): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code, ...(extra ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company", "No active company for user.");
  return companyId as string;
}

export async function canWritePvSite(context: AuthContext): Promise<boolean> {
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", PV_SITE_WRITE_ROLES as any)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

/** RLS already scopes rows; this also proves the project is readable by the caller. */
export async function assertProjectVisible(
  context: AuthContext,
  projectId: string,
): Promise<{ id: string; company_id: string }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as any;
}

export async function auditPvSite(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "pv_site_configs",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    // never fail the request on audit
  }
}

export function pvSiteStoragePrefix(companyId: string, projectId: string): string {
  return `${companyId}/pv-weather/${projectId}/`;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

export function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

function num(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeWeatherMeta(raw: any): PvWeatherMeta {
  const base = defaultWeatherMeta();
  const meta = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const soiling = Array.isArray(meta.soiling_monthly_pct) ? meta.soiling_monthly_pct : null;
  return {
    dataset_label: meta.dataset_label ?? null,
    source_file: meta.source_file ?? null,
    ghi_kwh_m2_yr: num(meta.ghi_kwh_m2_yr),
    avg_ambient_c: num(meta.avg_ambient_c),
    avg_wind_ms: num(meta.avg_wind_ms),
    soiling_monthly_pct:
      soiling && soiling.length === 12
        ? soiling.map((v: any) => num(v) ?? 0)
        : base.soiling_monthly_pct,
    north_offset_deg: num(meta.north_offset_deg) ?? 0,
    grid: {
      max_export_kw: num(meta.grid?.max_export_kw),
      poi_voltage_kv: num(meta.grid?.poi_voltage_kv),
      curtailment_pct: num(meta.grid?.curtailment_pct),
    },
    targets: {
      target_dc_kwp: num(meta.targets?.target_dc_kwp),
      target_ac_kwp: num(meta.targets?.target_ac_kwp),
      mounting_type:
        meta.targets?.mounting_type === "single_axis_tracker" ? "single_axis_tracker" : "fixed_tilt",
      tilt_deg: num(meta.targets?.tilt_deg),
      azimuth_deg: num(meta.targets?.azimuth_deg),
      axis_azimuth_deg: num(meta.targets?.axis_azimuth_deg),
      rotation_limit_deg: num(meta.targets?.rotation_limit_deg),
      backtracking: meta.targets?.backtracking !== false,
    },
    terrain: {
      source: meta.terrain?.source ?? null,
      surface_id: meta.terrain?.surface_id ?? null,
      crs: meta.terrain?.crs ?? "EPSG:4326",
      notes: meta.terrain?.notes ?? null,
    },
  };
}

function normalizeBoundary(raw: any): PvBoundary {
  if (raw && raw.type === "Polygon" && Array.isArray(raw.coordinates)) {
    return { type: "Polygon", coordinates: raw.coordinates } as PvBoundary;
  }
  return { type: "Polygon", coordinates: [] } as PvBoundary;
}

function normalizeExclusions(raw: any): PvExclusion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && e.polygon?.type === "Polygon") as PvExclusion[];
}

export function toPvSiteRow(r: any): PvSiteConfigRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    name: r.name,
    status: r.status,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    altitude_m: num(r.altitude_m),
    timezone: r.timezone ?? null,
    terrain_slope_pct: num(r.terrain_slope_pct),
    terrain_azimuth_deg: num(r.terrain_azimuth_deg),
    albedo: num(r.albedo) ?? 0.2,
    weather_source: (r.weather_source ?? "pvgis") as PvWeatherSource,
    weather_meta: normalizeWeatherMeta(r.weather_meta),
    boundary: normalizeBoundary(r.boundary),
    exclusions: normalizeExclusions(r.exclusions),
    usable_area_ha: num(r.usable_area_ha),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
