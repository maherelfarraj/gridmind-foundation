// GC-14 — Contingency & risk exposure I/O helpers (kept out of *.functions.ts).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  aggregateExposure,
  assessAdequacy,
  computePoolState,
  drawdownCurve,
  rollupPools,
  type AdequacyState,
  type ExposureState,
  type MovementCreateInput,
  type MovementDecisionInput,
  type MovementInput,
  type PoolCreateInput,
  type PoolInput,
  type PoolState,
  type PoolUpdateInput,
  type RiskQuantInput,
  type RiskQuantWriteInput,
} from "@/lib/contingency.rules";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";

export const CONTINGENCY_WRITE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;
export const CONTINGENCY_APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

export interface ContingencyAccess {
  canWrite: boolean;
  canApprove: boolean;
}

export async function resolveContingencyAccess(ctx: AuthContext): Promise<ContingencyAccess> {
  const [canWrite, canApprove] = await Promise.all([
    hasAnyRole(ctx, CONTINGENCY_WRITE_ROLES),
    hasAnyRole(ctx, CONTINGENCY_APPROVE_ROLES),
  ]);
  return { canWrite, canApprove };
}

export async function requireContingencyWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CONTINGENCY_WRITE_ROLES))) {
    httpError(403, "forbidden", "Project controls or finance role required.");
  }
}

export async function requireContingencyApprove(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, CONTINGENCY_APPROVE_ROLES))) {
    httpError(403, "forbidden", "Finance or company admin role required to decide movements.");
  }
}

async function projectCompany(ctx: AuthContext, projectId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found", "Project not found in your company.");
  return (data as { company_id: string }).company_id;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface MovementRow extends MovementInput {
  reason: string;
  decision_note: string | null;
  decided_at: string | null;
  counterparty_pool_id: string | null;
  created_at: string;
}

export interface ContingencyWorkspace {
  project_id: string;
  currency_code: string;
  pools: PoolState[];
  totals: ReturnType<typeof rollupPools>;
  movements: MovementRow[];
  pending_count: number;
  curve: { period: string; net: number; cumulative: number }[];
  quantifications: (RiskQuantInput & { risk_title: string; expected_value: number })[];
  exposure: ExposureState;
  adequacy: AdequacyState;
  access: ContingencyAccess;
}

export async function loadContingencyWorkspace(
  ctx: AuthContext,
  projectId: string,
): Promise<ContingencyWorkspace> {
  const [poolsRes, movesRes, quantRes, access] = await Promise.all([
    ctx.supabase
      .from("contingency_pools")
      .select("*")
      .eq("project_id", projectId)
      .order("name", { ascending: true }),
    ctx.supabase
      .from("contingency_movements")
      .select("*")
      .eq("project_id", projectId)
      .order("effective_date", { ascending: false })
      .limit(1000),
    ctx.supabase
      .from("risk_quantifications")
      .select("*, risks(title, status)")
      .eq("project_id", projectId)
      .limit(1000),
    resolveContingencyAccess(ctx),
  ]);
  if (poolsRes.error) throw poolsRes.error;
  if (movesRes.error) throw movesRes.error;
  if (quantRes.error) throw quantRes.error;

  const pools = (poolsRes.data ?? []) as unknown as PoolInput[];
  const movements = ((movesRes.data ?? []) as unknown as MovementRow[]).map((m) => ({
    ...m,
    amount: Number(m.amount),
  }));
  const quantifications = (
    (quantRes.data ?? []) as unknown as (RiskQuantInput & {
      risks: { title: string; status: RiskQuantInput["risk_status"] } | null;
    })[]
  ).map((q) => {
    const normalized: RiskQuantInput = {
      risk_id: q.risk_id,
      currency_code: q.currency_code,
      cost_low: Number(q.cost_low),
      cost_most_likely: Number(q.cost_most_likely),
      cost_high: Number(q.cost_high),
      probability_pct: Number(q.probability_pct),
      schedule_days_impact: Number(q.schedule_days_impact),
      distribution: q.distribution,
      ...(q.risks?.status ? { risk_status: q.risks.status } : {}),
    };
    return {
      ...normalized,
      risk_title: q.risks?.title ?? "—",
      expected_value: 0,
    };
  });

  const states = pools.map((p) =>
    computePoolState({ ...p, original_amount: Number(p.original_amount) }, movements),
  );
  const totals = rollupPools(states);
  const exposure = aggregateExposure(quantifications);

  return {
    project_id: projectId,
    currency_code: pools[0]?.currency_code ?? "USD",
    pools: states,
    totals,
    movements,
    pending_count: movements.filter((m) => m.status === "pending").length,
    curve: drawdownCurve(movements),
    quantifications,
    exposure,
    adequacy: assessAdequacy(totals.balance, exposure),
    access,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createPool(ctx: AuthContext, input: PoolCreateInput): Promise<string> {
  await requireContingencyWrite(ctx);
  const companyId = await projectCompany(ctx, input.project_id);
  const { data, error } = await ctx.supabase
    .from("contingency_pools")
    .insert({
      company_id: companyId,
      project_id: input.project_id,
      name: input.name,
      basis: input.basis ?? null,
      cost_code_id: input.cost_code_id ?? null,
      currency_code: input.currency_code,
      original_amount: input.original_amount,
      status: input.status,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await audit(ctx, "contingency.pool_create", "contingency_pools", id, {
    project_id: input.project_id,
    original_amount: input.original_amount,
  });
  return id;
}

export async function updatePool(ctx: AuthContext, input: PoolUpdateInput): Promise<void> {
  await requireContingencyWrite(ctx);
  const { id, ...patch } = input;
  const { error } = await ctx.supabase
    .from("contingency_pools")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
  await audit(ctx, "contingency.pool_update", "contingency_pools", id, patch);
}

export async function createMovement(
  ctx: AuthContext,
  input: MovementCreateInput,
): Promise<string> {
  await requireContingencyWrite(ctx);
  const companyId = await projectCompany(ctx, input.project_id);
  const { data, error } = await ctx.supabase
    .from("contingency_movements")
    .insert({
      company_id: companyId,
      project_id: input.project_id,
      pool_id: input.pool_id,
      kind: input.kind,
      amount: input.amount,
      currency_code: input.currency_code,
      effective_date: input.effective_date,
      reason: input.reason,
      risk_id: input.risk_id ?? null,
      change_order_id: input.change_order_id ?? null,
      counterparty_pool_id: input.counterparty_pool_id ?? null,
      status: "pending",
      requested_by: ctx.user?.id ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await audit(ctx, "contingency.movement_request", "contingency_movements", id, {
    pool_id: input.pool_id,
    kind: input.kind,
    amount: input.amount,
  });
  return id;
}

export async function decideMovement(
  ctx: AuthContext,
  input: MovementDecisionInput,
): Promise<void> {
  await requireContingencyApprove(ctx);
  const { data: current, error: readErr } = await ctx.supabase
    .from("contingency_movements")
    .select("id, status, pool_id, kind, amount")
    .eq("id", input.id)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!current) httpError(404, "movement_not_found", "Movement not found in your company.");
  if ((current as { status: string }).status === "approved") {
    httpError(409, "movement_immutable", "Approved movements cannot be changed.");
  }

  const { error } = await ctx.supabase
    .from("contingency_movements")
    .update({
      status: input.status,
      decision_note: input.decision_note ?? null,
      decided_by: ctx.user?.id ?? null,
      decided_at: new Date().toISOString(),
    } as never)
    .eq("id", input.id);
  if (error) throw error;
  await audit(ctx, "contingency.movement_decide", "contingency_movements", input.id, {
    to: input.status,
    ...(input.decision_note ? { note: input.decision_note } : {}),
  });
}

export async function deleteMovement(ctx: AuthContext, id: string): Promise<void> {
  await requireContingencyApprove(ctx);
  const { error } = await ctx.supabase.from("contingency_movements").delete().eq("id", id);
  if (error) throw error;
  await audit(ctx, "contingency.movement_delete", "contingency_movements", id, {});
}

export async function upsertRiskQuantification(
  ctx: AuthContext,
  input: RiskQuantWriteInput,
): Promise<void> {
  await requireContingencyWrite(ctx);
  const companyId = await projectCompany(ctx, input.project_id);
  const { error } = await ctx.supabase.from("risk_quantifications").upsert(
    {
      company_id: companyId,
      project_id: input.project_id,
      risk_id: input.risk_id,
      currency_code: input.currency_code,
      cost_low: input.cost_low,
      cost_most_likely: input.cost_most_likely,
      cost_high: input.cost_high,
      probability_pct: input.probability_pct,
      schedule_days_impact: input.schedule_days_impact,
      distribution: input.distribution,
      notes: input.notes ?? null,
      created_by: ctx.user?.id ?? null,
    } as never,
    { onConflict: "risk_id" },
  );
  if (error) throw error;
  await audit(ctx, "contingency.risk_quantify", "risk_quantifications", input.risk_id, {
    probability_pct: input.probability_pct,
    cost_most_likely: input.cost_most_likely,
  });
}
