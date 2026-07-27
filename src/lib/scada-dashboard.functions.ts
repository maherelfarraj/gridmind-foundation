// P-104 — Live SCADA dashboard server functions.
// Read-only; RLS-scoped via requireSupabaseAuth (is_company_member).
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  bucketPowerCurve,
  energyDelta,
  getPlantDetailInput,
  getScadaDashboardInput,
  isStale,
  latestPerAsset,
  performanceRatio,
  utcMidnightIso,
  type DashboardPayload,
  type PlantDetailPayload,
  type PlantRow,
  type TelemetryRow,
} from "@/lib/scada-dashboard.rules";

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) httpError(400, "no_company");
  return cid as string;
}

interface AssetRow {
  id: string;
  project_id: string;
  asset_type: string;
  name: string;
  equipment_id: string | null;
}
interface ProjectRow {
  id: string;
  name: string;
  phase: string;
}
interface EquipmentRow {
  id: string;
  project_id: string;
  nameplate_capacity_kw: number | null;
}

async function loadCore(context: AuthContext, opts: { projectId?: string }) {
  const companyId = await currentCompanyId(context);
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = utcMidnightIso(now);
  console.log("[scada-debug] server now", now.toISOString(), "windowStart", windowStart, "projectId", opts.projectId);

  // Assets in scope (company + optional project filter)
  let assetsQ = context.supabase
    .from("scada_assets")
    .select("id, project_id, asset_type, name, equipment_id")
    .eq("company_id", companyId);
  if (opts.projectId) assetsQ = assetsQ.eq("project_id", opts.projectId);
  const { data: assetsData, error: aErr } = await assetsQ;
  if (aErr) throw aErr;
  const assets = (assetsData ?? []) as AssetRow[];
  const assetIds = assets.map((a) => a.id);

  // Projects in scope
  const projectIds = Array.from(new Set(assets.map((a) => a.project_id)));
  const projects: ProjectRow[] = [];
  if (projectIds.length > 0) {
    const { data: projData, error: pErr } = await context.supabase
      .from("projects")
      .select("id, name, phase")
      .in("id", projectIds);
    if (pErr) throw pErr;
    projects.push(...((projData ?? []) as ProjectRow[]));
  }

  // Equipment nameplate for capacity + PR math
  const equipIds = assets.map((a) => a.equipment_id).filter(Boolean) as string[];
  const equipment: EquipmentRow[] = [];
  if (equipIds.length > 0) {
    const { data: eData, error: eErr } = await context.supabase
      .from("equipment_registry")
      .select("id, project_id, nameplate_capacity_kw")
      .in("id", equipIds);
    if (eErr) throw eErr;
    equipment.push(...((eData ?? []) as EquipmentRow[]));
  }

  // Telemetry window: last 24h for the assets in scope
  let telemetry: TelemetryRow[] = [];
  if (assetIds.length > 0) {
    const { data: tData, error: tErr } = await context.supabase
      .from("scada_telemetry")
      .select("scada_asset_id, ts, metric, value")
      .in("scada_asset_id", assetIds)
      .gte("ts", windowStart)
      .order("ts", { ascending: true })
      .limit(50_000);
    if (tErr) throw tErr;
    telemetry = ((tData ?? []) as unknown[]).map((r) => {
      const row = r as {
        scada_asset_id: string;
        ts: string;
        metric: string;
        value: number | string;
      };
      return {
        scada_asset_id: row.scada_asset_id,
        ts: row.ts,
        metric: row.metric,
        value: typeof row.value === "string" ? Number(row.value) : row.value,
      };
    });
    const latestTs = telemetry.length
      ? telemetry.reduce((max, r) => (r.ts > max ? r.ts : max), telemetry[0]!.ts)
      : null;
    console.log("[scada-debug] telemetry rows", telemetry.length, "latestTs", latestTs);
  }

  return {
    companyId,
    assets,
    projects,
    equipment,
    telemetry,
    windowStart,
    windowEnd,
    todayStart,
  };
}

function computePlantRows(input: {
  assets: AssetRow[];
  projects: ProjectRow[];
  equipment: EquipmentRow[];
  telemetry: TelemetryRow[];
  todayStart: string;
}): PlantRow[] {
  const { assets, projects, equipment, telemetry, todayStart } = input;
  const assetsByProject = new Map<string, AssetRow[]>();
  for (const a of assets) {
    const list = assetsByProject.get(a.project_id) ?? [];
    list.push(a);
    assetsByProject.set(a.project_id, list);
  }
  const nameplateByProject = new Map<string, number>();
  for (const e of equipment) {
    if (!e.nameplate_capacity_kw) continue;
    nameplateByProject.set(
      e.project_id,
      (nameplateByProject.get(e.project_id) ?? 0) + Number(e.nameplate_capacity_kw),
    );
  }

  const rows: PlantRow[] = [];
  for (const project of projects) {
    const projectAssets = assetsByProject.get(project.id) ?? [];
    const assetIdSet = new Set(projectAssets.map((a) => a.id));
    const projTelemetry = telemetry.filter((t) => assetIdSet.has(t.scada_asset_id));
    const latestPower = latestPerAsset(projTelemetry, "ac_power_kw");
    let currentKw = 0;
    let lastSeenAt: string | null = null;
    for (const { ts, value } of latestPower.values()) {
      currentKw += value;
      if (!lastSeenAt || ts > lastSeenAt) lastSeenAt = ts;
    }
    const todayKwh = energyDelta(projTelemetry, todayStart);
    rows.push({
      projectId: project.id,
      name: project.name,
      capacityMw: Number(((nameplateByProject.get(project.id) ?? 0) / 1000).toFixed(3)),
      currentPowerKw: Number(currentKw.toFixed(2)),
      todayEnergyKwh: Number(todayKwh.toFixed(2)),
      availabilityPct: null, // wires up in P-105/P-106
      activeAlarms: 0,
      lastSeenAt,
      stale: isStale(lastSeenAt),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function computePayload(
  core: Awaited<ReturnType<typeof loadCore>>,
  scopeProjectId: string | null,
): DashboardPayload {
  const { assets, projects, equipment, telemetry, windowStart, windowEnd, todayStart } = core;

  const plants = computePlantRows({ assets, projects, equipment, telemetry, todayStart });

  // Fleet-wide tiles from all rows.
  const latestPower = latestPerAsset(telemetry, "ac_power_kw");
  let fleetPowerKw = 0;
  for (const { ts, value } of latestPower.values()) {
    // only count assets seen in the last 15 minutes as "now"
    if (Date.now() - new Date(ts).getTime() <= 15 * 60 * 1000) fleetPowerKw += value;
  }
  const energyTodayKwh = energyDelta(telemetry, todayStart);

  // Weather availability + PR
  const weatherAssetIds = new Set(
    assets.filter((a) => a.asset_type === "weather_station").map((a) => a.id),
  );
  const irradiance = telemetry
    .filter((t) => t.metric === "irradiance_wm2" && weatherAssetIds.has(t.scada_asset_id))
    .map((t) => ({ ts: t.ts, value: Number(t.value) }));
  const nameplateKw = equipment.reduce((sum, e) => sum + (Number(e.nameplate_capacity_kw) || 0), 0);
  const performanceRatioPct = performanceRatio({
    actualKwh: energyTodayKwh,
    irradianceSeries: irradiance,
    nameplateKw,
  });

  const powerCurve = bucketPowerCurve(telemetry, 5);

  return {
    scope: { projectId: scopeProjectId },
    tiles: {
      fleetPowerKw: Number(fleetPowerKw.toFixed(2)),
      energyTodayKwh: Number(energyTodayKwh.toFixed(2)),
      availabilityPct: null,
      performanceRatioPct,
      activeAlarms: null,
    },
    powerCurve,
    plants,
    weatherAvailable: weatherAssetIds.size > 0,
    windowStart,
    windowEnd,
  };
}

// ---- Server functions -----------------------------------------------------

export const listOperationsPlants = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ projects: { id: string; name: string; phase: string }[] }> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      // "Operations" = has at least one scada_asset (i.e. an operating plant with
      // a live SCADA stream configured). Falls back to all company projects when
      // no assets exist yet so the selector isn't empty during onboarding.
      const { data: assetsData, error: aErr } = await context.supabase
        .from("scada_assets")
        .select("project_id")
        .eq("company_id", companyId);
      if (aErr) throw aErr;
      const projectIds = Array.from(
        new Set(((assetsData ?? []) as { project_id: string }[]).map((a) => a.project_id)),
      );
      if (projectIds.length === 0) return { projects: [] };
      const { data: projData, error: pErr } = await context.supabase
        .from("projects")
        .select("id, name, phase")
        .in("id", projectIds)
        .order("name");
      if (pErr) throw pErr;
      return { projects: (projData ?? []) as { id: string; name: string; phase: string }[] };
    },
  );

export const getScadaDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => getScadaDashboardInput.parse(raw))
  .handler(async ({ data, context }): Promise<DashboardPayload> => {
    requireSupabaseAuth(context);
    const core = await loadCore(context, { projectId: data.projectId });
    return computePayload(core, data.projectId ?? null);
  });

export const getPlantDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => getPlantDetailInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlantDetailPayload> => {
    requireSupabaseAuth(context);
    const core = await loadCore(context, { projectId: data.projectId });
    const payload = computePayload(core, data.projectId);
    const plant = payload.plants[0] ?? null;

    // Per-inverter breakdown
    const inverters = core.assets.filter((a) => a.asset_type === "inverter");
    const inverterIds = new Set(inverters.map((i) => i.id));
    const invTelemetry = core.telemetry.filter((t) => inverterIds.has(t.scada_asset_id));
    const latestPower = latestPerAsset(invTelemetry, "ac_power_kw");
    const perInverter = inverters
      .map((inv) => {
        const lp = latestPower.get(inv.id);
        const invRows = invTelemetry.filter((t) => t.scada_asset_id === inv.id);
        const todayKwh = energyDelta(invRows, core.todayStart);
        return {
          assetId: inv.id,
          name: inv.name,
          currentKw: lp ? Number(lp.value.toFixed(2)) : 0,
          todayKwh: Number(todayKwh.toFixed(2)),
          lastSeen: lp?.ts ?? null,
        };
      })
      .sort((a, b) => b.currentKw - a.currentKw);

    return { ...payload, plant, perInverter };
  });
