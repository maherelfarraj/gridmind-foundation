// P-088 — HSE server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  canEditIncident,
  canWriteInspection,
  canWriteTraining,
  computeTrir,
  incidentInput,
  incidentUpdateInput,
  incidentCloseInput,
  inspectionInput,
  isInUnloggedWindow,
  nextIncidentNumber,
  summarizeChecklist,
  trainingInput,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  type InspectionStatus,
  type ChecklistItem,
  type CorrectiveAction,
} from "@/lib/hse.rules";

// ---------------------------------------------------------------------------
// row types
// ---------------------------------------------------------------------------
export interface IncidentRow {
  id: string;
  company_id: string;
  project_id: string;
  incident_number: string;
  incident_type: IncidentType;
  severity: IncidentSeverity;
  occurred_at: string;
  reported_at: string;
  location: string | null;
  description: string;
  persons_involved: string | null;
  days_away_from_work: number;
  restricted_duty: boolean;
  medical_treatment: boolean;
  osha_recordable: boolean;
  status: IncidentStatus;
  corrective_actions: CorrectiveAction[];
  closed_by: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentListItem extends IncidentRow {
  project_name: string | null;
  project_code: string | null;
}

export interface InspectionRow {
  id: string;
  company_id: string;
  project_id: string;
  inspection_date: string;
  inspection_type: string;
  inspector_id: string | null;
  area: string | null;
  checklist: ChecklistItem[];
  findings_count: number;
  open_findings: number;
  status: InspectionStatus;
  due_date: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  project_code?: string | null;
}

export interface TrainingRow {
  id: string;
  company_id: string;
  project_id: string | null;
  profile_id: string | null;
  person_name: string;
  course: string;
  provider: string | null;
  completed_on: string;
  expires_on: string | null;
  certificate_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  project_code?: string | null;
}

export interface ProjectPick {
  id: string;
  name: string;
  code: string | null;
}

export interface HseDashboard {
  openIncidents: number;
  unloggedWindow: number;
  overdueLogs: number;
  inspectionsThisMonth: number;
  trainingExpiring: number;
  trir12m: number | null;
  recordables12m: number;
  hours12m: number;
  recentIncidents: IncidentListItem[];
  projectId: string | null;
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

async function allocateIncidentNumber(
  context: AuthContext,
  companyId: string,
): Promise<string> {
  const { data, error } = await context.supabase
    .from("hse_incidents")
    .select("incident_number")
    .eq("company_id", companyId)
    .order("incident_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = ((data ?? []) as { incident_number: string }[]).map(
    (r) => r.incident_number,
  );
  return nextIncidentNumber(list);
}

// ---------------------------------------------------------------------------
// projects picker
// ---------------------------------------------------------------------------
export const listHseProjects = createServerFn({ method: "GET" })
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
// incidents — list
// ---------------------------------------------------------------------------
const incidentListInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(["open", "investigating", "closed"]).nullable().optional(),
  search: z.string().trim().max(120).nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const listIncidents = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => incidentListInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<IncidentListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("hse_incidents")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status);
    if (data.from) q = q.gte("occurred_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("occurred_at", `${data.to}T23:59:59Z`);
    const { data: rows, error } = await q;
    if (error) throw error;
    const search = data.search?.toLowerCase() ?? "";
    return (rows ?? [])
      .map((r: any): IncidentListItem => ({
        ...(r as IncidentRow),
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
      }))
      .filter((r) => {
        if (!search) return true;
        return (
          r.incident_number.toLowerCase().includes(search) ||
          (r.description ?? "").toLowerCase().includes(search) ||
          (r.location ?? "").toLowerCase().includes(search) ||
          (r.project_name ?? "").toLowerCase().includes(search)
        );
      });
  });

export const getIncident = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("hse_incidents")
      .select("*, projects:project_id(id, name, code)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "incident_not_found");
    const roles = await currentRoles(context);
    const proj = (row as any).projects ?? null;
    return {
      incident: {
        ...((row as unknown) as IncidentRow),
        project_name: proj?.name ?? null,
        project_code: proj?.code ?? null,
      } as IncidentListItem,
      permissions: {
        roles,
        canEdit: canEditIncident(roles),
      },
    };
  });

// ---------------------------------------------------------------------------
// incidents — create / update / close
// ---------------------------------------------------------------------------
export const createIncident = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => incidentInput.parse(raw))
  .handler(async ({ data, context }): Promise<IncidentRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const project = await projectCompany(context, data.projectId);

    // retry on unique(company_id, incident_number) race
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const number = await allocateIncidentNumber(context, project.company_id);
      const insert = {
        company_id: project.company_id,
        project_id: data.projectId,
        incident_number: number,
        incident_type: data.incidentType,
        severity: data.severity,
        occurred_at: data.occurredAt,
        location: data.location ?? null,
        description: data.description,
        persons_involved: data.personsInvolved ?? null,
        days_away_from_work: data.daysAwayFromWork,
        restricted_duty: data.restrictedDuty,
        medical_treatment: data.medicalTreatment,
        osha_recordable: data.oshaRecordable,
        corrective_actions: data.correctiveActions as any,
        created_by: userId,
      };
      const { data: created, error } = await context.supabase
        .from("hse_incidents")
        .insert(insert as any)
        .select("*")
        .maybeSingle();
      if (!error && created) {
        const row = created as unknown as IncidentRow;
        await audit(context, "hse.incident_create", "hse_incidents", row.id, {
          project_id: row.project_id,
          incident_number: row.incident_number,
          type: row.incident_type,
          severity: row.severity,
        });
        return row;
      }
      if ((error as any)?.code === "23505") {
        lastErr = error;
        continue;
      }
      throw error ?? new Error("insert_failed");
    }
    throw lastErr ?? new Error("incident_number_alloc_failed");
  });

export const updateIncident = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => incidentUpdateInput.parse(raw))
  .handler(async ({ data, context }): Promise<IncidentRow> => {
    requireSupabaseAuth(context);
    const patch: Record<string, unknown> = {};
    if (data.incidentType !== undefined) patch.incident_type = data.incidentType;
    if (data.severity !== undefined) patch.severity = data.severity;
    if (data.occurredAt !== undefined) patch.occurred_at = data.occurredAt;
    if (data.location !== undefined) patch.location = data.location ?? null;
    if (data.description !== undefined) patch.description = data.description;
    if (data.personsInvolved !== undefined)
      patch.persons_involved = data.personsInvolved ?? null;
    if (data.daysAwayFromWork !== undefined)
      patch.days_away_from_work = data.daysAwayFromWork;
    if (data.restrictedDuty !== undefined) patch.restricted_duty = data.restrictedDuty;
    if (data.medicalTreatment !== undefined)
      patch.medical_treatment = data.medicalTreatment;
    if (data.oshaRecordable !== undefined) patch.osha_recordable = data.oshaRecordable;
    if (data.correctiveActions !== undefined)
      patch.corrective_actions = data.correctiveActions as any;
    if (data.status !== undefined) patch.status = data.status;

    const { data: updated, error } = await context.supabase
      .from("hse_incidents")
      .update(patch as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "incident_not_found");
    const row = updated as unknown as IncidentRow;
    await audit(context, "hse.incident_update", "hse_incidents", row.id, {
      project_id: row.project_id,
      keys: Object.keys(patch),
    });
    return row;
  });

export const closeIncident = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => incidentCloseInput.parse(raw))
  .handler(async ({ data, context }): Promise<IncidentRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const { data: updated, error } = await context.supabase
      .from("hse_incidents")
      .update({
        status: "closed" as IncidentStatus,
        closed_by: userId,
        closed_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "incident_not_found");
    const row = updated as unknown as IncidentRow;
    await audit(context, "hse.incident_close", "hse_incidents", row.id, {
      project_id: row.project_id,
      notes: data.closingNotes ?? null,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// inspections
// ---------------------------------------------------------------------------
const inspectionListInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(["scheduled", "completed", "closed"]).nullable().optional(),
  search: z.string().trim().max(120).nullable().optional(),
});

export const listInspections = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionListInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<InspectionRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("hse_inspections")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("inspection_date", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    const search = data.search?.toLowerCase() ?? "";
    return (rows ?? [])
      .map((r: any): InspectionRow => ({
        ...(r as InspectionRow),
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
      }))
      .filter((r) => {
        if (!search) return true;
        return (
          (r.area ?? "").toLowerCase().includes(search) ||
          (r.inspection_type ?? "").toLowerCase().includes(search) ||
          (r.project_name ?? "").toLowerCase().includes(search)
        );
      });
  });

export const upsertInspection = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionInput.parse(raw))
  .handler(async ({ data, context }): Promise<InspectionRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const project = await projectCompany(context, data.projectId);
    const summary = summarizeChecklist(data.checklist);
    const patch = {
      inspection_date: data.inspectionDate,
      inspection_type: data.inspectionType,
      area: data.area ?? null,
      checklist: data.checklist as any,
      findings_count: summary.findingsCount,
      open_findings: summary.openFindings,
      status: data.status,
      due_date: data.dueDate ?? null,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("hse_inspections")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!updated) httpError(404, "inspection_not_found");
      const row = updated as unknown as InspectionRow;
      await audit(context, "hse.inspection_save", "hse_inspections", row.id, {
        project_id: row.project_id,
        findings: summary.findingsCount,
      });
      return row;
    }
    const insert = {
      ...patch,
      company_id: project.company_id,
      project_id: data.projectId,
      inspector_id: userId,
      created_by: userId,
    };
    const { data: created, error } = await context.supabase
      .from("hse_inspections")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = created as unknown as InspectionRow;
    await audit(context, "hse.inspection_save", "hse_inspections", row.id, {
      project_id: row.project_id,
      findings: summary.findingsCount,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// training records
// ---------------------------------------------------------------------------
const trainingListInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  search: z.string().trim().max(120).nullable().optional(),
});

export const listTraining = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => trainingListInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<TrainingRow[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("hse_training_records")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("completed_on", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    const { data: rows, error } = await q;
    if (error) throw error;
    const search = data.search?.toLowerCase() ?? "";
    return (rows ?? [])
      .map((r: any): TrainingRow => ({
        ...(r as TrainingRow),
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
      }))
      .filter((r) => {
        if (!search) return true;
        return (
          r.person_name.toLowerCase().includes(search) ||
          r.course.toLowerCase().includes(search) ||
          (r.provider ?? "").toLowerCase().includes(search)
        );
      });
  });

export const upsertTrainingRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => trainingInput.parse(raw))
  .handler(async ({ data, context }): Promise<TrainingRow> => {
    requireSupabaseAuth(context);
    const userId = context.user!.id;
    const companyId = await currentCompanyId(context);
    const patch = {
      project_id: data.projectId ?? null,
      profile_id: data.profileId ?? null,
      person_name: data.personName,
      course: data.course,
      provider: data.provider ?? null,
      completed_on: data.completedOn,
      expires_on: data.expiresOn ?? null,
      certificate_path: data.certificatePath ?? null,
    };
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("hse_training_records")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!updated) httpError(404, "training_not_found");
      const row = updated as unknown as TrainingRow;
      await audit(context, "hse.training_save", "hse_training_records", row.id, {
        person: row.person_name,
        course: row.course,
      });
      return row;
    }
    const { data: created, error } = await context.supabase
      .from("hse_training_records")
      .insert({ ...patch, company_id: companyId, created_by: userId } as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = created as unknown as TrainingRow;
    await audit(context, "hse.training_save", "hse_training_records", row.id, {
      person: row.person_name,
      course: row.course,
    });
    return row;
  });

export const signTrainingCertificate = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ path: z.string().trim().min(1).max(500) }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(data.path, 300);
    if (error) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
const dashboardInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
});

export const getHseDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dashboardInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<HseDashboard> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 3_600_000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAhead = new Date(now.getTime() + 30 * 24 * 3_600_000);

    // Incident base filter
    const incidentBase = () => {
      let q = context.supabase
        .from("hse_incidents")
        .select("*, projects:project_id(name, code)")
        .eq("company_id", companyId);
      if (data.projectId) q = q.eq("project_id", data.projectId);
      return q;
    };

    const trailingIncidents = incidentBase().gte(
      "occurred_at",
      twelveMonthsAgo.toISOString(),
    );

    let manpowerQ = context.supabase
      .from("manpower_logs")
      .select("hours, dpr_id, construction_daily_reports!inner(project_id, report_date, company_id)")
      .eq("construction_daily_reports.company_id", companyId)
      .gte("construction_daily_reports.report_date", twelveMonthsAgo
        .toISOString()
        .slice(0, 10));
    if (data.projectId) {
      manpowerQ = manpowerQ.eq(
        "construction_daily_reports.project_id",
        data.projectId,
      );
    }

    let inspectionsMonthQ = context.supabase
      .from("hse_inspections")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("inspection_date", startOfMonth.toISOString().slice(0, 10));
    if (data.projectId)
      inspectionsMonthQ = inspectionsMonthQ.eq("project_id", data.projectId);

    let trainingExpiryQ = context.supabase
      .from("hse_training_records")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("expires_on", "is", null)
      .gte("expires_on", now.toISOString().slice(0, 10))
      .lte("expires_on", thirtyDaysAhead.toISOString().slice(0, 10));
    if (data.projectId)
      trainingExpiryQ = trainingExpiryQ.eq("project_id", data.projectId);

    const [incRes, mpRes, inspRes, trainRes] = await Promise.all([
      trailingIncidents,
      manpowerQ,
      inspectionsMonthQ,
      trainingExpiryQ,
    ]);
    if (incRes.error) throw incRes.error;
    if (mpRes.error) throw mpRes.error;
    if (inspRes.error) throw inspRes.error;
    if (trainRes.error) throw trainRes.error;

    const rows = (incRes.data ?? []) as any[];
    const recordables12m = rows.filter((r) => r.osha_recordable).length;
    const openIncidents = rows.filter((r) => r.status !== "closed").length;
    let unloggedWindow = 0;
    let overdueLogs = 0;
    for (const r of rows) {
      if (isInUnloggedWindow(r.occurred_at, r.reported_at, now)) {
        unloggedWindow += 1;
      }
      const gap =
        (new Date(r.reported_at).getTime() -
          new Date(r.occurred_at).getTime()) /
        3_600_000;
      if (gap > 24) overdueLogs += 1;
    }

    const hours12m = (mpRes.data ?? []).reduce(
      (sum: number, r: any) => sum + Number(r.hours ?? 0),
      0,
    );

    const recentIncidents: IncidentListItem[] = rows
      .slice(0, 8)
      .map((r: any) => ({
        ...(r as IncidentRow),
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
      }));

    return {
      openIncidents,
      unloggedWindow,
      overdueLogs,
      inspectionsThisMonth: inspRes.count ?? 0,
      trainingExpiring: trainRes.count ?? 0,
      trir12m: computeTrir(recordables12m, hours12m),
      recordables12m,
      hours12m,
      recentIncidents,
      projectId: data.projectId ?? null,
    };
  });
