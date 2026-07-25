// P-082 — LCOE scenarios server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { currentCompanyId, hasAnyRole, httpError, writeAudit } from "@/lib/project-finance-shared";
import { computeLcoe, LcoeUpsertSchema, type LcoeRow } from "@/lib/project-finance.rules";

const WRITE_ROLES = ["finance_admin", "company_admin"] as const;

function toRow(r: any): LcoeRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    name: r.name,
    capex: Number(r.capex),
    opex_annual: Number(r.opex_annual),
    discount_rate_pct: Number(r.discount_rate_pct),
    annual_energy_mwh: Number(r.annual_energy_mwh),
    degradation_pct: Number(r.degradation_pct),
    project_life_years: Number(r.project_life_years),
    currency_code: r.currency_code,
    lcoe: r.lcoe == null ? null : Number(r.lcoe),
    assumptions: (r.assumptions ?? {}) as Record<string, any>,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const listLcoeScenarios = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ rows: LcoeRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("lcoe_scenarios" as any)
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const upsertLcoeScenario = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => LcoeUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<LcoeRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    const companyId = await currentCompanyId(context as AuthContext);

    const lcoe = computeLcoe({
      capex: data.capex,
      opex_annual: data.opex_annual,
      discount_rate_pct: data.discount_rate_pct,
      annual_energy_mwh: data.annual_energy_mwh,
      degradation_pct: data.degradation_pct,
      project_life_years: data.project_life_years,
    });

    const payload: Record<string, any> = {
      project_id: data.project_id,
      name: data.name,
      capex: data.capex,
      opex_annual: data.opex_annual,
      discount_rate_pct: data.discount_rate_pct,
      annual_energy_mwh: data.annual_energy_mwh,
      degradation_pct: data.degradation_pct,
      project_life_years: data.project_life_years,
      currency_code: data.currency_code,
      lcoe,
      assumptions: data.assumptions ?? {},
    };

    if (data.id) {
      const { data: upd, error } = await context.supabase
        .from("lcoe_scenarios" as any)
        .update(payload as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = toRow(upd);
      await writeAudit(context as AuthContext, "lcoe.save", "lcoe_scenarios", row.id, {
        project_id: row.project_id,
        lcoe: row.lcoe,
        name: row.name,
      });
      return row;
    }

    const { data: ins, error } = await context.supabase
      .from("lcoe_scenarios" as any)
      .insert({
        ...payload,
        company_id: companyId,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = toRow(ins);
    await writeAudit(context as AuthContext, "lcoe.save", "lcoe_scenarios", row.id, {
      project_id: row.project_id,
      lcoe: row.lcoe,
      name: row.name,
    });
    return row;
  });
