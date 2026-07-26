// P-175 — Performance analytics orchestration.
// Queries live here; every calculation is delegated to the pure module
// src/lib/scada/analytics.ts so it stays unit-testable.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  availabilityPct,
  classifyDowntime,
  compareToGuarantee,
  dataQuality,
  expectedDailyKwhFromMonthlyProfile,
  lostEnergyKwh,
  performanceRatio,
  rankAssetPerformance,
  type AnalyticsAlarm,
  type AnalyticsEvent,
  type AnalyticsWorkOrder,
  type AssetPerformanceRow,
  type DowntimeClass,
  type ExpectedPowerSample,
  type PpaGuaranteeTerms,
  type GuaranteeResult,
} from "@/lib/scada/analytics";

const DAY_MINUTES = 24 * 60;
const POLL_INTERVAL_MINUTES = 5;

export interface AnalyticsResult {
  projectId: string;
  projectName: string;
  day: string;
  actualEnergyKwh: number | null;
  expectedEnergyKwh: number | null;
  lostEnergyKwh: number;
  downtimeMinutes: number;
  downtimeBreakdown: Array<{ cls: DowntimeClass; minutes: number }>;
  availabilityPct: number | null;
  contractualAvailabilityPct: number | null;
  performanceRatioPct: number | null;
  irradianceKwhM2: number | null;
  nameplateKw: number | null;
  dataQuality: ReturnType<typeof dataQuality>;
  guarantee: GuaranteeResult;
  assets: { rows: AssetPerformanceRow[]; top: AssetPerformanceRow[]; bottom: AssetPerformanceRow[] };
  trend: Array<{ day: string; actualKwh: number | null; expectedKwh: number | null }>;
  hasBaseline: boolean;
}

function isMissingRelation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "42P01";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function resolveCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 400 });
  return cid;
}

export async function listAnalyticsProjects(
  context: AuthContext,
): Promise<Array<{ id: string; name: string }>> {
  const cid = await resolveCompanyId(context);
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, name")
    .eq("company_id", cid)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/** Sum kWh telemetry over a window, per asset and in total. */
function sumEnergy(rows: Array<{ scada_asset_id: string; metric: string; value: number }>) {
  const perAsset = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.metric !== "energy_kwh") continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    total += v;
    perAsset.set(r.scada_asset_id, (perAsset.get(r.scada_asset_id) ?? 0) + v);
  }
  return { perAsset, total };
}

export async function computeAnalytics(
  context: AuthContext,
  projectId: string,
  day: string,
  excludeGrid: boolean,
): Promise<AnalyticsResult> {
  const cid = await resolveCompanyId(context);
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAY_MINUTES * 60_000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [projectRes, telemetryRes, eventsRes, alarmsRes, woRes, assetsRes, pvRes, yieldRes] =
    await Promise.all([
      context.supabase.from("projects").select("id, name").eq("id", projectId).maybeSingle(),
      context.supabase
        .from("scada_telemetry")
        .select("scada_asset_id, metric, value, ts, quality")
        .eq("company_id", cid)
        .eq("project_id", projectId)
        .gte("ts", startIso)
        .lt("ts", endIso)
        .limit(100000),
      context.supabase
        .from("scada_events")
        .select("event_type, severity, occurred_at")
        .eq("company_id", cid)
        .eq("project_id", projectId)
        .gte("occurred_at", startIso)
        .lt("occurred_at", endIso)
        .limit(5000),
      context.supabase
        .from("scada_alarms")
        .select("severity, raised_at, cleared_at")
        .eq("company_id", cid)
        .eq("project_id", projectId)
        .gte("raised_at", new Date(start.getTime() - 7 * 24 * 3600_000).toISOString())
        .lt("raised_at", endIso)
        .limit(5000),
      context.supabase
        .from("work_orders")
        .select("type, scheduled_date, created_at, completed_at, closed_at")
        .eq("company_id", cid)
        .eq("project_id", projectId)
        .limit(2000),
      context.supabase
        .from("scada_assets")
        .select("id, name, asset_type")
        .eq("company_id", cid)
        .eq("project_id", projectId),
      context.supabase
        .from("project_pv_config")
        .select("dc_capacity_mwp, dc_ac_ratio")
        .eq("project_id", projectId)
        .maybeSingle(),
      context.supabase
        .from("project_yield_config")
        .select("p50_mwh, results")
        .eq("project_id", projectId)
        .maybeSingle(),
    ]);

  if (projectRes.error) throw projectRes.error;
  const project = projectRes.data as { id: string; name: string } | null;
  if (!project) throw Object.assign(new Error("project_not_found"), { statusCode: 404 });

  const telemetry = (telemetryRes.error ? [] : (telemetryRes.data ?? [])) as Array<{
    scada_asset_id: string;
    metric: string;
    value: number;
    ts: string;
    quality: string;
  }>;
  const events = (eventsRes.error ? [] : (eventsRes.data ?? [])) as AnalyticsEvent[];
  const alarms = (alarmsRes.error ? [] : (alarmsRes.data ?? [])) as AnalyticsAlarm[];
  const workOrders = (woRes.error ? [] : (woRes.data ?? [])) as AnalyticsWorkOrder[];
  const assets = (assetsRes.error ? [] : (assetsRes.data ?? [])) as Array<{
    id: string;
    name: string;
    asset_type: string;
  }>;

  const window = { start: start.getTime(), end: end.getTime() };
  const downtime = classifyDowntime(events, alarms, workOrders, window);

  // Actual energy
  const { perAsset, total } = sumEnergy(telemetry);
  const actualEnergyKwh = telemetry.length > 0 ? Number(total.toFixed(3)) : null;

  // Irradiance (Wh/m² integrated from W/m² samples at the poll interval)
  const irradianceSamples = telemetry.filter((t) => t.metric === "irradiance_wm2");
  const irradianceKwhM2 =
    irradianceSamples.length > 0
      ? Number(
          (
            irradianceSamples.reduce((s, t) => s + (Number(t.value) || 0), 0) *
            (POLL_INTERVAL_MINUTES / 60) /
            1000
          ).toFixed(4),
        )
      : null;

  const dcMw = num(pvRes.error ? null : (pvRes.data as { dc_capacity_mwp: number } | null)?.dc_capacity_mwp);
  const nameplateKw = dcMw != null ? dcMw * 1000 : null;

  // Expected power curve — irradiance-scaled nameplate, sampled at telemetry cadence.
  const expectedCurve: ExpectedPowerSample[] =
    nameplateKw != null
      ? irradianceSamples.map((t) => ({
          ts: t.ts,
          expected_power_kw: (Number(t.value) / 1000) * nameplateKw,
        }))
      : [];

  const downIntervals = Object.values(downtime.intervalsByClass).flat();
  const lost = lostEnergyKwh(downIntervals, expectedCurve, POLL_INTERVAL_MINUTES);

  const availability = availabilityPct(DAY_MINUTES, downtime.totalMinutes);
  const contractual = availabilityPct(DAY_MINUTES, downtime.totalMinutes, {
    excludeGrid: true,
    gridOutageMinutes: downtime.byClass.grid_outage,
  });

  const pr = performanceRatio(actualEnergyKwh, irradianceKwhM2, nameplateKw);

  const expectedSampleStreams = Math.max(1, assets.length);
  const dq = dataQuality(
    DAY_MINUTES * expectedSampleStreams,
    POLL_INTERVAL_MINUTES,
    telemetry.map((t) => t.quality ?? "good"),
  );

  // Batch 17 baseline (graceful when absent)
  const yieldRow = yieldRes.error ? null : (yieldRes.data as { p50_mwh: number | null; results: unknown } | null);
  const monthly = extractMonthlyProfile(yieldRow?.results);
  let expectedEnergyKwh = expectedDailyKwhFromMonthlyProfile(monthly, start);
  if (expectedEnergyKwh == null && yieldRow?.p50_mwh != null) {
    expectedEnergyKwh = Number(((Number(yieldRow.p50_mwh) * 1000) / 365).toFixed(3));
  }

  // ppa_terms guarantees (graceful when the table or row is absent)
  interface PpaRow {
    availability_target_pct: number | null;
    annual_energy_mwh: number | null;
  }
  let terms: PpaRow | null = null;
  const ppaRes = await context.supabase
    .from("ppa_terms")
    .select("availability_target_pct, annual_energy_mwh")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!ppaRes.error || isMissingRelation(ppaRes.error)) {
    terms = (ppaRes.data as PpaRow | null) ?? null;
  }
  const contractPr = num(
    yieldRes.error ? null : (yieldRes.data as { contract_pr?: number } | null)?.contract_pr,
  );
  const guaranteedPrPct = contractPr != null ? contractPr * 100 : null;

  const guaranteeTerms: PpaGuaranteeTerms | null =
    terms != null
      ? {
          availability_target_pct: terms.availability_target_pct,
          annual_energy_mwh: terms.annual_energy_mwh,
          guaranteed_pr_pct: guaranteedPrPct,
        }
      : guaranteedPrPct != null
        ? { guaranteed_pr_pct: guaranteedPrPct }
        : null;

  const guarantee = compareToGuarantee(
    {
      availabilityPct: excludeGrid ? contractual : availability,
      performanceRatioPct: pr,
      energyKwh: actualEnergyKwh,
      energyPeriodFraction: 1 / 365,
    },
    guaranteeTerms,
  );


  // Per-asset performance: share the project baseline across producing assets.
  const producing = assets.filter((a) => perAsset.has(a.id));
  const perAssetExpected =
    expectedEnergyKwh != null && producing.length > 0 ? expectedEnergyKwh / producing.length : null;
  const assetPerf = rankAssetPerformance(
    producing.map((a) => ({
      assetId: a.id,
      name: a.name,
      actualKwh: Number((perAsset.get(a.id) ?? 0).toFixed(2)),
      expectedKwh: perAssetExpected,
    })),
  );

  const trend = await loadTrend(context, cid, projectId, day, monthly, yieldRow?.p50_mwh ?? null);

  return {
    projectId,
    projectName: project.name,
    day,
    actualEnergyKwh,
    expectedEnergyKwh,
    lostEnergyKwh: lost,
    downtimeMinutes: downtime.totalMinutes,
    downtimeBreakdown: (Object.keys(downtime.byClass) as DowntimeClass[]).map((cls) => ({
      cls,
      minutes: downtime.byClass[cls],
    })),
    availabilityPct: availability,
    contractualAvailabilityPct: contractual,
    performanceRatioPct: pr,
    irradianceKwhM2,
    nameplateKw,
    dataQuality: dq,
    guarantee,
    assets: assetPerf,
    trend,
    hasBaseline: expectedEnergyKwh != null,
  };
}

/** Pull a 12-length monthly MWh array out of a Batch 17 results payload. */
export function extractMonthlyProfile(results: unknown): number[] | null {
  if (!results || typeof results !== "object") return null;
  const r = results as Record<string, unknown>;
  const candidates = [r.monthly_mwh, r.monthlyEnergyMwh, r.monthly, r.monthly_energy_mwh];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length >= 12) {
      const nums = c.map((v) => (typeof v === "number" ? v : Number((v as { mwh?: number })?.mwh)));
      if (nums.every((n) => Number.isFinite(n))) return nums as number[];
    }
  }
  return null;
}

async function loadTrend(
  context: AuthContext,
  companyId: string,
  projectId: string,
  day: string,
  monthly: number[] | null,
  p50Mwh: number | null,
): Promise<AnalyticsResult["trend"]> {
  const end = new Date(`${day}T00:00:00.000Z`);
  const start = new Date(end.getTime() - 29 * 24 * 3600_000);
  const { data, error } = await context.supabase
    .from("scada_kpi_daily")
    .select("day, actual_energy_kwh, expected_energy_kwh")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .gte("day", start.toISOString().slice(0, 10))
    .lte("day", day)
    .order("day");
  const snapshots = new Map<string, { actual: number | null; expected: number | null }>();
  if (!error) {
    for (const row of (data ?? []) as Array<{
      day: string;
      actual_energy_kwh: number | null;
      expected_energy_kwh: number | null;
    }>) {
      snapshots.set(row.day, {
        actual: num(row.actual_energy_kwh),
        expected: num(row.expected_energy_kwh),
      });
    }
  }
  const out: AnalyticsResult["trend"] = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(start.getTime() + i * 24 * 3600_000);
    const key = d.toISOString().slice(0, 10);
    const snap = snapshots.get(key);
    const baseline =
      expectedDailyKwhFromMonthlyProfile(monthly, d) ??
      (p50Mwh != null ? Number(((Number(p50Mwh) * 1000) / 365).toFixed(3)) : null);
    out.push({ day: key, actualKwh: snap?.actual ?? null, expectedKwh: snap?.expected ?? baseline });
  }
  return out;
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
      p_metadata: metadata as never,
    });
  } catch {
    // audit must never fail the request
  }
}

export async function upsertDailyKpis(
  context: AuthContext,
  projectId: string,
  day: string,
): Promise<{ id: string; day: string }> {
  const cid = await resolveCompanyId(context);
  const result = await computeAnalytics(context, projectId, day, false);
  const breakdown: Record<string, number> = {};
  for (const b of result.downtimeBreakdown) breakdown[b.cls] = b.minutes;

  const { data, error } = await context.supabase
    .from("scada_kpi_daily")
    .upsert(
      {
        company_id: cid,
        project_id: projectId,
        day,
        actual_energy_kwh: result.actualEnergyKwh,
        expected_energy_kwh: result.expectedEnergyKwh,
        lost_energy_kwh: result.lostEnergyKwh,
        downtime_minutes: Math.round(result.downtimeMinutes),
        availability_pct: result.availabilityPct,
        performance_ratio_pct: result.performanceRatioPct,
        data_quality_pct: result.dataQuality.qualityPct,
        downtime_breakdown: breakdown as never,
        guarantee_check: result.guarantee as never,
        computed_at: new Date().toISOString(),
        created_by: context.user!.id,
      },
      { onConflict: "project_id,day" },
    )
    .select("id, day")
    .single();
  if (error) throw error;

  await writeAuditLog(context, "scada.kpi_compute", "scada_kpi_daily", (data as { id: string }).id, {
    project_id: projectId,
    day,
    availability_pct: result.availabilityPct,
    performance_ratio_pct: result.performanceRatioPct,
    lost_energy_kwh: result.lostEnergyKwh,
  });

  return data as { id: string; day: string };
}
