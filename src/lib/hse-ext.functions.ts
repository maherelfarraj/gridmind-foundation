// P-185 — HSE expansion server functions. Thin wrappers only: helpers live in
// hse-ext.server.ts / hse-ext.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, audit, currentCompanyId, hasAnyRole, httpError } from "@/lib/cwp.server";
import {
  auditCreateSchema,
  auditUpdateSchema,
  competencySchema,
  computeExceedance,
  emergencySchema,
  environmentalSchema,
  jsaCreateSchema,
  jsaUpdateSchema,
  observationCreateSchema,
  observationUpdateSchema,
  raCreateSchema,
  raUpdateSchema,
  scoreChecklist,
  wasteSchema,
  type AuditItem,
} from "@/lib/hse-ext.rules";
import {
  HSE_OBSERVER_ROLES,
  HSE_WRITER_ROLES,
  insertHseNumbered,
  insertHseRow,
  listHseRows,
  startHseApproval,
  updateHseRow,
} from "@/lib/hse-ext.server";

const projectFilter = (raw: unknown) =>
  z.object({ projectId: z.string().uuid().nullable().optional() }).parse(raw ?? {});

/* -------------------------------- access ---------------------------------- */

export const getHseExtAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return {
      canManage: await hasAnyRole(context.supabase, HSE_WRITER_ROLES),
      canObserve: await hasAnyRole(context.supabase, HSE_OBSERVER_ROLES),
    };
  });

/* ---------------------------- risk assessments ----------------------------- */

export const listRiskAssessments = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "risk_assessments", data.projectId, "created_at");
  });

export const createRiskAssessment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => raCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseNumbered<{ id: string; ra_number: string }>(
      context.supabase,
      "risk_assessments",
      "ra_number",
      "RA",
      companyId,
      (num) => ({
        company_id: companyId,
        project_id: data.projectId,
        ra_number: num,
        title: data.title,
        activity: data.activity,
        hazards: data.hazards,
        review_date: data.reviewDate || null,
        created_by: context.user.id,
      }),
    );
    await audit(context.supabase, "hse.ra.created", "risk_assessments", row.id, {
      project_id: data.projectId,
      ra_number: row.ra_number,
    });
    return row;
  });

export const updateRiskAssessment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => raUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.activity !== undefined) patch.activity = data.activity;
    if (data.hazards !== undefined) patch.hazards = data.hazards;
    if (data.reviewDate !== undefined) patch.review_date = data.reviewDate || null;
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "risk_assessments",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.ra.updated", "risk_assessments", data.id, patch);
    return row;
  });

export const activateRiskAssessment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const { data: ra, error } = await context.supabase
      .from("risk_assessments")
      .select("id, project_id, ra_number, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!ra) httpError(404, "not_found");
    const instanceId = await startHseApproval(
      context.supabase,
      "risk_assessment",
      ra.id,
      ra.project_id,
      { ra_number: ra.ra_number },
    );
    const patch: Record<string, unknown> = instanceId
      ? { approval_instance_id: instanceId }
      : { status: "active", approved_by: context.user.id, approved_at: new Date().toISOString() };
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "risk_assessments",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.ra.activated", "risk_assessments", data.id, {
      approval_instance_id: instanceId,
      inline: !instanceId,
    });
    return { ...row, approvalInstanceId: instanceId };
  });

/* ----------------------------------- JSA ----------------------------------- */

export const listJsas = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "job_safety_analyses", data.projectId, "created_at");
  });

export const createJsa = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => jsaCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseNumbered<{ id: string; jsa_number: string }>(
      context.supabase,
      "job_safety_analyses",
      "jsa_number",
      "JSA",
      companyId,
      (num) => ({
        company_id: companyId,
        project_id: data.projectId,
        jsa_number: num,
        task: data.task,
        risk_assessment_id: data.riskAssessmentId || null,
        steps: data.steps,
        created_by: context.user.id,
      }),
    );
    await audit(context.supabase, "hse.jsa.created", "job_safety_analyses", row.id, {
      project_id: data.projectId,
      jsa_number: row.jsa_number,
    });
    return row;
  });

export const updateJsa = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => jsaUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.task !== undefined) patch.task = data.task;
    if (data.riskAssessmentId !== undefined)
      patch.risk_assessment_id = data.riskAssessmentId || null;
    if (data.steps !== undefined) patch.steps = data.steps;
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "job_safety_analyses",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.jsa.updated", "job_safety_analyses", data.id, patch);
    return row;
  });

export const activateJsa = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const { data: jsa, error } = await context.supabase
      .from("job_safety_analyses")
      .select("id, project_id, jsa_number")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!jsa) httpError(404, "not_found");
    const instanceId = await startHseApproval(context.supabase, "jsa", jsa.id, jsa.project_id, {
      jsa_number: jsa.jsa_number,
    });
    const patch: Record<string, unknown> = instanceId
      ? { approval_instance_id: instanceId }
      : { status: "active", approved_by: context.user.id, approved_at: new Date().toISOString() };
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "job_safety_analyses",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.jsa.activated", "job_safety_analyses", data.id, {
      approval_instance_id: instanceId,
      inline: !instanceId,
    });
    return { ...row, approvalInstanceId: instanceId };
  });

/* ----------------------------- observations -------------------------------- */

export const listSafetyObservations = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "safety_observations", data.projectId, "created_at");
  });

export const createSafetyObservation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => observationCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_OBSERVER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseNumbered<{ id: string; obs_number: string }>(
      context.supabase,
      "safety_observations",
      "obs_number",
      "OBS",
      companyId,
      (num) => ({
        company_id: companyId,
        project_id: data.projectId,
        obs_number: num,
        obs_type: data.obsType,
        description: data.description,
        location: data.location || null,
        action_taken: data.actionTaken || null,
        severity: data.severity,
        photo_path: data.photoPath || null,
        raised_by: context.user.id,
      }),
    );
    await audit(context.supabase, "hse.obs.created", "safety_observations", row.id, {
      project_id: data.projectId,
      obs_number: row.obs_number,
      obs_type: data.obsType,
    });
    return row;
  });

export const updateSafetyObservation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => observationUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.severity !== undefined) patch.severity = data.severity;
    if (data.actionTaken !== undefined) patch.action_taken = data.actionTaken || null;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "closed") {
        patch.closed_by = context.user.id;
        patch.closed_at = new Date().toISOString();
      }
    }
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "safety_observations",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.obs.updated", "safety_observations", data.id, patch);
    return row;
  });

/* ------------------------------- competency -------------------------------- */

export const listCompetencyRecords = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "competency_records", data.projectId, "expiry_date", true);
  });

export const createCompetencyRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => competencySchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseRow<{ id: string }>(context.supabase, "competency_records", {
      company_id: companyId,
      project_id: data.projectId || null,
      worker_name: data.workerName,
      employer: data.employer || null,
      competency: data.competency,
      certificate_number: data.certificateNumber || null,
      issued_date: data.issuedDate || null,
      expiry_date: data.expiryDate || null,
      file_path: data.filePath || null,
      verified_by: context.user.id,
    });
    await audit(context.supabase, "hse.competency.created", "competency_records", row.id, {
      worker: data.workerName,
      competency: data.competency,
      expiry_date: data.expiryDate ?? null,
    });
    return row;
  });

/* ---------------------------- emergency response --------------------------- */

export const listEmergencyResponses = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "emergency_response", data.projectId, "occurred_at");
  });

export const createEmergencyResponse = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => emergencySchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseRow<{ id: string }>(context.supabase, "emergency_response", {
      company_id: companyId,
      project_id: data.projectId,
      kind: data.kind,
      event_type: data.eventType,
      occurred_at: data.occurredAt,
      response_time_minutes: data.responseTimeMinutes ?? null,
      casualties: data.casualties,
      report: data.report || null,
      lessons_learned: data.lessonsLearned || null,
    });
    await audit(context.supabase, "hse.emergency.created", "emergency_response", row.id, {
      project_id: data.projectId,
      kind: data.kind,
      event_type: data.eventType,
    });
    return row;
  });

/* ------------------------------ environmental ------------------------------ */

export const listEnvironmentalReadings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "environmental_monitoring", data.projectId, "measured_at");
  });

export const createEnvironmentalReading = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => environmentalSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    // exceedance is always derived here — a client-supplied flag is ignored.
    const exceedance = computeExceedance(data.value, data.limitValue ?? null);
    const row = await insertHseRow<{ id: string }>(context.supabase, "environmental_monitoring", {
      company_id: companyId,
      project_id: data.projectId,
      metric: data.metric,
      value: data.value,
      uom: data.uom,
      limit_value: data.limitValue ?? null,
      exceedance,
      location: data.location || null,
      measured_at: data.measuredAt || new Date().toISOString(),
    });
    await audit(context.supabase, "hse.env.created", "environmental_monitoring", row.id, {
      project_id: data.projectId,
      metric: data.metric,
      exceedance,
    });
    return row;
  });

/* --------------------------------- waste ----------------------------------- */

export const listWasteRecords = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "waste_tracking", data.projectId, "disposal_date");
  });

export const createWasteRecord = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => wasteSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const row = await insertHseRow<{ id: string }>(context.supabase, "waste_tracking", {
      company_id: companyId,
      project_id: data.projectId,
      waste_type: data.wasteType,
      qty: data.qty,
      uom: data.uom,
      disposal_method: data.disposalMethod || null,
      contractor: data.contractor || null,
      manifest_number: data.manifestNumber || null,
      disposal_date: data.disposalDate,
    });
    await audit(context.supabase, "hse.waste.created", "waste_tracking", row.id, {
      project_id: data.projectId,
      waste_type: data.wasteType,
      qty: data.qty,
    });
    return row;
  });

/* --------------------------------- audits ---------------------------------- */

export const listAuditChecklists = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return listHseRows(context.supabase, "site_audit_checklists", data.projectId, "audit_date");
  });

export const createAuditChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => auditCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const scored = scoreChecklist(data.items as AuditItem[]);
    const row = await insertHseRow<{ id: string }>(context.supabase, "site_audit_checklists", {
      company_id: companyId,
      project_id: data.projectId,
      title: data.title,
      audit_date: data.auditDate,
      auditor: context.user.id,
      items: data.items,
      findings_count: scored.findingsCount,
      score_pct: scored.scorePct,
    });
    await audit(context.supabase, "hse.audit.created", "site_audit_checklists", row.id, {
      project_id: data.projectId,
      title: data.title,
    });
    return row;
  });

export const updateAuditChecklist = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => auditUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, HSE_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.items !== undefined) {
      const scored = scoreChecklist(data.items as AuditItem[]);
      patch.items = data.items;
      patch.findings_count = scored.findingsCount;
      patch.score_pct = scored.scorePct;
    }
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    const row = await updateHseRow<{ id: string }>(
      context.supabase,
      "site_audit_checklists",
      data.id,
      patch,
    );
    await audit(context.supabase, "hse.audit.updated", "site_audit_checklists", data.id, {
      findings_count: patch.findings_count ?? null,
      score_pct: patch.score_pct ?? null,
      status: data.status ?? null,
    });
    return row;
  });

/* ------------------------- dashboard tile extension ------------------------ */

export const getHseExtDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(projectFilter)
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const supabase = context.supabase;
    const pid = data.projectId || null;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const in30 = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const scoped = <T>(q: T): T => (pid ? (q as never as { eq: Function }).eq("project_id", pid) : q);

    const [obs, comp, env, waste, audits, drills] = await Promise.all([
      scoped(
        supabase
          .from("safety_observations")
          .select("id", { count: "exact", head: true })
          .neq("status", "closed")
          .in("obs_type", ["unsafe_act", "unsafe_condition"]),
      ),
      supabase
        .from("competency_records")
        .select("id", { count: "exact", head: true })
        .gte("expiry_date", today)
        .lte("expiry_date", in30),
      scoped(
        supabase
          .from("environmental_monitoring")
          .select("id", { count: "exact", head: true })
          .eq("exceedance", true)
          .gte("measured_at", monthStart),
      ),
      scoped(supabase.from("waste_tracking").select("waste_type, qty, uom").limit(1000)),
      scoped(
        supabase
          .from("site_audit_checklists")
          .select("score_pct, audit_date")
          .not("score_pct", "is", null)
          .order("audit_date", { ascending: false })
          .limit(1),
      ),
      scoped(
        supabase
          .from("emergency_response")
          .select("response_time_minutes")
          .eq("kind", "drill")
          .not("response_time_minutes", "is", null)
          .limit(500),
      ),
    ]);

    const wasteRows = (waste.data ?? []) as Array<{ waste_type: string; qty: number; uom: string }>;
    const wasteByType: Record<string, number> = {};
    for (const r of wasteRows) {
      if ((r.uom ?? "kg").toLowerCase() !== "kg") continue;
      wasteByType[r.waste_type] = (wasteByType[r.waste_type] ?? 0) + Number(r.qty ?? 0);
    }
    const drillTimes = ((drills.data ?? []) as Array<{ response_time_minutes: number }>).map((d) =>
      Number(d.response_time_minutes),
    );

    return {
      openUnsafeObservations: obs.count ?? 0,
      competenciesExpiring: comp.count ?? 0,
      envExceedancesThisMonth: env.count ?? 0,
      wasteByType,
      wasteTotalKg: Object.values(wasteByType).reduce((a, b) => a + b, 0),
      lastAuditScore:
        ((audits.data ?? [])[0] as { score_pct: number | null } | undefined)?.score_pct ?? null,
      drillResponseAvgMinutes:
        drillTimes.length === 0
          ? null
          : Math.round((drillTimes.reduce((a, b) => a + b, 0) / drillTimes.length) * 10) / 10,
    };
  });

/* ------------------------- storage path prefix ---------------------------- */

/** Company UUID first — matches the storage RLS policy on the documents bucket. */
export const getHseStoragePrefix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    return { companyId };
  });
