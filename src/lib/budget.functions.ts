// P-075 — Budgets + cost codes server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  buildPoSnapshotEntry,
  costCodeCreateSchema,
  costCodeDeleteSchema,
  costCodeUpdateSchema,
  budgetUpsertSchema,
  importPoCommitmentsSchema,
  sumSnapshot,
  type PoCommitmentEntry,
} from "@/lib/budget.rules";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export interface CostCodeRow {
  id: string;
  company_id: string;
  project_id: string;
  code: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  wbs_item_id: string | null;
  wbs_code: string | null;
  wbs_name: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRow {
  id: string;
  company_id: string;
  project_id: string;
  cost_code_id: string;
  wbs_item_id: string | null;
  version: number;
  original_amount: number;
  approved_changes: number;
  current_amount: number;
  committed_amount: number;
  actual_amount: number;
  po_commitments: PoCommitmentEntry[];
  currency_code: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EligiblePoRow {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string | null;
  total_amount: number;
  currency_code: string;
  status: string;
  issued_at: string | null;
  required_by_date: string | null;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const COST_CODE_ROLES = [
  "finance_admin",
  "project_admin",
  "company_admin",
] as const;
const BUDGET_ROLES = ["finance_admin", "company_admin"] as const;

// POs that represent real commitments (post-approval).
const COMMITTED_PO_STATUSES: Array<
  "approved" | "issued" | "partially_received" | "received"
> = ["approved", "issued", "partially_received", "received"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) =>
      context.supabase.rpc("has_company_role", { p_role: r as any }),
    ),
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

function toCostCodeRow(r: any): CostCodeRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    parent_id: r.parent_id ?? null,
    wbs_item_id: r.wbs_item_id ?? null,
    wbs_code: r.wbs?.code ?? null,
    wbs_name: r.wbs?.name ?? null,
    is_active: !!r.is_active,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toBudgetRow(r: any): BudgetRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    cost_code_id: r.cost_code_id,
    wbs_item_id: r.wbs_item_id ?? null,
    version: r.version ?? 1,
    original_amount: Number(r.original_amount ?? 0),
    approved_changes: Number(r.approved_changes ?? 0),
    current_amount: Number(r.current_amount ?? 0),
    committed_amount: Number(r.committed_amount ?? 0),
    actual_amount: Number(r.actual_amount ?? 0),
    po_commitments: Array.isArray(r.po_commitments)
      ? (r.po_commitments as PoCommitmentEntry[])
      : [],
    currency_code: r.currency_code,
    notes: r.notes ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getBudgetAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ canWriteCostCodes: boolean; canWriteBudgets: boolean }> => {
      requireSupabaseAuth(context);
      const [canCostCodes, canBudgets] = await Promise.all([
        hasAnyRole(context, COST_CODE_ROLES),
        hasAnyRole(context, BUDGET_ROLES),
      ]);
      return {
        canWriteCostCodes: canCostCodes,
        canWriteBudgets: canBudgets,
      };
    },
  );

// ---------------------------------------------------------------------------
// Cost codes
// ---------------------------------------------------------------------------
const listInput = z.object({ projectId: z.string().uuid() });

export const listCostCodes = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<CostCodeRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("cost_codes")
      .select("*, wbs:wbs_item_id(code, name)")
      .eq("project_id", data.projectId)
      .order("code", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toCostCodeRow);
  });

export const createCostCode = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costCodeCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<CostCodeRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, COST_CODE_ROLES)))
      httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    const insert = {
      company_id: project.company_id,
      project_id: project.id,
      code: data.code.trim(),
      name: data.name.trim(),
      description: data.description ?? null,
      parent_id: data.parent_id ?? null,
      wbs_item_id: data.wbs_item_id ?? null,
      is_active: data.is_active ?? true,
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("cost_codes")
      .insert(insert as any)
      .select("*, wbs:wbs_item_id(code, name)")
      .single();
    if (error) {
      if ((error as any).code === "23505")
        httpError(409, "duplicate_code", `Code ${data.code} already exists`);
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toCostCodeRow(inserted);
    await audit(context, "cost_code.create", "cost_codes", row.id, {
      project_id: project.id,
      code: row.code,
      name: row.name,
    });
    return row;
  });

export const updateCostCode = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costCodeUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<CostCodeRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, COST_CODE_ROLES)))
      httpError(403, "forbidden");

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      patch[k] = typeof v === "string" ? v.trim() : v;
    }

    const { data: updated, error } = await context.supabase
      .from("cost_codes")
      .update(patch as any)
      .eq("id", data.id)
      .select("*, wbs:wbs_item_id(code, name)")
      .single();
    if (error) {
      if ((error as any).code === "23505") httpError(409, "duplicate_code");
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toCostCodeRow(updated);
    await audit(context, "cost_code.update", "cost_codes", row.id, {
      project_id: row.project_id,
      changes: Object.keys(patch),
    });
    return row;
  });

export const deleteCostCode = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costCodeDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, COST_CODE_ROLES)))
      httpError(403, "forbidden");

    // Guard: refuse when a budget row references it (financial retention).
    const { count } = await context.supabase
      .from("budgets")
      .select("id", { count: "exact", head: true })
      .eq("cost_code_id", data.id);
    if ((count ?? 0) > 0)
      httpError(
        409,
        "budget_exists",
        "Cost code has budget rows — retire it (uncheck Active) instead",
      );

    const { data: existing } = await context.supabase
      .from("cost_codes")
      .select("project_id, code, name")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await context.supabase
      .from("cost_codes")
      .delete()
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "cost_code.delete", "cost_codes", data.id, {
      project_id: (existing as any)?.project_id,
      code: (existing as any)?.code,
      name: (existing as any)?.name,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export const listBudgets = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<BudgetRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("budgets")
      .select("*")
      .eq("project_id", data.projectId)
      .order("version", { ascending: false });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toBudgetRow);
  });

/**
 * Upsert the latest-version budget row for a cost code.
 * - If none exists → insert version 1.
 * - If exists and original_amount/currency changes → insert a new version (supersede).
 * - Otherwise → update notes/wbs on the latest row in place.
 */
export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => budgetUpsertSchema.parse(input))
  .handler(async ({ data, context }): Promise<BudgetRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, BUDGET_ROLES)))
      httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    const { data: latest, error: latestErr } = await context.supabase
      .from("budgets")
      .select("*")
      .eq("project_id", project.id)
      .eq("cost_code_id", data.cost_code_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw latestErr;

    // Case A — first version.
    if (!latest) {
      const insert = {
        company_id: project.company_id,
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        wbs_item_id: data.wbs_item_id ?? null,
        version: 1,
        original_amount: data.original_amount,
        currency_code: data.currency_code,
        notes: data.notes ?? null,
        created_by: (context as any).user.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("budgets")
        .insert(insert as any)
        .select("*")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      const row = toBudgetRow(inserted);
      await audit(context, "budget.create", "budgets", row.id, {
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        version: row.version,
        original_amount: row.original_amount,
        currency_code: row.currency_code,
      });
      return row;
    }

    const financialChange =
      Number(latest.original_amount) !== data.original_amount ||
      latest.currency_code !== data.currency_code;

    // Case B — supersede (new version, preserves audit history).
    if (financialChange) {
      const insert = {
        company_id: project.company_id,
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        wbs_item_id: data.wbs_item_id ?? latest.wbs_item_id ?? null,
        version: (latest.version ?? 1) + 1,
        original_amount: data.original_amount,
        currency_code: data.currency_code,
        // Carry forward committed and PO snapshot (still real commitments).
        committed_amount: latest.committed_amount ?? 0,
        po_commitments: latest.po_commitments ?? [],
        actual_amount: latest.actual_amount ?? 0,
        notes: data.notes ?? null,
        created_by: (context as any).user.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("budgets")
        .insert(insert as any)
        .select("*")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      const row = toBudgetRow(inserted);
      await audit(context, "budget.supersede", "budgets", row.id, {
        project_id: project.id,
        cost_code_id: data.cost_code_id,
        from_version: latest.version,
        to_version: row.version,
        original_amount: row.original_amount,
      });
      return row;
    }

    // Case C — light edits on the latest row (notes/wbs).
    const patch: Record<string, unknown> = {
      notes: data.notes ?? null,
      wbs_item_id: data.wbs_item_id ?? null,
    };
    const { data: updated, error } = await context.supabase
      .from("budgets")
      .update(patch as any)
      .eq("id", latest.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toBudgetRow(updated);
    await audit(context, "budget.update", "budgets", row.id, {
      project_id: project.id,
      cost_code_id: data.cost_code_id,
      changes: Object.keys(patch),
    });
    return row;
  });

// ---------------------------------------------------------------------------
// POs eligible for commitment import
// ---------------------------------------------------------------------------
export const listProjectPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<EligiblePoRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("purchase_orders")
      .select(
        "id, po_number, vendor_id, total_amount, currency_code, status, issued_at, required_by_date, vendor:vendor_id(name)",
      )
      .eq("project_id", data.projectId)
      .in("status", COMMITTED_PO_STATUSES)
      .order("po_number", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      po_number: r.po_number,
      vendor_id: r.vendor_id,
      vendor_name: r.vendor?.name ?? null,
      total_amount: Number(r.total_amount ?? 0),
      currency_code: r.currency_code,
      status: r.status,
      issued_at: r.issued_at ?? null,
      required_by_date: r.required_by_date ?? null,
    }));
  });

// ---------------------------------------------------------------------------
// Import PO commitments
// ---------------------------------------------------------------------------
export const importPoCommitments = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => importPoCommitmentsSchema.parse(input))
  .handler(
    async ({ data, context }): Promise<{ updated: number; skipped: number }> => {
      requireSupabaseAuth(context);
      if (!(await hasAnyRole(context, BUDGET_ROLES)))
        httpError(403, "forbidden");
      const project = await loadProject(context, data.projectId);

      // Fetch the eligible POs so the server, not the client, owns the amount.
      const { data: poRows, error: poErr } = await context.supabase
        .from("purchase_orders")
        .select(
          "id, po_number, total_amount, currency_code, status, vendor:vendor_id(name)",
        )
        .eq("project_id", project.id)
        .in("status", COMMITTED_PO_STATUSES);
      if (poErr) throw poErr;
      const poById = new Map<string, any>(
        ((poRows ?? []) as any[]).map((p) => [p.id, p]),
      );

      // Group assignments per cost code (null = unassigned; skipped).
      const perCostCode = new Map<string, PoCommitmentEntry[]>();
      let skipped = 0;
      for (const a of data.assignments) {
        if (!a.cost_code_id) {
          skipped += 1;
          continue;
        }
        const po = poById.get(a.po_id);
        if (!po) {
          skipped += 1;
          continue;
        }
        const entry = buildPoSnapshotEntry({
          id: po.id,
          po_number: po.po_number,
          vendor_name: po.vendor?.name ?? null,
          total_amount: po.total_amount,
          currency_code: po.currency_code,
        });
        const list = perCostCode.get(a.cost_code_id) ?? [];
        list.push(entry);
        perCostCode.set(a.cost_code_id, list);
      }

      // Load latest budget rows for the affected cost codes; create if missing.
      const costCodeIds = [...perCostCode.keys()];
      const { data: existing, error: exErr } = await context.supabase
        .from("budgets")
        .select("*")
        .eq("project_id", project.id)
        .in("cost_code_id", costCodeIds.length ? costCodeIds : ["00000000-0000-0000-0000-000000000000"]);
      if (exErr) throw exErr;

      const latestByCostCode = new Map<string, any>();
      for (const b of (existing ?? []) as any[]) {
        const prev = latestByCostCode.get(b.cost_code_id);
        if (!prev || (b.version ?? 1) > (prev.version ?? 1)) {
          latestByCostCode.set(b.cost_code_id, b);
        }
      }

      let updated = 0;
      for (const [costCodeId, entries] of perCostCode) {
        const committed = sumSnapshot(entries);
        const currency = entries[0]?.currency_code ?? "USD";
        const latest = latestByCostCode.get(costCodeId);

        if (!latest) {
          // Auto-create a version-1 row with zero original so commitments can land.
          const { data: inserted, error } = await context.supabase
            .from("budgets")
            .insert({
              company_id: project.company_id,
              project_id: project.id,
              cost_code_id: costCodeId,
              version: 1,
              original_amount: 0,
              committed_amount: committed,
              po_commitments: entries as any,
              currency_code: currency,
              created_by: (context as any).user.id,
            } as any)
            .select("*")
            .single();
          if (error) {
            if ((error as any).code === "42501") httpError(403, "forbidden");
            throw error;
          }
          await audit(
            context,
            "budget.import_commitments",
            "budgets",
            (inserted as any).id,
            {
              project_id: project.id,
              cost_code_id: costCodeId,
              po_ids: entries.map((e) => e.po_id),
              total: committed,
            },
          );
          updated += 1;
          continue;
        }

        const { error } = await context.supabase
          .from("budgets")
          .update({
            committed_amount: committed,
            po_commitments: entries as any,
          } as any)
          .eq("id", latest.id);
        if (error) {
          if ((error as any).code === "42501") httpError(403, "forbidden");
          throw error;
        }
        await audit(
          context,
          "budget.import_commitments",
          "budgets",
          latest.id,
          {
            project_id: project.id,
            cost_code_id: costCodeId,
            po_ids: entries.map((e) => e.po_id),
            total: committed,
          },
        );
        updated += 1;
      }

      return { updated, skipped };
    },
  );
