// P-082 — PPA terms server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { currentCompanyId, hasAnyRole, httpError, writeAudit } from "@/lib/project-finance-shared";
import { PpaUpsertSchema, type PpaRow } from "@/lib/project-finance.rules";

const WRITE_ROLES = ["finance_admin", "company_admin"] as const;

function toRow(r: any): PpaRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    name: r.name,
    counterparty: r.counterparty ?? null,
    contract_id: r.contract_id ?? null,
    term_years: Number(r.term_years),
    tariff: Number(r.tariff),
    currency_code: r.currency_code,
    escalation_pct: Number(r.escalation_pct ?? 0),
    capacity_mw: r.capacity_mw == null ? null : Number(r.capacity_mw),
    annual_energy_mwh: r.annual_energy_mwh == null ? null : Number(r.annual_energy_mwh),
    availability_target_pct:
      r.availability_target_pct == null ? null : Number(r.availability_target_pct),
    liquidated_damages: (r.liquidated_damages ?? {}) as Record<string, any>,
    notes: r.notes ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const listPpaTerms = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ rows: PpaRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("ppa_terms" as any)
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const listPpaContractCandidates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      contracts: Array<{
        id: string;
        contract_number: string;
        title: string;
        currency_code: string | null;
      }>;
    }> => {
      requireSupabaseAuth(context);
      const { data: rows, error } = await context.supabase
        .from("contracts" as any)
        .select("id, contract_number, title, currency_code, status")
        .eq("project_id", data.project_id)
        .in("status", ["signed", "active"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return {
        contracts: ((rows ?? []) as any[]).map((r) => ({
          id: r.id,
          contract_number: r.contract_number,
          title: r.title,
          currency_code: r.currency_code ?? null,
        })),
      };
    },
  );

export const getProjectFinanceAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean; canWriteDd: boolean }> => {
    requireSupabaseAuth(context);
    const [canWrite, ddExtra] = await Promise.all([
      hasAnyRole(context as AuthContext, WRITE_ROLES),
      hasAnyRole(context as AuthContext, ["legal_admin"] as const),
    ]);
    return { canWrite, canWriteDd: canWrite || ddExtra };
  });

export const upsertPpaTerms = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => PpaUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<PpaRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    const companyId = await currentCompanyId(context as AuthContext);
    const payload: Record<string, any> = {
      project_id: data.project_id,
      name: data.name,
      counterparty: data.counterparty ?? null,
      contract_id: data.contract_id ?? null,
      term_years: data.term_years,
      tariff: data.tariff,
      currency_code: data.currency_code,
      escalation_pct: data.escalation_pct,
      capacity_mw: data.capacity_mw ?? null,
      annual_energy_mwh: data.annual_energy_mwh ?? null,
      availability_target_pct: data.availability_target_pct ?? null,
      liquidated_damages: data.liquidated_damages ?? {},
      notes: data.notes ?? null,
    };

    if (data.id) {
      const { data: upd, error } = await context.supabase
        .from("ppa_terms" as any)
        .update(payload as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = toRow(upd);
      await writeAudit(context as AuthContext, "ppa.update", "ppa_terms", row.id, {
        project_id: row.project_id,
        tariff: row.tariff,
      });
      return row;
    }

    const { data: ins, error } = await context.supabase
      .from("ppa_terms" as any)
      .insert({
        ...payload,
        company_id: companyId,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const row = toRow(ins);
    await writeAudit(context as AuthContext, "ppa.create", "ppa_terms", row.id, {
      project_id: row.project_id,
      tariff: row.tariff,
    });
    return row;
  });
