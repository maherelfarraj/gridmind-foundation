// P-086 — Daily Progress Report (DPR) server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  attachPhotoInput,
  canApproveDpr,
  canEditDpr,
  dprHeaderInput,
  manpowerRowInput,
  normalizeDiscipline,
  observationInput,
  quantityRowInput,
  submitBlockedReason,
  submitDprInput,
  sumManpower,
  weatherDelayInput,
  type DprStatus,
} from "@/lib/dpr.rules";
import { withIdempotency } from "@/lib/offline-mirror";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
export interface DprRow {
  id: string;
  company_id: string;
  project_id: string;
  report_date: string;
  shift: "day" | "night";
  status: DprStatus;
  weather_summary: string | null;
  temperature_high_c: number | string | null;
  temperature_low_c: number | string | null;
  work_summary: string | null;
  constraints_notes: string | null;
  quantities: QuantityEntry[];
  total_manpower: number;
  total_hours: number | string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuantityEntry {
  id: string;
  wbs_item_id: string;
  wbs_code?: string | null;
  wbs_name?: string | null;
  discipline: string;
  area: string | null;
  quantity: number;
  uom: string | null;
  notes: string | null;
  created_at: string;
  created_by: string;
}

export interface ManpowerRow {
  id: string;
  company_id: string;
  dpr_id: string;
  trade: string;
  contractor: string | null;
  headcount: number;
  hours: number | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeatherDelayRow {
  id: string;
  company_id: string;
  project_id: string;
  dpr_id: string | null;
  delay_date: string;
  delay_type: string;
  start_time: string | null;
  end_time: string | null;
  lost_hours: number | string;
  wbs_item_id: string | null;
  impact_notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SitePhotoRow {
  id: string;
  company_id: string;
  project_id: string;
  dpr_id: string | null;
  observation_id: string | null;
  file_path: string;
  caption: string | null;
  discipline: string | null;
  area: string | null;
  taken_at: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface ObservationRow {
  id: string;
  company_id: string;
  project_id: string;
  dpr_id: string | null;
  discipline: string;
  area: string | null;
  severity: string;
  status: string;
  description: string;
  due_date: string | null;
  raised_by: string | null;
  created_at: string;
}

export interface ProjectPick {
  id: string;
  name: string;
  code: string | null;
}

export interface DprListItem {
  id: string;
  project_id: string;
  project_name: string | null;
  project_code: string | null;
  report_date: string;
  shift: "day" | "night";
  status: DprStatus;
  total_manpower: number;
  total_hours: number | string;
  photo_count: number;
  updated_at: string;
}

export interface DprDetail {
  header: DprRow;
  manpower: ManpowerRow[];
  weather: WeatherDelayRow[];
  photos: SitePhotoRow[];
  observations: ObservationRow[];
  project: { id: string; name: string; code: string | null } | null;
  permissions: {
    canEdit: boolean;
    canApprove: boolean;
    roles: string[];
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
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
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function projectCompany(
  context: AuthContext,
  projectId: string,
): Promise<{ id: string; company_id: string; name: string; code: string | null }> {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name, code")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as any;
}

async function loadDprOrThrow(
  context: AuthContext,
  id: string,
): Promise<DprRow> {
  const { data, error } = await context.supabase
    .from("construction_daily_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "dpr_not_found");
  return data as unknown as DprRow;
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

async function recomputeTotals(context: AuthContext, dprId: string) {
  const { data: rows, error } = await context.supabase
    .from("manpower_logs")
    .select("headcount, hours")
    .eq("dpr_id", dprId);
  if (error) throw error;
  const totals = sumManpower(
    (rows ?? []).map((r: any) => ({ headcount: r.headcount, hours: r.hours })),
  );
  const { error: upErr } = await context.supabase
    .from("construction_daily_reports")
    .update({
      total_manpower: totals.totalManpower,
      total_hours: totals.totalHours as any,
    } as any)
    .eq("id", dprId);
  if (upErr) throw upErr;
}

function assertEditable(
  header: DprRow,
  roles: readonly string[],
  userId: string,
) {
  if (!canEditDpr(header.status, roles, header.created_by === userId)) {
    httpError(403, "not_editable", "This DPR is not editable");
  }
}

// ---------------------------------------------------------------------------
// project picker
// ---------------------------------------------------------------------------
export const listDprProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ProjectPick[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ProjectPick[];
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["draft", "submitted", "approved"]).nullable().optional(),
  search: z.string().trim().max(120).nullable().optional(),
});

export const listDprs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<DprListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("construction_daily_reports")
      .select(
        "id, project_id, report_date, shift, status, total_manpower, total_hours, updated_at, projects:project_id(name, code)",
      )
      .eq("company_id", companyId)
      .order("report_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(200);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.from) q = q.gte("report_date", data.from);
    if (data.to) q = q.lte("report_date", data.to);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;

    const ids = (rows ?? []).map((r: any) => r.id as string);
    let photoCounts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: photos } = await context.supabase
        .from("site_photos")
        .select("dpr_id")
        .in("dpr_id", ids);
      photoCounts = new Map();
      for (const p of (photos ?? []) as { dpr_id: string | null }[]) {
        if (!p.dpr_id) continue;
        photoCounts.set(p.dpr_id, (photoCounts.get(p.dpr_id) ?? 0) + 1);
      }
    }

    const search = data.search?.toLowerCase() ?? "";
    return (rows ?? [])
      .map((r: any): DprListItem => ({
        id: r.id,
        project_id: r.project_id,
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
        report_date: r.report_date,
        shift: r.shift,
        status: r.status,
        total_manpower: r.total_manpower ?? 0,
        total_hours: r.total_hours ?? 0,
        photo_count: photoCounts.get(r.id) ?? 0,
        updated_at: r.updated_at,
      }))
      .filter((r) => {
        if (!search) return true;
        return (
          (r.project_name ?? "").toLowerCase().includes(search) ||
          (r.project_code ?? "").toLowerCase().includes(search) ||
          r.report_date.includes(search)
        );
      });
  });

// ---------------------------------------------------------------------------
// get detail
// ---------------------------------------------------------------------------
const detailInput = z.object({ id: z.string().uuid() });

export const getDpr = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => detailInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprDetail> => {
    requireSupabaseAuth(context);
    const header = await loadDprOrThrow(context, data.id);
    const [manpower, weather, photos, observations, roles, projectRow] =
      await Promise.all([
        context.supabase
          .from("manpower_logs")
          .select("*")
          .eq("dpr_id", data.id)
          .order("created_at", { ascending: true }),
        context.supabase
          .from("weather_delays")
          .select("*")
          .eq("dpr_id", data.id)
          .order("created_at", { ascending: true }),
        context.supabase
          .from("site_photos")
          .select("*")
          .eq("dpr_id", data.id)
          .order("taken_at", { ascending: true }),
        context.supabase
          .from("field_observations")
          .select("*")
          .eq("dpr_id", data.id)
          .order("created_at", { ascending: true }),
        currentRoles(context),
        context.supabase
          .from("projects")
          .select("id, name, code")
          .eq("id", header.project_id)
          .maybeSingle(),
      ]);
    if (manpower.error) throw manpower.error;
    if (weather.error) throw weather.error;
    if (photos.error) throw photos.error;
    if (observations.error) throw observations.error;

    const isCreator = header.created_by === context.user!.id;
    return {
      header,
      manpower: (manpower.data ?? []) as ManpowerRow[],
      weather: (weather.data ?? []) as WeatherDelayRow[],
      photos: (photos.data ?? []) as SitePhotoRow[],
      observations: (observations.data ?? []) as ObservationRow[],
      project: (projectRow.data as any) ?? null,
      permissions: {
        roles,
        canEdit: canEditDpr(header.status, roles, isCreator),
        canApprove: canApproveDpr(roles) && header.status === "submitted",
      },
    };
  });

// ---------------------------------------------------------------------------
// upsert header (create + update)
// ---------------------------------------------------------------------------
export const upsertDprHeader = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dprHeaderInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const project = await projectCompany(context, data.projectId);
    const roles = await currentRoles(context);

    return withIdempotency(
      context,
      {
        key: data.clientIdempotencyKey,
        entity: "dpr",
        action: "upsert",
        companyId: project.company_id,
        projectId: data.projectId,
        input: data,
      },
      async () => {
        const patch = {
          weather_summary: data.weatherSummary ?? null,
          temperature_high_c: data.temperatureHighC ?? null,
          temperature_low_c: data.temperatureLowC ?? null,
          work_summary: data.workSummary ?? null,
          constraints_notes: data.constraintsNotes ?? null,
        } as any;

        if (data.id) {
          const existing = await loadDprOrThrow(context, data.id);
          assertEditable(existing, roles, userId);
          const { data: updated, error } = await context.supabase
            .from("construction_daily_reports")
            .update({
              ...patch,
              report_date: data.reportDate,
              shift: data.shift,
            } as any)
            .eq("id", data.id)
            .select("*")
            .maybeSingle();
          if (error) {
            if ((error as any).code === "23505") {
              httpError(
                409,
                "duplicate_dpr",
                `A DPR already exists for this project on ${data.reportDate} (${data.shift} shift)`,
              );
            }
            throw error;
          }
          const row = updated as unknown as DprRow;
          await audit(context, "dpr.update", "construction_daily_reports", row.id, {
            project_id: row.project_id,
            report_date: row.report_date,
          });
          return row;
        }

        const insert = {
          company_id: project.company_id,
          project_id: data.projectId,
          report_date: data.reportDate,
          shift: data.shift,
          status: "draft" as DprStatus,
          created_by: userId,
          ...patch,
        };
        const { data: created, error } = await context.supabase
          .from("construction_daily_reports")
          .insert(insert as any)
          .select("*")
          .maybeSingle();
        if (error) {
          if ((error as any).code === "23505") {
            httpError(
              409,
              "duplicate_dpr",
              `A DPR already exists for this project on ${data.reportDate} (${data.shift} shift)`,
            );
          }
          throw error;
        }
        const row = created as unknown as DprRow;
        await audit(context, "dpr.create", "construction_daily_reports", row.id, {
          project_id: row.project_id,
          report_date: row.report_date,
          shift: row.shift,
        });
        return row;
      },
    );
  });

// ---------------------------------------------------------------------------
// manpower
// ---------------------------------------------------------------------------
export const addManpowerRow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => manpowerRowInput.parse(raw))
  .handler(async ({ data, context }): Promise<ManpowerRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);
    return withIdempotency(
      context,
      {
        key: data.clientIdempotencyKey,
        entity: "dpr",
        action: "manpower",
        companyId: header.company_id,
        projectId: header.project_id,
        input: data,
      },
      async () => {
        const insert = {
          company_id: header.company_id,
          dpr_id: data.dprId,
          trade: data.trade,
          contractor: data.contractor ?? null,
          headcount: data.headcount,
          hours: data.hours as any,
          notes: data.notes ?? null,
        };
        const { data: row, error } = await context.supabase
          .from("manpower_logs")
          .insert(insert as any)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        await recomputeTotals(context, data.dprId);
        await audit(context, "dpr.update", "manpower_logs", (row as any).id, {
          dpr_id: data.dprId,
          trade: data.trade,
          headcount: data.headcount,
        });
        return row as ManpowerRow;
      },
    );
  });

const manpowerIdInput = z.object({ id: z.string().uuid(), dprId: z.string().uuid() });

export const deleteManpowerRow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => manpowerIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);
    const { error } = await context.supabase
      .from("manpower_logs")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    await recomputeTotals(context, data.dprId);
    await audit(context, "dpr.update", "manpower_logs", data.id, {
      dpr_id: data.dprId,
      op: "delete",
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// weather delays
// ---------------------------------------------------------------------------
export const addWeatherDelay = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => weatherDelayInput.parse(raw))
  .handler(async ({ data, context }): Promise<WeatherDelayRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);
    const insert = {
      company_id: header.company_id,
      project_id: header.project_id,
      dpr_id: data.dprId,
      delay_date: header.report_date,
      delay_type: data.delayType,
      start_time: data.startTime ?? null,
      end_time: data.endTime ?? null,
      lost_hours: data.lostHours as any,
      wbs_item_id: data.wbsItemId ?? null,
      impact_notes: data.impactNotes ?? null,
      created_by: userId,
    };
    const { data: row, error } = await context.supabase
      .from("weather_delays")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "weather_delay.create", "weather_delays", (row as any).id, {
      dpr_id: data.dprId,
      delay_type: data.delayType,
      lost_hours: data.lostHours,
    });
    return row as WeatherDelayRow;
  });

const weatherIdInput = z.object({ id: z.string().uuid(), dprId: z.string().uuid() });

export const deleteWeatherDelay = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => weatherIdInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);
    const { error } = await context.supabase
      .from("weather_delays")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// quantities (jsonb column on DPR)
// ---------------------------------------------------------------------------
export const addQuantityRow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => quantityRowInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);

    const { data: wbs, error: wbsErr } = await context.supabase
      .from("wbs_items")
      .select("id, code, name, discipline, area, uom")
      .eq("id", data.wbsItemId)
      .maybeSingle();
    if (wbsErr) throw wbsErr;
    if (!wbs) httpError(404, "wbs_not_found");

    const wbsRow = wbs as any;
    const entry: QuantityEntry = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      wbs_item_id: data.wbsItemId,
      wbs_code: wbsRow.code ?? null,
      wbs_name: wbsRow.name ?? null,
      discipline: normalizeDiscipline(wbsRow.discipline),
      area: data.area ?? wbsRow.area ?? null,
      quantity: data.quantity,
      uom: data.uom ?? wbsRow.uom ?? null,
      notes: data.notes ?? null,
      created_at: new Date().toISOString(),
      created_by: userId,
    };
    const nextQty: QuantityEntry[] = Array.isArray(header.quantities)
      ? [...(header.quantities as QuantityEntry[]), entry]
      : [entry];
    const { data: updated, error } = await context.supabase
      .from("construction_daily_reports")
      .update({ quantities: nextQty as any } as any)
      .eq("id", data.dprId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "dpr.update", "construction_daily_reports", data.dprId, {
      op: "add_quantity",
      wbs_item_id: data.wbsItemId,
      quantity: data.quantity,
    });
    return updated as unknown as DprRow;
  });

const qtyDeleteInput = z.object({
  dprId: z.string().uuid(),
  entryId: z.string().min(1),
});

export const deleteQuantityRow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => qtyDeleteInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.dprId);
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);
    const nextQty = (Array.isArray(header.quantities) ? header.quantities : []).filter(
      (q) => (q as QuantityEntry).id !== data.entryId,
    );
    const { data: updated, error } = await context.supabase
      .from("construction_daily_reports")
      .update({ quantities: nextQty as any } as any)
      .eq("id", data.dprId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return updated as unknown as DprRow;
  });

// ---------------------------------------------------------------------------
// photos + observations
// ---------------------------------------------------------------------------
export const attachPhoto = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => attachPhotoInput.parse(raw))
  .handler(async ({ data, context }): Promise<SitePhotoRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const project = await projectCompany(context, data.projectId);
    if (data.dprId) {
      const header = await loadDprOrThrow(context, data.dprId);
      const roles = await currentRoles(context);
      assertEditable(header, roles, userId);
    }
    const insert = {
      company_id: project.company_id,
      project_id: data.projectId,
      dpr_id: data.dprId ?? null,
      observation_id: data.observationId ?? null,
      file_path: data.filePath,
      caption: data.caption ?? null,
      discipline: data.discipline ?? null,
      area: data.area ?? null,
      uploaded_by: userId,
    };
    const { data: row, error } = await context.supabase
      .from("site_photos")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "photo.attach", "site_photos", (row as any).id, {
      dpr_id: data.dprId ?? null,
      observation_id: data.observationId ?? null,
    });
    return row as SitePhotoRow;
  });

const removePhotoInput = z.object({ id: z.string().uuid(), dprId: z.string().uuid().nullable().optional() });

export const removePhoto = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => removePhotoInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    if (data.dprId) {
      const header = await loadDprOrThrow(context, data.dprId);
      const roles = await currentRoles(context);
      assertEditable(header, roles, userId);
    }
    const { data: existing } = await context.supabase
      .from("site_photos")
      .select("file_path, company_id")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase
      .from("site_photos")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    if (existing && (existing as any).file_path) {
      try {
        await context.supabase.storage
          .from("photos")
          .remove([(existing as any).file_path]);
      } catch {
        /* best-effort */
      }
    }
    return { ok: true };
  });

export const createObservation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => observationInput.parse(raw))
  .handler(async ({ data, context }): Promise<ObservationRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const project = await projectCompany(context, data.projectId);
    const insert = {
      company_id: project.company_id,
      project_id: data.projectId,
      dpr_id: data.dprId ?? null,
      discipline: data.discipline || "general",
      area: data.area ?? null,
      severity: data.severity,
      status: "open",
      description: data.description,
      due_date: data.dueDate ?? null,
      raised_by: userId,
    };
    const { data: row, error } = await context.supabase
      .from("field_observations")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "observation.create", "field_observations", (row as any).id, {
      dpr_id: data.dprId ?? null,
      severity: data.severity,
    });
    return row as ObservationRow;
  });

// ---------------------------------------------------------------------------
// signed URLs for photo gallery
// ---------------------------------------------------------------------------
const signInput = z.object({ paths: z.array(z.string().min(1)).max(200) });

export const signPhotoUrls = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => signInput.parse(raw))
  .handler(async ({ data, context }): Promise<Record<string, string>> => {
    requireSupabaseAuth(context);
    const out: Record<string, string> = {};
    if (data.paths.length === 0) return out;
    const { data: signed, error } = await context.supabase.storage
      .from("photos")
      .createSignedUrls(data.paths, 600);
    if (error) throw error;
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
    }
    return out;
  });

// ---------------------------------------------------------------------------
// submit + approve
// ---------------------------------------------------------------------------
export const submitDpr = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => submitDprInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const header = await loadDprOrThrow(context, data.id);
    if (header.status !== "draft") httpError(409, "not_draft");
    const roles = await currentRoles(context);
    assertEditable(header, roles, userId);

    const [manpower, photos] = await Promise.all([
      context.supabase
        .from("manpower_logs")
        .select("id", { count: "exact", head: true })
        .eq("dpr_id", data.id),
      context.supabase
        .from("site_photos")
        .select("id", { count: "exact", head: true })
        .eq("dpr_id", data.id),
    ]);
    const reason = submitBlockedReason({
      manpowerCount: manpower.count ?? 0,
      photoCount: photos.count ?? 0,
      acknowledgeNoPhotos: data.acknowledgeNoPhotos,
    });
    if (reason) {
      httpError(
        422,
        reason,
        reason === "manpower_required"
          ? "Add at least one manpower row before submitting"
          : "No photos attached — tick 'Submit without photos' to continue",
      );
    }

    const { data: updated, error } = await context.supabase
      .from("construction_daily_reports")
      .update({
        status: "submitted" as DprStatus,
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "dpr.submit", "construction_daily_reports", data.id, {
      project_id: header.project_id,
      photos: photos.count ?? 0,
      manpower_rows: manpower.count ?? 0,
      no_photos_ack: data.acknowledgeNoPhotos,
    });
    return updated as unknown as DprRow;
  });

const approveInput = z.object({ id: z.string().uuid() });

export const approveDpr = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => approveInput.parse(raw))
  .handler(async ({ data, context }): Promise<DprRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const roles = await currentRoles(context);
    if (!canApproveDpr(roles)) httpError(403, "forbidden_role");
    const header = await loadDprOrThrow(context, data.id);
    if (header.status !== "submitted") httpError(409, "not_submitted");
    const { data: updated, error } = await context.supabase
      .from("construction_daily_reports")
      .update({
        status: "approved" as DprStatus,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    await audit(context, "dpr.approve", "construction_daily_reports", data.id, {
      project_id: header.project_id,
    });
    return updated as unknown as DprRow;
  });
