// P-092 — Weekly client report data aggregator + export audit gate.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  addDays,
  endOfISOWeek,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
  subMonths,
} from "date-fns";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { computeTrir } from "@/lib/hse.rules";

const LOGO_BUCKET = "documents";
const PHOTOS_BUCKET = "photos";
const SIGNED_URL_TTL = 900; // 15 min

const EXPORT_ROLES = new Set([
  "construction_admin",
  "project_admin",
  "company_admin",
  "super_admin",
]);

const input = z.object({
  projectId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------
export interface WeeklyReportBrandingDTO {
  primaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  logoSignedUrl: string | null;
}

export interface WeeklyReportProjectDTO {
  id: string;
  name: string;
  code: string | null;
  archetype: string | null;
  capacityMw: number | null;
}

export interface WeeklyReportDailyRowDTO {
  reportDate: string;
  shift: string;
  totalManpower: number;
  totalHours: number;
  weatherSummary: string | null;
  workSummary: string | null;
}

export interface WeeklyReportWeatherDelayDTO {
  delayType: string;
  hours: number;
  count: number;
}

export interface WeeklyReportDisciplineRowDTO {
  discipline: string;
  area: string;
  uom: string | null;
  planned: number;
  installedThisWeek: number;
  dailyRate: number;
}

export interface WeeklyReportPhotoDTO {
  filePath: string;
  signedUrl: string | null;
  caption: string | null;
  takenAt: string;
}

export interface WeeklyReportHseDTO {
  incidentsByType: Array<{ type: string; count: number }>;
  recordablesThisWeek: number;
  trir12m: number | null;
  hours12m: number;
  recordables12m: number;
}

export interface WeeklyReportQaDTO {
  inspectionsRun: number;
  passRate: number | null;
  reworkPct: number | null;
  openPunchByCategory: { A: number; B: number; C: number };
}

export interface WeeklyReportLookaheadDTO {
  topWeatherImpacts: Array<{ delayType: string; hours: number }>;
  plannedAreas: Array<{ name: string; discipline: string | null; start: string }>;
}

export interface WeeklyReportKpisDTO {
  spi: number | null;
  cpi: number | null;
  trir12m: number | null;
  reworkPct: number | null;
}

export interface WeeklyReportDTO {
  project: WeeklyReportProjectDTO;
  company: { name: string; legalName: string | null };
  branding: WeeklyReportBrandingDTO;
  weekStart: string;
  weekEnd: string;
  isoWeekLabel: string; // e.g. "2026-W12"
  kpis: WeeklyReportKpisDTO;
  daily: WeeklyReportDailyRowDTO[];
  weather: WeeklyReportWeatherDelayDTO[];
  disciplines: WeeklyReportDisciplineRowDTO[];
  hse: WeeklyReportHseDTO;
  qa: WeeklyReportQaDTO;
  photos: WeeklyReportPhotoDTO[];
  lookahead: WeeklyReportLookaheadDTO;
  permissions: { canExport: boolean; roles: string[] };
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), { statusCode: status });
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function assertProject(
  context: AuthContext,
  projectId: string,
): Promise<{
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  archetype: string | null;
  capacity_mw: number | null;
}> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name, code, archetype, capacity_mw")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as any;
}

function isoWeekLabel(weekStart: string): string {
  const d = parseISO(weekStart);
  const yr = getISOWeekYear(d);
  const wk = getISOWeek(d);
  return `${yr}-W${String(wk).padStart(2, "0")}`;
}

interface DprQuantityLine {
  wbs_item_id?: string | null;
  discipline?: string | null;
  area?: string | null;
  uom?: string | null;
  quantity?: number | string | null;
}

function parseQuantities(raw: unknown): DprQuantityLine[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as DprQuantityLine[];
  if (typeof raw === "object" && Array.isArray((raw as any).items))
    return (raw as any).items as DprQuantityLine[];
  return [];
}

// ---------------------------------------------------------------------------
// getWeeklyReportData
// ---------------------------------------------------------------------------
export const getWeeklyReportData = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw) => input.parse(raw))
  .handler(async ({ data, context }): Promise<WeeklyReportDTO> => {
    requireSupabaseAuth(context);
    const { supabase } = context;

    const project = await assertProject(context, data.projectId);
    const weekStartDate = startOfISOWeek(parseISO(data.weekStart));
    const weekStart = format(weekStartDate, "yyyy-MM-dd");
    const weekEnd = format(endOfISOWeek(weekStartDate), "yyyy-MM-dd");
    const nextWeekStart = format(addDays(weekStartDate, 7), "yyyy-MM-dd");
    const nextWeekEnd = format(addDays(weekStartDate, 13), "yyyy-MM-dd");
    const twelveMoAgo = format(subMonths(weekStartDate, 12), "yyyy-MM-dd");

    // ---- roles / branding ---------------------------------------------------
    const roles = await currentRoles(context);
    const canExport = roles.some((r) => EXPORT_ROLES.has(r));

    const [companyRes, brandingRes] = await Promise.all([
      supabase
        .from("companies")
        .select("name, legal_name")
        .eq("id", project.company_id)
        .maybeSingle(),
      supabase
        .from("company_branding")
        .select("logo_url, primary_color, accent_color, footer_text")
        .eq("company_id", project.company_id)
        .maybeSingle(),
    ]);
    if (companyRes.error) throw companyRes.error;
    if (brandingRes.error) throw brandingRes.error;

    let logoSignedUrl: string | null = null;
    if (brandingRes.data?.logo_url) {
      const { data: signed } = await supabase.storage
        .from(LOGO_BUCKET)
        .createSignedUrl(brandingRes.data.logo_url, SIGNED_URL_TTL);
      logoSignedUrl = signed?.signedUrl ?? null;
    }

    // ---- DPRs in week -------------------------------------------------------
    const { data: dprRows, error: dprErr } = await supabase
      .from("construction_daily_reports")
      .select(
        "id, report_date, shift, total_manpower, total_hours, weather_summary, work_summary, quantities, status",
      )
      .eq("project_id", data.projectId)
      .in("status", ["submitted", "approved"])
      .gte("report_date", weekStart)
      .lte("report_date", weekEnd)
      .order("report_date", { ascending: true });
    if (dprErr) throw dprErr;
    const dprs = (dprRows ?? []) as any[];

    const daily: WeeklyReportDailyRowDTO[] = dprs.map((r) => ({
      reportDate: r.report_date,
      shift: r.shift,
      totalManpower: Number(r.total_manpower ?? 0),
      totalHours: Number(r.total_hours ?? 0),
      weatherSummary: r.weather_summary,
      workSummary: r.work_summary,
    }));

    // ---- weather delays (week + top-of-lookahead) ---------------------------
    const { data: weatherRows, error: weatherErr } = await supabase
      .from("weather_delays")
      .select("delay_type, lost_hours")
      .eq("project_id", data.projectId)
      .gte("delay_date", weekStart)
      .lte("delay_date", weekEnd);
    if (weatherErr) throw weatherErr;
    const weatherAgg = new Map<string, { hours: number; count: number }>();
    for (const w of weatherRows ?? []) {
      const key = String((w as any).delay_type);
      const cur = weatherAgg.get(key) ?? { hours: 0, count: 0 };
      cur.hours += Number((w as any).lost_hours ?? 0);
      cur.count += 1;
      weatherAgg.set(key, cur);
    }
    const weather: WeeklyReportWeatherDelayDTO[] = Array.from(weatherAgg.entries())
      .map(([delayType, v]) => ({ delayType, hours: v.hours, count: v.count }))
      .sort((a, b) => b.hours - a.hours);

    // ---- discipline / area rollup ------------------------------------------
    const perKey = new Map<
      string,
      { discipline: string; area: string; wbsIds: Set<string>; qty: number; days: Set<string> }
    >();
    const wbsIds = new Set<string>();
    for (const r of dprs) {
      for (const q of parseQuantities(r.quantities)) {
        const disc = String(q.discipline ?? "").trim() || "unassigned";
        const area = String(q.area ?? "").trim() || "—";
        const key = `${disc}|${area}`;
        const rec = perKey.get(key) ?? {
          discipline: disc,
          area,
          wbsIds: new Set<string>(),
          qty: 0,
          days: new Set<string>(),
        };
        rec.qty += Number(q.quantity ?? 0);
        rec.days.add(r.report_date);
        if (q.wbs_item_id) {
          rec.wbsIds.add(q.wbs_item_id);
          wbsIds.add(q.wbs_item_id);
        }
        perKey.set(key, rec);
      }
    }

    let wbsMap = new Map<string, { planned: number; uom: string | null }>();
    if (wbsIds.size > 0) {
      const { data: wbsRows, error: wbsErr } = await supabase
        .from("wbs_items")
        .select("id, planned_quantity, uom")
        .in("id", Array.from(wbsIds));
      if (wbsErr) throw wbsErr;
      wbsMap = new Map(
        (wbsRows ?? []).map((r: any) => [
          r.id as string,
          { planned: Number(r.planned_quantity ?? 0), uom: r.uom ?? null },
        ]),
      );
    }

    const disciplines: WeeklyReportDisciplineRowDTO[] = Array.from(perKey.values())
      .map((rec) => {
        let planned = 0;
        let uom: string | null = null;
        for (const id of rec.wbsIds) {
          const w = wbsMap.get(id);
          if (w) {
            planned += w.planned;
            if (!uom) uom = w.uom;
          }
        }
        const days = Math.max(1, rec.days.size);
        return {
          discipline: rec.discipline,
          area: rec.area,
          uom,
          planned,
          installedThisWeek: rec.qty,
          dailyRate: rec.qty / days,
        };
      })
      .sort((a, b) => a.discipline.localeCompare(b.discipline) || a.area.localeCompare(b.area));

    // ---- EVM ---------------------------------------------------------------
    const { data: evm, error: evmErr } = await supabase
      .from("evm_snapshots")
      .select("spi, cpi")
      .eq("project_id", data.projectId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (evmErr) throw evmErr;

    // ---- HSE ---------------------------------------------------------------
    const { data: weekIncidents, error: wiErr } = await supabase
      .from("hse_incidents")
      .select("incident_type, osha_recordable")
      .eq("project_id", data.projectId)
      .gte("occurred_at", `${weekStart}T00:00:00Z`)
      .lte("occurred_at", `${weekEnd}T23:59:59Z`);
    if (wiErr) throw wiErr;
    const incidentAgg = new Map<string, number>();
    let recordablesThisWeek = 0;
    for (const r of weekIncidents ?? []) {
      const t = String((r as any).incident_type);
      incidentAgg.set(t, (incidentAgg.get(t) ?? 0) + 1);
      if ((r as any).osha_recordable) recordablesThisWeek += 1;
    }

    const [{ data: recRows, error: recErr }, { data: mpRows, error: mpErr }] = await Promise.all([
      supabase
        .from("hse_incidents")
        .select("osha_recordable")
        .eq("project_id", data.projectId)
        .gte("occurred_at", `${twelveMoAgo}T00:00:00Z`),
      supabase
        .from("manpower_logs")
        .select("hours, construction_daily_reports!inner(project_id, report_date)")
        .eq("construction_daily_reports.project_id", data.projectId)
        .gte("construction_daily_reports.report_date", twelveMoAgo),
    ]);
    if (recErr) throw recErr;
    if (mpErr) throw mpErr;
    const recordables12m = (recRows ?? []).filter((r: any) => r.osha_recordable).length;
    const hours12m = (mpRows ?? []).reduce((s: number, r: any) => s + Number(r.hours ?? 0), 0);

    const hse: WeeklyReportHseDTO = {
      incidentsByType: Array.from(incidentAgg.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      recordablesThisWeek,
      trir12m: computeTrir(recordables12m, hours12m),
      hours12m,
      recordables12m,
    };

    // ---- QA ---------------------------------------------------------------
    const { data: inspRows, error: inspErr } = await supabase
      .from("qaqc_inspections")
      .select("result, rework_required")
      .eq("project_id", data.projectId)
      .gte("inspection_date", weekStart)
      .lte("inspection_date", weekEnd);
    if (inspErr) throw inspErr;
    const inspections = (inspRows ?? []) as any[];
    const inspTotal = inspections.length;
    const passCount = inspections.filter((r) => r.result === "pass").length;
    const reworkCount = inspections.filter((r) => r.rework_required).length;

    const { data: punchRows, error: punchErr } = await supabase
      .from("qaqc_punch_items")
      .select("category, status")
      .eq("project_id", data.projectId)
      .in("status", ["open", "ready_for_review"]);
    if (punchErr) throw punchErr;
    const openPunch = { A: 0, B: 0, C: 0 } as { A: number; B: number; C: number };
    for (const p of punchRows ?? []) {
      const cat = String((p as any).category).toUpperCase();
      if (cat === "A" || cat === "B" || cat === "C") openPunch[cat] += 1;
    }

    const qa: WeeklyReportQaDTO = {
      inspectionsRun: inspTotal,
      passRate: inspTotal > 0 ? passCount / inspTotal : null,
      reworkPct: inspTotal > 0 ? reworkCount / inspTotal : null,
      openPunchByCategory: openPunch,
    };

    // ---- photos (up to 6, signed) -----------------------------------------
    const { data: photoRows, error: photoErr } = await supabase
      .from("site_photos")
      .select("file_path, caption, taken_at")
      .eq("project_id", data.projectId)
      .gte("taken_at", `${weekStart}T00:00:00Z`)
      .lte("taken_at", `${weekEnd}T23:59:59Z`)
      .order("taken_at", { ascending: false })
      .limit(6);
    if (photoErr) throw photoErr;
    const photoPaths = (photoRows ?? []).map((r: any) => r.file_path);
    const signedByPath = new Map<string, string>();
    if (photoPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(photoPaths, SIGNED_URL_TTL);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
      }
    }
    const photos: WeeklyReportPhotoDTO[] = (photoRows ?? []).map((r: any) => ({
      filePath: r.file_path,
      signedUrl: signedByPath.get(r.file_path) ?? null,
      caption: r.caption,
      takenAt: r.taken_at,
    }));

    // ---- lookahead --------------------------------------------------------
    const { data: nextTasks, error: taskErr } = await supabase
      .from("schedule_tasks")
      .select("name, discipline, start_date")
      .eq("project_id", data.projectId)
      .gte("start_date", nextWeekStart)
      .lte("start_date", nextWeekEnd)
      .order("start_date", { ascending: true })
      .limit(10);
    if (taskErr) throw taskErr;

    const lookahead: WeeklyReportLookaheadDTO = {
      topWeatherImpacts: weather.slice(0, 3).map((w) => ({
        delayType: w.delayType,
        hours: w.hours,
      })),
      plannedAreas: (nextTasks ?? []).map((t: any) => ({
        name: t.name,
        discipline: t.discipline,
        start: t.start_date,
      })),
    };

    return {
      project: {
        id: project.id,
        name: project.name,
        code: project.code,
        archetype: project.archetype,
        capacityMw: project.capacity_mw,
      },
      company: {
        name: companyRes.data?.name ?? "",
        legalName: companyRes.data?.legal_name ?? null,
      },
      branding: {
        primaryColor: brandingRes.data?.primary_color ?? null,
        accentColor: brandingRes.data?.accent_color ?? null,
        footerText: brandingRes.data?.footer_text ?? null,
        logoSignedUrl,
      },
      weekStart,
      weekEnd,
      isoWeekLabel: isoWeekLabel(weekStart),
      kpis: {
        spi: evm?.spi != null ? Number(evm.spi) : null,
        cpi: evm?.cpi != null ? Number(evm.cpi) : null,
        trir12m: hse.trir12m,
        reworkPct: qa.reworkPct,
      },
      daily,
      weather,
      disciplines,
      hse,
      qa,
      photos,
      lookahead,
      permissions: { canExport, roles },
      hasData: dprs.length > 0,
    };
  });

// ---------------------------------------------------------------------------
// listWeeklyReportProjects — mirrors other field pickers
// ---------------------------------------------------------------------------
export interface WeeklyReportProjectPick {
  id: string;
  name: string;
  code: string | null;
}

export const listWeeklyReportProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<WeeklyReportProjectPick[]> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as WeeklyReportProjectPick[];
  });

// ---------------------------------------------------------------------------
// logWeeklyReportExport — export-lock guard + audit
// ---------------------------------------------------------------------------
const logInput = z.object({
  projectId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const logWeeklyReportExport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw) => logInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const project = await assertProject(context, data.projectId);
    const roles = await currentRoles(context);
    if (!roles.some((r) => EXPORT_ROLES.has(r))) {
      httpError(403, "forbidden");
    }
    await assertExportAllowed(context.supabase, data.projectId, "weekly_client_report");
    try {
      await context.supabase.rpc("write_audit_log", {
        p_action: "field.weekly_report_export",
        p_entity: "projects",
        p_entity_id: data.projectId,
        p_metadata: {
          week_start: data.weekStart,
          week_end: data.weekEnd,
        } as any,
      });
    } catch {
      /* best-effort audit */
    }
    return { ok: true };
  });
