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
import { canApproveWithFx, convertMoney, reverseSnapshot } from "@/lib/costing.fx";
import {
  assertCostingPeriodOpen,
  findNextOpenPeriod,
  loadPeriodState,
} from "@/lib/costing.close.server";
import { nextPeriodMonth, periodMonthOf } from "@/lib/costing.periods";
import {
  COSTING_WRITE_ROLES,
  costingAudit,
  costingHttpError,
  hasAnyCostingRole,
  loadCostingProject,
  loadCostingWorkspace,
  resolveCostingFx,
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
    // GC-03 — the one authoritative period gate, on this row's own business date.
    await assertCostingPeriodOpen(context, project.company_id, project.id, data.period, {
      entity: "cost_forecast_periods",
    });
    const fx = await resolveCostingFx(
      context,
      project.id,
      data.currency_code,
      data.period,
      data.fx_override ?? null,
    );
    // A forecast feeds EAC directly, so it may never be stored unconverted.
    if (!canApproveWithFx(fx)) {
      costingHttpError(
        409,
        "fx_rate_missing",
        `No exchange rate from ${data.currency_code.toUpperCase()} to ${fx.base_currency_code} on or before ${data.period}.`,
      );
    }
    const rate = fx.fx_rate as number;
    const { data: row, error } = await (context.supabase as any)
      .from("cost_forecast_periods")
      .upsert(
        {
          company_id: project.company_id,
          project_id: project.id,
          cost_code_id: data.cost_code_id,
          period: data.period,
          etc_amount: data.etc_amount,
          etc_amount_base: convertMoney(data.etc_amount, rate),
          currency_code: data.currency_code.toUpperCase(),
          base_currency_code: fx.base_currency_code,
          fx_rate: rate,
          fx_rate_date: fx.fx_rate_date,
          fx_source: fx.fx_source,
          fx_override_reason: fx.fx_override_reason,
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
      currency_code: data.currency_code.toUpperCase(),
      fx_rate: rate,
      fx_source: fx.fx_source,
      fx_override_reason: fx.fx_override_reason,
      fx_stale: fx.stale,
      etc_amount_base: convertMoney(data.etc_amount, rate),
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
    const sb = context.supabase as any;
    const { data: row, error: loadErr } = await sb
      .from("cost_forecast_periods")
      .select("id, company_id, project_id, period")
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!row) costingHttpError(404, "forecast_not_found");
    await assertCostingPeriodOpen(context, row.company_id, row.project_id, row.period, {
      entity: "cost_forecast_periods",
      entityId: data.id,
    });
    const { error } = await sb.from("cost_forecast_periods").delete().eq("id", data.id);
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
    await assertCostingPeriodOpen(context, project.company_id, project.id, data.period, {
      entity: "cost_accruals",
    });
    const fx = await resolveCostingFx(
      context,
      project.id,
      data.currency_code,
      data.period,
      data.fx_override ?? null,
    );
    // Drafts may be saved with the latest available rate — or unrated when no
    // rate exists. Drafts never enter a roll-up; approval re-resolves and locks.
    const rate = fx.fx_rate ?? 1;
    const { data: row, error } = await (context.supabase as any)
      .from("cost_accruals")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        period: data.period,
        amount: data.amount,
        amount_base: fx.missing ? 0 : convertMoney(data.amount, rate),
        currency_code: data.currency_code.toUpperCase(),
        base_currency_code: fx.base_currency_code,
        fx_rate: rate,
        fx_rate_date: fx.fx_rate_date,
        fx_source: fx.fx_source,
        fx_override_reason: fx.fx_override_reason,
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
      currency_code: data.currency_code.toUpperCase(),
      fx_rate: rate,
      fx_source: fx.fx_source,
      fx_missing: fx.missing,
      fx_stale: fx.stale,
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
      .select(
        "id, status, company_id, project_id, period, amount, amount_base, currency_code, base_currency_code, fx_rate, fx_rate_date, fx_source, fx_locked_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!current) costingHttpError(404, "accrual_not_found");
    const from0 = current.status as AccrualStatus;

    // A reversal of a row whose own period is closed is NOT blocked: it is
    // posted into the next open period, referencing the original and reusing
    // its locked FX. Everything else is gated on the row's own period.
    const originalState = await loadPeriodState(
      context,
      current.company_id as string,
      current.project_id as string,
      current.period as string,
    );
    const reversalIntoNextPeriod = data.action === "reverse" && originalState !== "open";
    if (!reversalIntoNextPeriod) {
      await assertCostingPeriodOpen(
        context,
        current.company_id as string,
        current.project_id as string,
        current.period as string,
        { entity: "cost_accruals", entityId: data.id },
      );
    }
    const from = from0;
    if (!canTransitionAccrual(from, data.action)) {
      costingHttpError(409, "invalid_transition", `Cannot ${data.action} a ${from} accrual.`);
    }
    const next = nextAccrualStatus(from, data.action);
    const userId = (context as any).user.id;

    if (reversalIntoNextPeriod) {
      const target = await findNextOpenPeriod(
        context,
        current.company_id as string,
        current.project_id as string,
        nextPeriodMonth(periodMonthOf(current.period as string)),
      );
      if (!target) {
        costingHttpError(
          409,
          "costing_period_no_open_period",
          "No open costing period is available to post this reversal into.",
        );
      }
      const negated = reverseSnapshot({
        amount: Number(current.amount),
        amount_base: Number(current.amount_base ?? 0),
        fx_rate: Number(current.fx_rate ?? 1),
        fx_rate_date: (current.fx_rate_date as string | null) ?? null,
        fx_source: (current.fx_source ?? "parity") as "parity" | "table" | "manual",
      });
      const now = new Date().toISOString();
      const { data: ins, error: insErr } = await sb
        .from("cost_accruals")
        .insert({
          company_id: current.company_id,
          project_id: current.project_id,
          cost_code_id: current.cost_code_id,
          period: target,
          amount: negated.amount,
          amount_base: negated.amount_base,
          currency_code: current.currency_code,
          base_currency_code: current.base_currency_code,
          fx_rate: negated.fx_rate,
          fx_rate_date: negated.fx_rate_date,
          fx_source: negated.fx_source,
          description: data.reason
            ? `Reversal of accrual ${data.id}: ${data.reason}`
            : `Reversal of accrual ${data.id}`,
          reversal_reason: data.reason ?? null,
          reverses_accrual_id: data.id,
          status: "reversed",
          approved_by: userId,
          approved_at: now,
          reversed_by: userId,
          reversed_at: now,
          fx_locked_at: (current.fx_locked_at as string | null) ?? now,
          fx_locked_by: userId,
          created_by: userId,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      await costingAudit(context, "costing.accrual.reverse", "cost_accruals", ins.id as string, {
        from,
        to: "reversed",
        reverses_accrual_id: data.id,
        original_period: current.period,
        posted_period: target,
        original_period_state: originalState,
        reversal_amount: negated.amount,
        reversal_amount_base: negated.amount_base,
        fx_rate: negated.fx_rate,
        fx_source: negated.fx_source,
        re_rated: false,
      });
      return { status: "reversed" };
    }

    let patch: Record<string, unknown>;
    let auditExtra: Record<string, unknown> = {};

    if (data.action === "approve") {
      // Approval snapshots (locks) the rate and the converted amount so the
      // audited project-currency value can never drift with later rates.
      const locked = Boolean(current.fx_locked_at);
      const fx = locked
        ? {
            base_currency_code: current.base_currency_code as string,
            fx_rate: Number(current.fx_rate),
            fx_rate_date: current.fx_rate_date as string | null,
            fx_source: current.fx_source as "parity" | "table" | "manual",
            fx_override_reason: null,
            stale: false,
            missing: false,
          }
        : await resolveCostingFx(
            context,
            current.project_id as string,
            current.currency_code as string,
            current.period as string,
          );
      if (!canApproveWithFx(fx)) {
        costingHttpError(
          409,
          "fx_rate_missing",
          `Cannot approve: no exchange rate from ${current.currency_code} to ${fx.base_currency_code} on or before ${current.period}.`,
        );
      }
      const rate = fx.fx_rate as number;
      const amountBase = convertMoney(Number(current.amount), rate);
      patch = {
        status: next,
        approved_by: userId,
        approved_at: new Date().toISOString(),
        base_currency_code: fx.base_currency_code,
        fx_rate: rate,
        fx_rate_date: fx.fx_rate_date,
        fx_source: fx.fx_source,
        amount_base: amountBase,
        fx_locked_at: new Date().toISOString(),
        fx_locked_by: userId,
      };
      auditExtra = {
        fx_rate: rate,
        fx_source: fx.fx_source,
        fx_locked: true,
        amount_base: amountBase,
        currency_code: current.currency_code,
      };
    } else {
      // Reversal never re-rates: it negates the locked transaction and
      // project-currency values against the original snapshot.
      const negated = reverseSnapshot({
        amount: Number(current.amount),
        amount_base: Number(current.amount_base ?? 0),
        fx_rate: Number(current.fx_rate ?? 1),
        fx_rate_date: (current.fx_rate_date as string | null) ?? null,
        fx_source: (current.fx_source ?? "parity") as "parity" | "table" | "manual",
      });
      patch = {
        status: next,
        reversed_by: userId,
        reversed_at: new Date().toISOString(),
        reversal_reason: data.reason ?? null,
      };
      auditExtra = {
        reverses_accrual_id: data.id,
        reversal_amount: negated.amount,
        reversal_amount_base: negated.amount_base,
        fx_rate: negated.fx_rate,
        fx_source: negated.fx_source,
        re_rated: false,
      };
    }

    const { error } = await sb.from("cost_accruals").update(patch).eq("id", data.id);
    if (error) throw error;
    await costingAudit(context, `costing.accrual.${data.action}`, "cost_accruals", data.id, {
      from,
      to: next,
      ...auditExtra,
    });
    return { status: next };
  });
