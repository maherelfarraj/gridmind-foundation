// GC-01 — Costing workspace server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  accrualCreateSchema,
  accrualTransitionSchema,
  canTransitionAccrual,
  costingProjectSchema,
  forecastDeleteSchema,
  forecastUpsertSchema,
  nextAccrualStatus,
  type AccrualStatus,
} from "@/lib/costing.rules";
import {
  COSTING_WRITE_ROLES,
  costingAudit,
  costingHttpError,
  hasAnyCostingRole,
  loadCostingProject,
  loadCostingWorkspace,
  type CostingWorkspaceData,
} from "@/lib/costing.server";

export type { CostingWorkspaceData };

export const getCostingAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyCostingRole(context, COSTING_WRITE_ROLES) };
  });

export const getCostingWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costingProjectSchema.parse(input))
  .handler(async ({ data, context }): Promise<CostingWorkspaceData> => {
    requireSupabaseAuth(context);
    return loadCostingWorkspace(context, data.projectId);
  });

export const upsertCostForecast = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => forecastUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyCostingRole(context, COSTING_WRITE_ROLES)))
      costingHttpError(403, "forbidden");
    const project = await loadCostingProject(context, data.projectId);
    const { data: row, error } = await (context.supabase as any)
      .from("cost_forecast_periods")
      .upsert(
        {
          company_id: project.company_id,
          project_id: project.id,
          cost_code_id: data.cost_code_id,
          period: data.period,
          etc_amount: data.etc_amount,
          currency_code: data.currency_code.toUpperCase(),
          notes: data.notes ?? null,
          created_by: (context as any).user.id,
        },
        { onConflict: "project_id,cost_code_id,period" },
      )
      .select("id")
      .single();
    if (error) throw error;
    await costingAudit(context, "costing.forecast.upsert", "cost_forecast_periods", row.id, {
      project_id: project.id,
      period: data.period,
      etc_amount: data.etc_amount,
    });
    return { id: row.id as string };
  });

export const deleteCostForecast = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => forecastDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyCostingRole(context, COSTING_WRITE_ROLES)))
      costingHttpError(403, "forbidden");
    const { error } = await (context.supabase as any)
      .from("cost_forecast_periods")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    await costingAudit(context, "costing.forecast.delete", "cost_forecast_periods", data.id, {});
    return { ok: true };
  });

export const createCostAccrual = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => accrualCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyCostingRole(context, COSTING_WRITE_ROLES)))
      costingHttpError(403, "forbidden");
    const project = await loadCostingProject(context, data.projectId);
    const { data: row, error } = await (context.supabase as any)
      .from("cost_accruals")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        period: data.period,
        amount: data.amount,
        currency_code: data.currency_code.toUpperCase(),
        description: data.description ?? null,
        created_by: (context as any).user.id,
      })
      .select("id")
      .single();
    if (error) throw error;
    await costingAudit(context, "costing.accrual.create", "cost_accruals", row.id, {
      project_id: project.id,
      amount: data.amount,
      period: data.period,
    });
    return { id: row.id as string };
  });

export const transitionCostAccrual = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => accrualTransitionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: AccrualStatus }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyCostingRole(context, COSTING_WRITE_ROLES)))
      costingHttpError(403, "forbidden");
    const sb = context.supabase as any;
    const { data: current, error: loadErr } = await sb
      .from("cost_accruals")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!current) costingHttpError(404, "accrual_not_found");
    const from = current.status as AccrualStatus;
    if (!canTransitionAccrual(from, data.action)) {
      costingHttpError(409, "invalid_transition", `Cannot ${data.action} a ${from} accrual.`);
    }
    const next = nextAccrualStatus(from, data.action);
    const userId = (context as any).user.id;
    const patch =
      data.action === "approve"
        ? { status: next, approved_by: userId, approved_at: new Date().toISOString() }
        : {
            status: next,
            reversed_by: userId,
            reversed_at: new Date().toISOString(),
            reversal_reason: data.reason ?? null,
          };
    const { error } = await sb.from("cost_accruals").update(patch).eq("id", data.id);
    if (error) throw error;
    await costingAudit(context, `costing.accrual.${data.action}`, "cost_accruals", data.id, {
      from,
      to: next,
    });
    return { status: next };
  });
