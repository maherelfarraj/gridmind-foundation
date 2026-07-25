// P-082 — Bank facilities server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { currentCompanyId, hasAnyRole, httpError, writeAudit } from "@/lib/project-finance-shared";
import {
  assertDrawdownAllowed,
  FacilityDrawdownSchema,
  FacilityUpsertSchema,
  type BankFacilityRow,
} from "@/lib/project-finance.rules";

const WRITE_ROLES = ["finance_admin", "company_admin"] as const;

function toRow(r: any): BankFacilityRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id ?? null,
    lender_name: r.lender_name,
    facility_type: r.facility_type,
    commitment_amount: Number(r.commitment_amount),
    drawn_amount: Number(r.drawn_amount ?? 0),
    currency_code: r.currency_code,
    interest_rate_pct: r.interest_rate_pct == null ? null : Number(r.interest_rate_pct),
    margin_pct: r.margin_pct == null ? null : Number(r.margin_pct),
    maturity_date: r.maturity_date ?? null,
    covenants: Array.isArray(r.covenants) ? r.covenants : [],
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function loadFacility(ctx: AuthContext, id: string): Promise<BankFacilityRow> {
  const { data, error } = await ctx.supabase
    .from("bank_facilities" as any)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  return toRow(data);
}

export const listBankFacilities = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ project_id: z.string().uuid().nullable().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: BankFacilityRow[] }> => {
    requireSupabaseAuth(context);
    let q = context.supabase.from("bank_facilities" as any).select("*");
    if (data.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q.order("created_at", {
      ascending: false,
    });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const upsertBankFacility = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => FacilityUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<BankFacilityRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    if (data.drawn_amount > data.commitment_amount + 0.005) {
      httpError(422, "drawn_exceeds_commitment");
    }
    const companyId = await currentCompanyId(context as AuthContext);

    const payload: Record<string, unknown> = {
      project_id: data.project_id ?? null,
      lender_name: data.lender_name,
      facility_type: data.facility_type,
      commitment_amount: data.commitment_amount,
      drawn_amount: data.drawn_amount,
      currency_code: data.currency_code,
      interest_rate_pct: data.interest_rate_pct ?? null,
      margin_pct: data.margin_pct ?? null,
      maturity_date: data.maturity_date ?? null,
      covenants: data.covenants ?? [],
      status: data.status,
    };

    if (data.id) {
      const { data: upd, error } = await context.supabase
        .from("bank_facilities" as any)
        .update(payload as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) httpError(422, "facility_update_failed", error.message);
      const row = toRow(upd);
      await writeAudit(context as AuthContext, "facility.update", "bank_facilities", row.id, {
        commitment: row.commitment_amount,
        drawn: row.drawn_amount,
      });
      return row;
    }

    const { data: ins, error } = await context.supabase
      .from("bank_facilities" as any)
      .insert({
        ...payload,
        company_id: companyId,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (error) httpError(422, "facility_create_failed", error.message);
    const row = toRow(ins);
    await writeAudit(context as AuthContext, "facility.create", "bank_facilities", row.id, {
      commitment: row.commitment_amount,
      facility_type: row.facility_type,
      lender: row.lender_name,
    });
    return row;
  });

export const recordFacilityDrawdown = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => FacilityDrawdownSchema.parse(input))
  .handler(async ({ data, context }): Promise<BankFacilityRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context as AuthContext, WRITE_ROLES))) {
      httpError(403, "forbidden");
    }
    const before = await loadFacility(context as AuthContext, data.id);
    try {
      assertDrawdownAllowed(before.drawn_amount, data.amount, before.commitment_amount);
    } catch (e) {
      httpError(422, "drawdown_exceeds_commitment", (e as Error).message);
    }
    const newDrawn = before.drawn_amount + data.amount;
    const { data: upd, error } = await context.supabase
      .from("bank_facilities" as any)
      .update({ drawn_amount: newDrawn } as any)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) httpError(422, "drawdown_failed", error.message);
    const row = toRow(upd);
    await writeAudit(context as AuthContext, "facility.drawdown", "bank_facilities", row.id, {
      amount: data.amount,
      previous_drawn: before.drawn_amount,
      new_drawn: row.drawn_amount,
      note: data.note ?? null,
    });
    return row;
  });
