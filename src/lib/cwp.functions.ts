// P-179 — CWP & construction-controls server functions. Thin wrappers only:
// every helper lives in cwp.server.ts / cwp.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  cwpCreateSchema,
  cwpUpdateSchema,
  delayAnalysisSchema,
  lookAheadStatusSchema,
  lookAheadUpsertSchema,
  recoveryPlanSchema,
  weightingRuleSchema,
} from "@/lib/cwp.rules";
import {
  assertRoles,
  audit,
  currentCompanyId,
  CONTROLS_WRITER_ROLES,
  CWP_WRITER_ROLES,
  httpError,
  insertWithNumber,
  startRecoveryApproval,
} from "@/lib/cwp.server";
import { isForwardCwpTransition } from "@/lib/quality.rules";
import { assertNoOpenHoldPoint } from "@/lib/quality.server";


export const listWorkPackages = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("construction_work_packages")
      .select("*")
      .eq("project_id", data.projectId)
      .order("cwp_number", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });

export const createWorkPackage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => cwpCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertWithNumber<{ id: string; cwp_number: string }>(
      context.supabase,
      "construction_work_packages",
      "cwp_number",
      "CWP",
      companyId,
      (cwp_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        cwp_number,
        title: data.title,
        description: data.description ?? null,
        discipline: data.discipline,
        area: data.area ?? null,
        wbs_item_id: data.wbsItemId ?? null,
        planned_start: data.plannedStart ?? null,
        planned_end: data.plannedEnd ?? null,
        weight: data.weight,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "cwp.created", "construction_work_packages", row.id, {
      project_id: data.projectId,
      cwp_number: row.cwp_number,
    });
    return row;
  });

export const updateWorkPackage = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => cwpUpdateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.discipline !== undefined) patch.discipline = data.discipline;
    if (data.area !== undefined) patch.area = data.area;
    if (data.wbsItemId !== undefined) patch.wbs_item_id = data.wbsItemId;
    if (data.plannedStart !== undefined) patch.planned_start = data.plannedStart;
    if (data.plannedEnd !== undefined) patch.planned_end = data.plannedEnd;
    if (data.status !== undefined) patch.status = data.status;
    if (data.weight !== undefined) patch.weight = data.weight;
    if (data.progressPct !== undefined) patch.progress_pct = data.progressPct;
    if (Object.keys(patch).length === 0) httpError(400, "empty_patch");
    // P-183 — forward progress is blocked while ITP hold points are unsigned.
    if (data.status !== undefined || data.progressPct !== undefined) {
      const { data: current, error: currentError } = await context.supabase
        .from("construction_work_packages")
        .select("id,status,progress_pct")
        .eq("id", data.id)
        .maybeSingle();
      if (currentError) throw currentError;
      const before = current as { status: string; progress_pct: number | null } | null;
      if (
        isForwardCwpTransition({
          fromStatus: before?.status ?? null,
          toStatus: data.status ?? null,
          fromProgress: before?.progress_pct ?? 0,
          toProgress: data.progressPct ?? null,
        })
      ) {
        await assertNoOpenHoldPoint(context.supabase, data.id);
      }
    }

    const { data: row, error } = await context.supabase
      .from("construction_work_packages")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(context.supabase, "cwp.updated", "construction_work_packages", data.id, patch);
    return row;
  });

export const getLookAheadPlan = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid(), weekStart: z.string() }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("look_ahead_plans")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("week_start", data.weekStart)
      .maybeSingle();
    if (error) throw error;
    return row ?? null;
  });

export const upsertLookAheadPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => lookAheadUpsertSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const { data: row, error } = await context.supabase
      .from("look_ahead_plans")
      .upsert(
        {
          company_id: companyId,
          project_id: data.projectId,
          week_start: data.weekStart,
          entries: data.entries as never,
          notes: data.notes ?? null,
          created_by: context.user!.id,
        } as never,
        { onConflict: "company_id,project_id,week_start" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const setLookAheadStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => lookAheadStatusSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const { data: row, error } = await context.supabase
      .from("look_ahead_plans")
      .update({
        status: data.status,
        published_by: data.status === "published" ? context.user!.id : undefined,
        published_at: data.status === "published" ? new Date().toISOString() : undefined,
      } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(context.supabase, `look_ahead.${data.status}`, "look_ahead_plans", data.id, {});
    return row;
  });

export const listWeightingRules = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("progress_weighting_rules")
      .select("*")
      .order("discipline", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const createWeightingRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => weightingRuleSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CONTROLS_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const { data: row, error } = await context.supabase
      .from("progress_weighting_rules")
      .insert({
        company_id: companyId,
        project_id: data.projectId ?? null,
        discipline: data.discipline,
        name: data.name,
        uom: data.uom,
        target_qty: data.targetQty,
        weight_pct: data.weightPct,
        is_active: data.isActive,
        created_by: context.user!.id,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const listDelayAnalysis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("delay_analysis")
      .select("*")
      .eq("project_id", data.projectId)
      .order("delay_date", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const recordDelay = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => delayAnalysisSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const { data: row, error } = await context.supabase
      .from("delay_analysis")
      .insert({
        company_id: companyId,
        project_id: data.projectId,
        schedule_task_id: data.scheduleTaskId ?? null,
        cwp_id: data.cwpId ?? null,
        weather_delay_id: data.weatherDelayId ?? null,
        delay_date: data.delayDate,
        cause: data.cause,
        lost_days: data.lostDays,
        narrative: data.narrative ?? null,
        eot_claim: data.eotClaim,
        created_by: context.user!.id,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const createRecoveryPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => recoveryPlanSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CONTROLS_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user!.id);
    const row = await insertWithNumber<{ id: string; plan_number: string }>(
      context.supabase,
      "recovery_plans",
      "plan_number",
      "RCP",
      companyId,
      (plan_number) => ({
        company_id: companyId,
        project_id: data.projectId,
        delay_analysis_id: data.delayAnalysisId ?? null,
        plan_number,
        title: data.title,
        actions: data.actions,
        target_recovery_date: data.targetRecoveryDate ?? null,
        created_by: context.user!.id,
      }),
    );
    await audit(context.supabase, "recovery_plan.created", "recovery_plans", row.id, {
      project_id: data.projectId,
      plan_number: row.plan_number,
    });
    return row;
  });

export const activateRecoveryPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CONTROLS_WRITER_ROLES);
    const { data: plan, error: readErr } = await context.supabase
      .from("recovery_plans")
      .select("id, project_id, status")
      .eq("id", data.id)
      .single();
    if (readErr) throw readErr;
    if ((plan as { status: string }).status !== "draft") httpError(409, "plan_not_draft");

    const instanceId = await startRecoveryApproval(
      context.supabase,
      data.id,
      (plan as { project_id: string }).project_id,
    );

    // Fallback: no approval rule configured → inline construction_admin sign-off.
    const patch = instanceId
      ? { status: "active" as const }
      : {
          status: "active" as const,
          approved_by: context.user!.id,
          approved_at: new Date().toISOString(),
        };
    const { data: row, error } = await context.supabase
      .from("recovery_plans")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(context.supabase, "recovery_plan.activated", "recovery_plans", data.id, {
      approval_instance_id: instanceId,
      inline_approval: !instanceId,
    });
    return { row, approval_instance_id: instanceId };
  });
