// P-156 — Server-only helpers for PV yield simulations (kept out of the
// serverfn-split module so runtime siblings survive the transform).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { httpError } from "@/lib/pv-layout.server";
import { YIELD_DISCLAIMER } from "@/lib/pv/yield-v2";

export const SIMULATION_DISCLAIMER = YIELD_DISCLAIMER;

export interface SimulationRow {
  id: string;
  company_id: string;
  project_id: string;
  status: string;
  is_baseline: boolean;
  approval_instance_id: string | null;
  name: string;
}

export async function loadSimulation(
  context: AuthContext,
  simulationId: string,
): Promise<SimulationRow> {
  const { data, error } = await context.supabase
    .from("pv_simulations")
    .select("id, company_id, project_id, status, is_baseline, approval_instance_id, name")
    .eq("id", simulationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found", "Simulation not found.");
  return data as unknown as SimulationRow;
}

/** Reads the latest approval instance status for a simulation. */
export async function latestApprovalStatus(
  context: AuthContext,
  simulationId: string,
): Promise<string | null> {
  const { data, error } = await context.supabase
    .from("approval_instances")
    .select("status, requested_at")
    .eq("entity_type", "pv_simulation")
    .eq("entity_id", simulationId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { status?: string } | undefined;
  return row?.status ?? null;
}

export async function auditPvSimulation(
  context: AuthContext,
  action: string,
  simulationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await context.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "pv_simulations",
    p_entity_id: simulationId,
    p_metadata: metadata as never,
  });
}

/** Deterministic monthly seasonality weights for a latitude (index 0 = January). */
export function monthlyGhiShape(latitudeDeg: number): number[] {
  const amp = Math.min(0.55, (Math.abs(latitudeDeg) / 90) * 1.2);
  const south = latitudeDeg < 0 ? 6 : 0;
  const raw = Array.from({ length: 12 }, (_, m) => {
    const phase = ((m + south) % 12) - 6; // peak at June (north) / December (south)
    return 1 + amp * Math.cos((phase * Math.PI) / 6) * -1;
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / total);
}

/** Monthly ambient temperature profile around the annual mean. */
export function monthlyAmbient(avgC: number, latitudeDeg: number): number[] {
  const amp = Math.min(12, (Math.abs(latitudeDeg) / 90) * 24);
  const south = latitudeDeg < 0 ? 6 : 0;
  return Array.from({ length: 12 }, (_, m) => {
    const phase = ((m + south) % 12) - 6;
    return Math.round((avgC - amp * Math.cos((phase * Math.PI) / 6)) * 10) / 10;
  });
}

export interface PrefillPayload {
  siteConfig: {
    id: string | null;
    name: string | null;
    latitudeDeg: number;
    albedo: number;
    tiltDeg: number;
    azimuthDeg: number;
    tracker: "fixed" | "single_axis";
    monthlyGhiKwhM2: number[];
    monthlyAmbientTempC: number[];
    monthlySoilingPct: number[];
    gridLimitKw: number | null;
    curtailmentPct: number | null;
    weatherSource: string | null;
  };
  layout: {
    id: string | null;
    name: string | null;
    layoutNumber: string | null;
    status: string | null;
    arrayDcKwp: number;
    moduleCount: number;
    gcr: number;
  };
  stringing: {
    dcWiringLossPct: number;
    inverterAcKw: number;
    loadingPct: number | null;
    dcAcRatio: number | null;
    stringCount: number;
  };
  bess: { configured: boolean; energyMwh: number | null; powerMw: number | null };
  sources: Record<string, string>;
}

/** Builds the server-prefilled simulation input sheet with per-field source tags. */
export async function buildSimulationPrefill(
  context: AuthContext,
  projectId: string,
): Promise<PrefillPayload> {
  const [siteRes, layoutRes, bessRes] = await Promise.all([
    context.supabase
      .from("pv_site_configs")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1),
    context.supabase
      .from("pv_layouts")
      .select("id, name, layout_number, status, params, totals")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(1),
    context.supabase
      .from("project_bess_config")
      .select("energy_mwh, power_mw")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  if (siteRes.error) throw siteRes.error;
  if (layoutRes.error) throw layoutRes.error;

  const site = (siteRes.data ?? [])[0] as Record<string, any> | undefined;
  const layout = (layoutRes.data ?? [])[0] as Record<string, any> | undefined;
  const meta = (site?.weather_meta ?? {}) as Record<string, any>;
  const targets = (meta.targets ?? {}) as Record<string, any>;
  const grid = (meta.grid ?? {}) as Record<string, any>;

  const latitude = Number(site?.latitude ?? 30);
  const annualGhi = Number(meta.ghi_kwh_m2_yr ?? 2000);
  const shape = monthlyGhiShape(latitude);
  const soiling = Array.isArray(meta.soiling_monthly_pct)
    ? (meta.soiling_monthly_pct as number[])
    : Array.from({ length: 12 }, () => 2);

  const totals = (layout?.totals ?? {}) as Record<string, any>;
  const params = (layout?.params ?? {}) as Record<string, any>;
  const arrayDcKwp = Number(totals.dc_kwp ?? totals.dcKwp ?? targets.target_dc_kwp ?? 0);
  const moduleCount = Number(totals.module_count ?? totals.modules ?? 0);

  let dcWiringLossPct = 1.2;
  let inverterAcKw = Number(targets.target_ac_kwp ?? Math.max(1, arrayDcKwp / 1.25));
  let loadingPct: number | null = null;
  let dcAcRatio: number | null = null;
  let stringCount = 0;

  if (layout?.id) {
    const [strings, assignments] = await Promise.all([
      context.supabase.from("pv_strings").select("cable").eq("layout_id", layout.id),
      context.supabase
        .from("pv_string_assignments")
        .select("inverter_ac_kw, loading_pct, dc_ac_ratio, inverter_station_label")
        .eq("layout_id", layout.id),
    ]);
    const stringRows = (strings.data ?? []) as Array<{ cable: any }>;
    stringCount = stringRows.length;
    if (stringCount > 0) {
      const total = stringRows.reduce((a, r) => a + Number(r.cable?.loss_pct ?? 0), 0);
      dcWiringLossPct = Math.round((total / stringCount) * 1000) / 1000;
    }
    const rows = (assignments.data ?? []) as Array<Record<string, any>>;
    if (rows.length > 0) {
      const stations = new Map<string, number>();
      for (const row of rows) stations.set(row.inverter_station_label, Number(row.inverter_ac_kw ?? 0));
      const acTotal = [...stations.values()].reduce((a, b) => a + b, 0);
      if (acTotal > 0) inverterAcKw = acTotal;
      loadingPct = Math.round((rows.reduce((a, r) => a + Number(r.loading_pct ?? 0), 0) / rows.length) * 100) / 100;
      dcAcRatio = Math.round((rows.reduce((a, r) => a + Number(r.dc_ac_ratio ?? 0), 0) / rows.length) * 1000) / 1000;
    }
  }

  const bess = (bessRes.data ?? null) as { energy_mwh: number | null; power_mw: number | null } | null;

  return {
    siteConfig: {
      id: site?.id ?? null,
      name: site?.name ?? null,
      latitudeDeg: latitude,
      albedo: Number(site?.albedo ?? 0.2),
      tiltDeg: Number(targets.tilt_deg ?? 25),
      azimuthDeg: Number(targets.azimuth_deg ?? 180) - 180,
      tracker: targets.mounting_type === "single_axis_tracker" ? "single_axis" : "fixed",
      monthlyGhiKwhM2: shape.map((w) => Math.round(annualGhi * w * 100) / 100),
      monthlyAmbientTempC: monthlyAmbient(Number(meta.avg_ambient_c ?? 22), latitude),
      monthlySoilingPct: soiling.slice(0, 12),
      gridLimitKw: grid.max_export_kw ?? null,
      curtailmentPct: grid.curtailment_pct ?? null,
      weatherSource: site?.weather_source ?? null,
    },
    layout: {
      id: layout?.id ?? null,
      name: layout?.name ?? null,
      layoutNumber: layout?.layout_number ?? null,
      status: layout?.status ?? null,
      arrayDcKwp,
      moduleCount,
      gcr: Number(params.gcr ?? 0.35),
    },
    stringing: { dcWiringLossPct, inverterAcKw, loadingPct, dcAcRatio, stringCount },
    bess: {
      configured: Boolean(bess && (bess.energy_mwh || bess.power_mw)),
      energyMwh: bess?.energy_mwh ?? null,
      powerMw: bess?.power_mw ?? null,
    },
    sources: {
      ghi: `site_config.weather (${site?.weather_source ?? "none"})`,
      soiling: "site_config.weather.soiling_monthly_pct",
      albedo: "site_config.albedo",
      tilt_deg: "site_config.targets",
      azimuth_deg: "site_config.targets",
      tracker: "site_config.targets.mounting_type",
      grid_limit_kw: "site_config.grid.max_export_kw",
      array_dc_kwp: layout?.id ? "pv_layouts.totals" : "site_config.targets",
      gcr: "pv_layouts.params",
      dc_wiring_loss_pct: "pv_strings.cable",
      inverter_ac_kw: "pv_string_assignments",
      ambient_temp: "site_config.weather.avg_ambient_c",
      bess: "project_bess_config",
    },
  };
}

/** Approval instance detail shown in the review panel. */
export async function approvalDetail(context: AuthContext, simulationId: string) {
  const { data, error } = await context.supabase
    .from("approval_instances")
    .select("id, status, requested_at, current_step, decided_at")
    .eq("entity_type", "pv_simulation")
    .eq("entity_id", simulationId)
    .order("requested_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] ?? null) as {
    id: string;
    status: string;
    requested_at: string;
    current_step: number | null;
    decided_at: string | null;
  } | null;
}
