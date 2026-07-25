// P-081 — Change orders: full workflow (create/submit/approve/reject/incorporate).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  ChangeOrderUpsertSchema,
  CO_LOCKED_STATUSES,
  isBudgetImpactBalanced,
  nextChangeOrderNumber,
  type ChangeOrderRow,
  type ChangeOrderStatus,
} from "@/lib/change-orders.rules";

const WRITE_ROLES = ["project_admin", "finance_admin", "company_admin"] as const;
const APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

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
    approval_instance_id: r.approval_instance_id ?? null,
    submitted_by: r.submitted_by ?? null,
    submitted_at: r.submitted_at ?? null,
    approved_by: r.approved_by ?? null,
    approved_at: r.approved_at ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function loadCo(ctx: AuthContext, id: string): Promise<ChangeOrderRow> {
  const { data, error } = await ctx.supabase
    .from("change_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  return toRow(data);
}

async function audit(ctx: AuthContext, action: string, id: string, meta: Record<string, unknown>) {
  await ctx.supabase.rpc("write_audit_log", {
    p_action: action,
    p_entity: "change_orders",
    p_entity_id: id as any,
    p_metadata: meta as any,
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export const listChangeOrders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
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

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getChangeOrderAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean; canApprove: boolean }> => {
    requireSupabaseAuth(context);
    const [canWrite, canApprove] = await Promise.all([
      hasAnyRole(context, WRITE_ROLES),
      hasAnyRole(context, APPROVE_ROLES),
    ]);
    return { canWrite, canApprove };
  });

// ---------------------------------------------------------------------------
// Upsert (draft only for edits when unlocked)
// ---------------------------------------------------------------------------
export const upsertChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ChangeOrderUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);

    if (data.id) {
      const existing = await loadCo(context, data.id);
      if (CO_LOCKED_STATUSES.includes(existing.status)) {
        httpError(409, "co_locked", `Change order is ${existing.status}; edits blocked.`);
      }
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
      const { data: upd, error } = await context.supabase
        .from("change_orders")
        .update(patch as any)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = toRow(upd);
      await audit(context, "co.update", row.id, {
        co_id: row.id,
        amount: row.amount,
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
    const coNumber = nextChangeOrderNumber(((nums ?? []) as any[]).map((r) => String(r.co_number)));
    const { data: ins, error: iErr } = await context.supabase
      .from("change_orders")
      .insert({
        company_id: companyId,
        project_id: data.project_id,
        contract_id: data.contract_id ?? null,
        co_number: coNumber,
        title: data.title,
        description: data.description ?? null,
        status: "draft",
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
    await audit(context, "co.create", row.id, {
      co_id: row.id,
      co_number: row.co_number,
      amount: row.amount,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------
export const submitChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    const co = await loadCo(context, data.id);
    if (co.status !== "draft") httpError(409, "invalid_status", `Cannot submit from ${co.status}.`);
    if (!isBudgetImpactBalanced(co.budget_impact, co.amount)) {
      httpError(422, "budget_impact_unbalanced", "Budget impact must sum to amount.");
    }

    // Best-effort approval instance
    let instanceId: string | null = null;
    try {
      const { data: inst } = await context.supabase
        .from("approval_instances" as any)
        .insert({
          company_id: co.company_id,
          entity: "change_orders",
          entity_id: co.id,
          status: "pending",
          requested_by: (context as any).user.id,
          metadata: { amount: co.amount, co_number: co.co_number },
        } as any)
        .select("id")
        .maybeSingle();
      instanceId = (inst as any)?.id ?? null;
    } catch {
      instanceId = null;
    }

    const { data: upd, error } = await context.supabase
      .from("change_orders")
      .update({
        status: "submitted",
        submitted_by: (context as any).user.id,
        submitted_at: new Date().toISOString(),
        approval_instance_id: instanceId,
      } as any)
      .eq("id", co.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const row = toRow(upd);
    await audit(context, "co.submit", row.id, {
      co_id: row.id,
      amount: row.amount,
      approval_instance_id: instanceId,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Approve (RPC handles budget propagation atomically)
// ---------------------------------------------------------------------------
export const approveChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, APPROVE_ROLES))) httpError(403, "forbidden");

    const { data: result, error } = await context.supabase.rpc(
      "approve_change_order" as any,
      { p_co_id: data.id, p_note: data.note ?? null } as any,
    );
    if (error) httpError(422, "approve_failed", error.message);

    const row = await loadCo(context, data.id);
    const meta = (result as any) ?? {};
    await audit(context, "co.approve", row.id, {
      co_id: row.id,
      budgets_touched: meta.budgets_touched ?? [],
      note: data.note ?? null,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Reject (note required)
// ---------------------------------------------------------------------------
export const rejectChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().min(1, "Note is required").max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, APPROVE_ROLES))) httpError(403, "forbidden");

    const co = await loadCo(context, data.id);
    if (co.status !== "submitted" && co.status !== "under_review") {
      httpError(409, "invalid_status", `Cannot reject from ${co.status}.`);
    }

    const { data: upd, error } = await context.supabase
      .from("change_orders")
      .update({ status: "rejected" } as any)
      .eq("id", co.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    // Mirror rejection into approval_instance if present
    if (co.approval_instance_id) {
      await context.supabase
        .from("approval_instances" as any)
        .update({
          status: "rejected",
          decided_by: (context as any).user.id,
          decided_at: new Date().toISOString(),
          metadata: { note: data.note },
        } as any)
        .eq("id", co.approval_instance_id);
    }

    const row = toRow(upd);
    await audit(context, "co.reject", row.id, {
      co_id: row.id,
      note: data.note,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Incorporate (RPC shifts unstarted tasks atomically)
// ---------------------------------------------------------------------------
export const incorporateChangeOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ChangeOrderRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, APPROVE_ROLES))) httpError(403, "forbidden");

    const { data: result, error } = await context.supabase.rpc(
      "incorporate_change_order" as any,
      { p_co_id: data.id } as any,
    );
    if (error) httpError(422, "incorporate_failed", error.message);

    const row = await loadCo(context, data.id);
    const meta = (result as any) ?? {};
    await audit(context, "co.incorporate", row.id, {
      co_id: row.id,
      tasks_shifted: meta.tasks_shifted ?? [],
      days: meta.days ?? row.schedule_impact_days,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Detail (CO + linked contract + wbs + affected budgets + audit trail + tasks)
// ---------------------------------------------------------------------------
export interface ContractLite {
  id: string;
  contract_number: string;
  title: string;
  status: string;
  value: number | null;
  currency_code: string | null;
}
export interface WbsItemLite {
  id: string;
  code: string;
  name: string;
}
export interface CostCodeLite {
  id: string;
  code: string;
  name: string;
}
export interface BudgetRowLite {
  id: string;
  cost_code_id: string;
  version: number;
  original_amount: number;
  approved_changes: number;
  current_amount: number;
  currency_code: string;
}
export interface ScheduleTaskLite {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
}
export interface AuditEventLite {
  id: string;
  action: string;
  actor_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export const getChangeOrderDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      co: ChangeOrderRow;
      contract: ContractLite | null;
      wbs: WbsItemLite | null;
      costCodes: CostCodeLite[];
      budgets: BudgetRowLite[];
      tasks: ScheduleTaskLite[];
      audit: AuditEventLite[];
    }> => {
      requireSupabaseAuth(context);
      const co = await loadCo(context, data.id);

      const [contractRes, wbsRes, ccRes, budgetsRes, tasksRes, auditRes] = await Promise.all([
        co.contract_id
          ? context.supabase
              .from("contracts")
              .select("id, contract_number, title, status, value, currency_code")
              .eq("id", co.contract_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        co.wbs_item_id
          ? context.supabase
              .from("wbs_items")
              .select("id, code, name")
              .eq("id", co.wbs_item_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        context.supabase
          .from("cost_codes")
          .select("id, code, name")
          .eq("project_id", co.project_id),
        context.supabase
          .from("budgets")
          .select(
            "id, cost_code_id, version, original_amount, approved_changes, current_amount, currency_code",
          )
          .eq("project_id", co.project_id)
          .order("version", { ascending: false }),
        co.wbs_item_id
          ? context.supabase
              .from("schedule_tasks")
              .select("id, name, status, start_date, end_date")
              .eq("wbs_item_id", co.wbs_item_id)
              .order("start_date", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        context.supabase
          .from("audit_logs")
          .select("id, action, actor_id, metadata, created_at")
          .eq("entity", "change_orders")
          .eq("entity_id", co.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      const contract = (contractRes as any).data as ContractLite | null;
      const wbs = (wbsRes as any).data as WbsItemLite | null;
      const costCodes = ((ccRes as any).data ?? []) as any[] as CostCodeLite[];
      const rawBudgets = ((budgetsRes as any).data ?? []) as any[];
      // Latest version per cost_code_id
      const seen = new Set<string>();
      const budgets: BudgetRowLite[] = [];
      for (const b of rawBudgets) {
        if (seen.has(b.cost_code_id)) continue;
        seen.add(b.cost_code_id);
        budgets.push({
          id: b.id,
          cost_code_id: b.cost_code_id,
          version: Number(b.version),
          original_amount: Number(b.original_amount ?? 0),
          approved_changes: Number(b.approved_changes ?? 0),
          current_amount: Number(b.current_amount ?? 0),
          currency_code: b.currency_code,
        });
      }
      const tasks = (((tasksRes as any).data ?? []) as any[]).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        start_date: t.start_date,
        end_date: t.end_date,
      })) as ScheduleTaskLite[];
      const audit = (((auditRes as any).data ?? []) as any[]).map((a) => ({
        id: a.id,
        action: a.action,
        actor_id: a.actor_id ?? null,
        metadata: (a.metadata ?? {}) as Record<string, any>,
        created_at: a.created_at,
      })) as AuditEventLite[];

      return { co, contract, wbs, costCodes, budgets, tasks, audit };
    },
  );

// ---------------------------------------------------------------------------
// Pickers: contracts (signed/active), wbs items, budgets (via detail is fine but
// we need list at project scope for the create dialog too)
// ---------------------------------------------------------------------------
export const listCoPickers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      contracts: ContractLite[];
      wbsItems: WbsItemLite[];
      costCodes: CostCodeLite[];
      budgets: BudgetRowLite[];
    }> => {
      requireSupabaseAuth(context);
      const [contractsRes, wbsRes, ccRes, budgetsRes] = await Promise.all([
        context.supabase
          .from("contracts")
          .select("id, contract_number, title, status, value, currency_code")
          .eq("project_id", data.project_id)
          .in("status", ["signed", "active"] as any)
          .order("contract_number", { ascending: true }),
        context.supabase
          .from("wbs_items")
          .select("id, code, name")
          .eq("project_id", data.project_id)
          .order("code", { ascending: true }),
        context.supabase
          .from("cost_codes")
          .select("id, code, name")
          .eq("project_id", data.project_id)
          .order("code", { ascending: true }),
        context.supabase
          .from("budgets")
          .select(
            "id, cost_code_id, version, original_amount, approved_changes, current_amount, currency_code",
          )
          .eq("project_id", data.project_id)
          .order("version", { ascending: false }),
      ]);
      const contracts = (((contractsRes as any).data ?? []) as any[]).map((r) => ({
        id: r.id,
        contract_number: r.contract_number,
        title: r.title,
        status: r.status,
        value: r.value == null ? null : Number(r.value),
        currency_code: r.currency_code,
      })) as ContractLite[];
      const wbsItems = ((wbsRes as any).data ?? []) as any[] as WbsItemLite[];
      const costCodes = ((ccRes as any).data ?? []) as any[] as CostCodeLite[];
      const rawBudgets = ((budgetsRes as any).data ?? []) as any[];
      const seen = new Set<string>();
      const budgets: BudgetRowLite[] = [];
      for (const b of rawBudgets) {
        if (seen.has(b.cost_code_id)) continue;
        seen.add(b.cost_code_id);
        budgets.push({
          id: b.id,
          cost_code_id: b.cost_code_id,
          version: Number(b.version),
          original_amount: Number(b.original_amount ?? 0),
          approved_changes: Number(b.approved_changes ?? 0),
          current_amount: Number(b.current_amount ?? 0),
          currency_code: b.currency_code,
        });
      }
      return { contracts, wbsItems, costCodes, budgets };
    },
  );

// silence unused import when a caller drops enum re-exports
export type __CoStatus = ChangeOrderStatus;
