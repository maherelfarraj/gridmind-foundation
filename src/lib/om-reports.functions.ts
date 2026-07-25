// P-110 — Monthly O&M report server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import {
  attachOmReportPdfSchema,
  computeAlarmDowntimeHours,
  computeAlarmSummary,
  computeAvailability,
  computePerformanceRatio,
  computeSpendByType,
  computeWoSummary,
  formatCurrency,
  generateOmReportSchema,
  sumLaborHours,
  type AlarmSlice,
  type OmReportSnapshot,
  type OmReportStatus,
  type OmReportType,
  type WorkOrderSlice,
} from "@/lib/om-reports.rules";

const WRITE_ROLES = ["om_admin", "company_admin"] as const;

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), { statusCode: status });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function assertWriter(context: AuthContext): Promise<void> {
  const results = await Promise.all(
    WRITE_ROLES.map((r) => context.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  if (!results.some((r) => r.data === true)) httpError(403, "forbidden_role");
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "om_reports",
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export interface OmReportRow {
  id: string;
  company_id: string;
  project_id: string;
  report_type: OmReportType;
  period_start: string;
  period_end: string;
  status: OmReportStatus;
  data: OmReportSnapshot;
  pdf_path: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
}

export interface OmReportBrandingDTO {
  primaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoSignedUrl: string | null;
}

export interface OmReportGeneratedDTO {
  report: OmReportRow;
  branding: OmReportBrandingDTO;
  company: { name: string; legalName: string | null };
  project: { id: string; name: string; code: string | null };
}

// ---------------------------------------------------------------------------
// listOmReports
// ---------------------------------------------------------------------------
export const listOmReports = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<OmReportRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    let q = context.supabase
      .from("om_reports")
      .select(
        "id, company_id, project_id, report_type, period_start, period_end, status, data, pdf_path, generated_at, created_at, updated_at, projects(name)",
      )
      .eq("company_id", companyId)
      .order("period_start", { ascending: false })
      .limit(200);
    if (data.projectId) q = q.eq("project_id", data.projectId);

    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map((r: any) => ({
      ...r,
      project_name: r.projects?.name ?? null,
    })) as unknown as OmReportRow[];
  });

// ---------------------------------------------------------------------------
// listOmReportProjects — for the "Generate" dialog picker.
// ---------------------------------------------------------------------------
export const listOmReportProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({ context }): Promise<Array<{ id: string; name: string; code: string | null }>> => {
      requireSupabaseAuth(context);
      const companyId = await currentCompanyId(context);
      const { data, error } = await context.supabase
        .from("projects")
        .select("id, name, code")
        .eq("company_id", companyId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        code: string | null;
      }>;
    },
  );

// ---------------------------------------------------------------------------
// getOmReportDownloadUrl
// ---------------------------------------------------------------------------
export const getOmReportDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ reportId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("om_reports")
      .select("id, company_id, pdf_path")
      .eq("id", data.reportId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    const path = (row as any).pdf_path as string | null;
    if (!path) httpError(404, "pdf_missing");
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(path as string, 900);
    if (sErr) throw sErr;
    return { url: signed?.signedUrl ?? "" };
  });

// ---------------------------------------------------------------------------
// generateOmReport — aggregates + upserts row with `data` jsonb.
// Returns the row + branding so the client can render + upload the PDF.
// ---------------------------------------------------------------------------
export const generateOmReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => generateOmReportSchema.parse(raw))
  .handler(async ({ data, context }): Promise<OmReportGeneratedDTO> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    await assertWriter(context);
    await assertExportAllowed(context.supabase, data.projectId, "om_report");

    // ---- project + capacity ------------------------------------------------
    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, name, code, company_id, capacity_mw, project_financial_config(currency_code)")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj) httpError(404, "project_not_found");
    if ((proj as any).company_id !== companyId) httpError(403, "cross_company");
    const capacityKwp =
      (proj as any).capacity_mw != null ? Number((proj as any).capacity_mw) * 1000 : null;
    // projects has no currency column — read it from project_financial_config.
    const cfg = (proj as any).project_financial_config;
    const projectCurrency =
      ((Array.isArray(cfg) ? cfg[0]?.currency_code : cfg?.currency_code) as string | null) ?? "USD";


    // ---- period math -------------------------------------------------------
    const periodStartIso = `${data.periodStart}T00:00:00.000Z`;
    // period_end is inclusive-of-day; add 24 h to compare timestamps.
    const periodEndIso = new Date(
      Date.parse(`${data.periodEnd}T00:00:00.000Z`) + 86_400_000,
    ).toISOString();
    const periodHours = (Date.parse(periodEndIso) - Date.parse(periodStartIso)) / 36e5;

    // ---- alarms ------------------------------------------------------------
    const { data: alarmRows, error: aErr } = await context.supabase
      .from("scada_alarms")
      .select("id, severity, raised_at, acknowledged_at, cleared_at, rule_id, alarm_rules(name)")
      .eq("project_id", data.projectId)
      .gte("raised_at", periodStartIso)
      .lt("raised_at", periodEndIso);
    if (aErr) throw aErr;
    const alarms: AlarmSlice[] = (alarmRows ?? []).map((r: any) => ({
      id: r.id,
      severity: r.severity,
      raisedAt: r.raised_at,
      acknowledgedAt: r.acknowledged_at,
      clearedAt: r.cleared_at,
      ruleId: r.rule_id,
      ruleName: r.alarm_rules?.name ?? null,
    }));
    const alarmSummary = computeAlarmSummary(alarms);
    const alarmDowntimeHours = computeAlarmDowntimeHours(alarms, periodStartIso, periodEndIso);

    // ---- work orders -------------------------------------------------------
    const { data: woRows, error: wErr } = await context.supabase
      .from("work_orders")
      .select("id, type, status, created_at, closed_at, total_cost, currency_code, labor")
      .eq("project_id", data.projectId)
      .gte("created_at", periodStartIso)
      .lt("created_at", periodEndIso);
    if (wErr) throw wErr;
    const wos: WorkOrderSlice[] = (woRows ?? []).map((r: any) => ({
      type: r.type,
      status: r.status,
      createdAt: r.created_at,
      closedAt: r.closed_at,
      totalCost: Number(r.total_cost ?? 0),
    }));
    const woSummary = computeWoSummary(wos);
    const correctiveWoDowntimeHours = (woRows ?? [])
      .filter((r: any) => r.type === "corrective")
      .reduce((acc: number, r: any) => acc + sumLaborHours(r.labor), 0);

    const downtimeHours = alarmDowntimeHours + correctiveWoDowntimeHours;
    const availability = computeAvailability(periodHours, downtimeHours);

    // ---- performance ratio -------------------------------------------------
    const { data: telemetryRows, error: tErr } = await context.supabase
      .from("scada_telemetry")
      .select("metric, value")
      .eq("project_id", data.projectId)
      .in("metric", ["energy_kwh", "irradiance_wm2"])
      .gte("ts", periodStartIso)
      .lt("ts", periodEndIso);
    if (tErr) throw tErr;
    let actualKwh: number | null = null;
    let irradianceKwhPerM2: number | null = null;
    if (telemetryRows && telemetryRows.length > 0) {
      let energy = 0;
      let energyN = 0;
      let irr = 0;
      let irrN = 0;
      for (const t of telemetryRows as Array<{
        metric: string;
        value: number | string;
      }>) {
        const v = Number(t.value);
        if (!Number.isFinite(v)) continue;
        if (t.metric === "energy_kwh") {
          energy += v;
          energyN += 1;
        } else if (t.metric === "irradiance_wm2") {
          // Irradiance is per-instant W/m² sample — approximate integral
          // over the period assuming samples are hourly.
          irr += v / 1000; // W/m² → kW/m² (per-sample-hour)
          irrN += 1;
        }
      }
      if (energyN > 0) actualKwh = energy;
      if (irrN > 0) irradianceKwhPerM2 = irr;
    }
    const pr = computePerformanceRatio({
      actualKwh,
      irradianceKwhPerM2,
      capacityKwp,
    });

    // ---- spend -------------------------------------------------------------
    const byType = computeSpendByType(wos);
    const byTypeFormatted: Record<string, string> = {};
    let total = 0;
    for (const [k, v] of Object.entries(byType)) {
      byTypeFormatted[k] = formatCurrency(v, projectCurrency);
      total += v;
    }

    const snapshot: OmReportSnapshot = {
      version: 1,
      periodHours,
      availability: {
        value: availability,
        downtimeHours,
        alarmDowntimeHours,
        correctiveWoDowntimeHours,
      },
      performanceRatio: {
        value: pr.value,
        reason: pr.reason,
        actualKwh,
        irradianceKwhPerM2,
        capacityKwp,
      },
      alarms: alarmSummary,
      workOrders: woSummary,
      spend: {
        currency: projectCurrency,
        byType,
        byTypeFormatted,
        total,
        totalFormatted: formatCurrency(total, projectCurrency),
      },
    };

    // ---- upsert ------------------------------------------------------------
    const nowIso = new Date().toISOString();
    const upsertPayload = {
      company_id: companyId,
      project_id: data.projectId,
      report_type: data.reportType,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      status: "generated" as const,
      data: snapshot as unknown as Record<string, unknown>,
      generated_by: context.user!.id,
      generated_at: nowIso,
      created_by: context.user!.id,
    };

    const { data: saved, error: uErr } = await context.supabase
      .from("om_reports")
      .upsert(upsertPayload as any, {
        onConflict: "project_id,report_type,period_start",
      })
      .select(
        "id, company_id, project_id, report_type, period_start, period_end, status, data, pdf_path, generated_at, created_at, updated_at",
      )
      .single();
    if (uErr) throw uErr;

    await audit(context, "om_report.generate", (saved as any).id, {
      project_id: data.projectId,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      report_type: data.reportType,
    });

    // ---- branding + company for the PDF ------------------------------------
    const [companyRes, brandingRes] = await Promise.all([
      context.supabase
        .from("companies")
        .select("name, legal_name")
        .eq("id", companyId)
        .maybeSingle(),
      context.supabase
        .from("company_branding")
        .select("logo_url, primary_color, accent_color, footer_text")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    let logoSignedUrl: string | null = null;
    const logoPath = (brandingRes.data as any)?.logo_url ?? null;
    if (logoPath) {
      const { data: signed } = await context.supabase.storage
        .from("documents")
        .createSignedUrl(logoPath, 900);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    return {
      report: saved as unknown as OmReportRow,
      branding: {
        primaryColor: (brandingRes.data as any)?.primary_color ?? null,
        accentColor: (brandingRes.data as any)?.accent_color ?? null,
        footerText: (brandingRes.data as any)?.footer_text ?? null,
        logoSignedUrl,
      },
      company: {
        name: (companyRes.data as any)?.name ?? "Company",
        legalName: (companyRes.data as any)?.legal_name ?? null,
      },
      project: {
        id: (proj as any).id,
        name: (proj as any).name,
        code: (proj as any).code ?? null,
      },
    };
  });

// ---------------------------------------------------------------------------
// attachOmReportPdf — client uploads PDF to storage, then calls this to
// persist pdf_path and register in export_packages (best-effort).
// TODO(B12/P-117): register with scheduled_reports for monthly email delivery.
// ---------------------------------------------------------------------------
export const attachOmReportPdf = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attachOmReportPdfSchema.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    await assertWriter(context);

    const { data: row, error } = await context.supabase
      .from("om_reports")
      .select("id, company_id, project_id, period_start, report_type")
      .eq("id", data.reportId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");

    const { error: uErr } = await context.supabase
      .from("om_reports")
      .update({ pdf_path: data.pdfPath } as any)
      .eq("id", (row as any).id);
    if (uErr) throw uErr;

    // Best-effort export-center registration (42P01 = table not deployed).
    try {
      const { data: proj } = await context.supabase
        .from("projects")
        .select("name")
        .eq("id", (row as any).project_id)
        .maybeSingle();
      const period = String((row as any).period_start).slice(0, 7);
      await context.supabase.from("export_packages").insert({
        company_id: companyId,
        project_id: (row as any).project_id,
        package_type: "om_report",
        title: `O&M report — ${(proj as any)?.name ?? "project"} · ${period}`,
        file_path: data.pdfPath,
        metadata: {
          report_id: (row as any).id,
          report_type: (row as any).report_type,
          period_start: (row as any).period_start,
        },
        created_by: context.user!.id,
      } as any);
    } catch (e: any) {
      if (e?.code !== "42P01") {
        console.warn("export_packages insert failed", e);
      }
    }

    return { ok: true };
  });
