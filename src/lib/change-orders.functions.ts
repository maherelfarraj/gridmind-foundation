// P-079 — Change orders: minimal CRUD (full workflow in later batch).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  ChangeOrderUpsertSchema,
  nextChangeOrderNumber,
  type ChangeOrderRow,
} from "@/lib/change-orders.rules";

const WRITE_ROLES = ["project_admin", "finance_admin", "company_admin"] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const r = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as any })),
  );
  return r.some((x) => Boolean(x?.data));
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (ctx as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as any)?.company_id as string | undefined;
  if (!id) httpError(400, "no_company");
  return id!;
}

function toRow(r: any): ChangeOrderRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    contract_id: r.contract_id ?? null,
    co_number: r.co_number,
    title: r.title,
    description: r.description ?? null,
    status: r.status,
    amount: Number(r.amount ?? 0),
    currency_code: r.currency_code ?? null,
    schedule_impact_days: Number(r.schedule_impact_days ?? 0),
    budget_impact: Array.isArray(r.budget_impact) ? r.budget_impact : [],
    wbs_item_id: r.wbs_item_id ?? null,
    submitted_by: r.submitted_by ?? null,
    submitted_at: r.submitted_at ?? null,
    approved_by: r.approved_by ?? null,
    approved_at: r.approved_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export const listChangeOrders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ project_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: ChangeOrderRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("change_orders")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const upsertChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ChangeOrderUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);

    if (data.id) {
      const patch: Record<string, unknown> = {
        title: data.title,
        description: data.description ?? null,
        amount: data.amount,
        currency_code: data.currency_code ?? null,
        schedule_impact_days: data.schedule_impact_days,
        budget_impact: data.budget_impact as any,
        wbs_item_id: data.wbs_item_id ?? null,
        contract_id: data.contract_id ?? null,
      };
      if (data.status) patch.status = data.status;
      const { data: upd, error } = await context.supabase
        .from("change_orders")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = toRow(upd);
      await context.supabase.rpc("write_audit_log", {
        p_action: "change_order.update",
        p_entity: "change_orders",
        p_entity_id: row.id as any,
        p_metadata: { amount: row.amount, status: row.status } as any,
      });
      return row;
    }

    const year = new Date().getUTCFullYear();
    const { data: nums, error: nErr } = await context.supabase
      .from("change_orders")
      .select("co_number")
      .eq("company_id", companyId)
      .ilike("co_number", `CO-${year}-%`);
    if (nErr) throw nErr;
    const coNumber = nextChangeOrderNumber(
      ((nums ?? []) as any[]).map((r) => String(r.co_number)),
    );
    const { data: ins, error: iErr } = await context.supabase
      .from("change_orders")
      .insert({
        company_id: companyId,
        project_id: data.project_id,
        contract_id: data.contract_id ?? null,
        co_number: coNumber,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? "draft",
        amount: data.amount,
        currency_code: data.currency_code ?? null,
        schedule_impact_days: data.schedule_impact_days,
        budget_impact: data.budget_impact as any,
        wbs_item_id: data.wbs_item_id ?? null,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .maybeSingle();
    if (iErr) throw iErr;
    const row = toRow(ins);
    await context.supabase.rpc("write_audit_log", {
      p_action: "change_order.create",
      p_entity: "change_orders",
      p_entity_id: row.id as any,
      p_metadata: { co_number: row.co_number, amount: row.amount } as any,
    });
    return row;
  });
