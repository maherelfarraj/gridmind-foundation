// P-076 — EVM server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  captureEvmSnapshotSchema,
  computeEvm,
  listEvmSnapshotsSchema,
  type EvmComputation,
  type EvmTaskInput,
} from "@/lib/evm.rules";

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------
export interface EvmSnapshotRow {
  id: string;
  company_id: string;
  project_id: string;
  snapshot_date: string;
  planned_value: number;
  earned_value: number;
  actual_cost: number;
  budget_at_completion: number;
  spi: number | null;
  cpi: number | null;
  estimate_at_completion: number | null;
  currency_code: string;
  source: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const CAPTURE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function loadProject(context: AuthContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string };
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toSnapshotRow(r: any): EvmSnapshotRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    snapshot_date: r.snapshot_date,
    planned_value: Number(r.planned_value ?? 0),
    earned_value: Number(r.earned_value ?? 0),
    actual_cost: Number(r.actual_cost ?? 0),
    budget_at_completion: Number(r.budget_at_completion ?? 0),
    spi: r.spi == null ? null : Number(r.spi),
    cpi: r.cpi == null ? null : Number(r.cpi),
    estimate_at_completion:
      r.estimate_at_completion == null ? null : Number(r.estimate_at_completion),
    currency_code: r.currency_code,
    source: r.source,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getEvmAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canCapture: boolean }> => {
    requireSupabaseAuth(context);
    return { canCapture: await hasAnyRole(context, CAPTURE_ROLES) };
  });

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export const listEvmSnapshots = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listEvmSnapshotsSchema.parse(input))
  .handler(async ({ data, context }): Promise<EvmSnapshotRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("evm_snapshots")
      .select("*")
      .eq("project_id", data.projectId)
      .order("snapshot_date", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toSnapshotRow);
  });

// ---------------------------------------------------------------------------
// Preview computation (no insert) — used by capture dialog
// ---------------------------------------------------------------------------
async function computeForDate(
  context: AuthContext,
  projectId: string,
  snapshotDate: string,
  includeAccruals: boolean,
): Promise<{
  computation: EvmComputation;
  currency: string;
}> {
  // Budgets (latest version per cost code) → BAC + AC + committed
  const { data: budgets, error: budgetsErr } = await context.supabase
    .from("budgets")
    .select("cost_code_id, version, current_amount, actual_amount, committed_amount, currency_code")
    .eq("project_id", projectId)
    .order("version", { ascending: false });
  if (budgetsErr) throw budgetsErr;

  const latestByCode = new Map<string, any>();
  for (const b of budgets ?? []) {
    if (!latestByCode.has(b.cost_code_id)) latestByCode.set(b.cost_code_id, b);
  }
  let bac = 0;
  let actual = 0;
  let committed = 0;
  let currency = "USD";
  for (const b of latestByCode.values()) {
    bac += Number(b.current_amount ?? 0);
    actual += Number(b.actual_amount ?? 0);
    committed += Number(b.committed_amount ?? 0);
    currency = b.currency_code;
  }

  // Schedule tasks with WBS budget
  const { data: tasks, error: tasksErr } = await context.supabase
    .from("schedule_tasks")
    .select("id, start_date, end_date, progress_pct, wbs:wbs_item_id(budgeted_amount)")
    .eq("project_id", projectId);
  if (tasksErr) throw tasksErr;

  const taskInputs: EvmTaskInput[] = ((tasks ?? []) as any[]).map((t) => ({
    id: t.id,
    start_date: t.start_date,
    end_date: t.end_date,
    progress_pct: Number(t.progress_pct ?? 0),
    budgeted_amount: t.wbs?.budgeted_amount == null ? null : Number(t.wbs.budgeted_amount),
  }));

  // AC = actuals + optional uninvoiced accrual (committed - actual).
  const accrual = includeAccruals ? Math.max(0, committed - actual) : 0;
  const actualCost = actual + accrual;

  const computation = computeEvm({
    bac,
    tasks: taskInputs,
    snapshotDate,
    actualCost,
  });
  return { computation, currency };
}

export const previewEvmSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => captureEvmSnapshotSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ computation: EvmComputation; currency: string }> => {
      requireSupabaseAuth(context);
      await loadProject(context, data.projectId);
      return computeForDate(
        context,
        data.projectId,
        data.snapshotDate,
        data.includeAccruals ?? false,
      );
    },
  );

// ---------------------------------------------------------------------------
// Capture (insert-only; immutable)
// ---------------------------------------------------------------------------
export const captureEvmSnapshot = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => captureEvmSnapshotSchema.parse(input))
  .handler(async ({ data, context }): Promise<EvmSnapshotRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, CAPTURE_ROLES))) httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    // Reject same-date re-capture up front (friendly message).
    const { data: existing } = await context.supabase
      .from("evm_snapshots")
      .select("id")
      .eq("project_id", project.id)
      .eq("snapshot_date", data.snapshotDate)
      .maybeSingle();
    if (existing)
      httpError(
        409,
        "snapshot_exists",
        `A snapshot for ${data.snapshotDate} already exists — snapshots are immutable. Capture a later date.`,
      );

    const { computation, currency } = await computeForDate(
      context,
      project.id,
      data.snapshotDate,
      data.includeAccruals ?? false,
    );

    const insert = {
      company_id: project.company_id,
      project_id: project.id,
      snapshot_date: data.snapshotDate,
      planned_value: computation.pv,
      earned_value: computation.ev,
      actual_cost: computation.ac,
      budget_at_completion: computation.bac,
      estimate_at_completion: computation.eac,
      currency_code: currency,
      source: "manual",
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("evm_snapshots")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "23505")
        httpError(409, "snapshot_exists", "Snapshot for this date exists");
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }

    const row = toSnapshotRow(inserted);
    await audit(context, "evm.capture", "evm_snapshots", row.id, {
      project_id: project.id,
      snapshot_date: row.snapshot_date,
      pv: row.planned_value,
      ev: row.earned_value,
      ac: row.actual_cost,
      spi: row.spi,
      cpi: row.cpi,
      eac: row.estimate_at_completion,
      include_accruals: data.includeAccruals ?? false,
    });
    return row;
  });

// Re-export input types for callers.
export type { EvmComputation };
export const _debug = { z };
