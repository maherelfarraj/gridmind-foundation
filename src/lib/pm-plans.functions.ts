// P-107 — Preventive maintenance plan CRUD + "Generate now" server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  pmPlanUpsertSchema,
  type PmChecklistStep,
  type PmFrequency,
} from "@/lib/pm-plans.rules";
import { generatePmWorkOrders } from "@/lib/pm-plans.server";

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => r.data === true);
}

async function assertWriter(context: AuthContext): Promise<void> {
  if (!(await hasAnyRole(context, ["om_admin", "company_admin"]))) {
    httpError(403, "forbidden_role");
  }
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "preventive_maintenance_plans",
      p_entity_id: entityId as never,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

export interface PmPlanRow {
  id: string;
  company_id: string;
  project_id: string;
  equipment_id: string | null;
  title: string;
  description: string | null;
  frequency: PmFrequency;
  interval_days: number;
  next_due_date: string;
  last_generated_at: string | null;
  checklist: PmChecklistStep[];
  estimated_hours: number | null;
  default_assignee: string | null;
  auto_generate: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  equipment_tag?: string | null;
  assignee_name?: string | null;
}

const SELECT_COLS =
  "*, project:projects(name), equipment:equipment_registry(tag), assignee:profiles!preventive_maintenance_plans_default_assignee_fkey(full_name,email)";

function shapeRow(r: unknown): PmPlanRow {
  const row = r as PmPlanRow & {
    project?: { name: string } | null;
    equipment?: { tag: string } | null;
    assignee?: { full_name: string | null; email: string | null } | null;
  };
  return {
    ...row,
    checklist: Array.isArray(row.checklist) ? (row.checklist as PmChecklistStep[]) : [],
    project_name: row.project?.name ?? null,
    equipment_tag: row.equipment?.tag ?? null,
    assignee_name: row.assignee?.full_name ?? row.assignee?.email ?? null,
  };
}

export const listPmPlans = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("preventive_maintenance_plans")
      .select(SELECT_COLS)
      .eq("company_id", companyId)
      .order("next_due_date", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(shapeRow);
  });

export const upsertPmPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => pmPlanUpsertSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);

    const payload = {
      company_id: companyId,
      project_id: data.project_id,
      equipment_id: data.equipment_id ?? null,
      title: data.title,
      description: data.description ?? null,
      frequency: data.frequency,
      interval_days: data.interval_days,
      next_due_date: data.next_due_date,
      checklist: data.checklist as never,
      estimated_hours: data.estimated_hours ?? null,
      default_assignee: data.default_assignee ?? null,
      auto_generate: data.auto_generate,
      active: data.active,
    };

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("preventive_maintenance_plans")
        .update(payload as never)
        .eq("id", data.id)
        .select(SELECT_COLS)
        .single();
      if (error) throw error;
      const row = shapeRow(updated);
      await audit(context, "pm_plan.update", row.id, { title: row.title });
      return row;
    }
    const { data: inserted, error } = await context.supabase
      .from("preventive_maintenance_plans")
      .insert({ ...payload, created_by: context.user!.id } as never)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(inserted);
    await audit(context, "pm_plan.create", row.id, { title: row.title });
    return row;
  });

export const togglePmPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        active: z.boolean().optional(),
        auto_generate: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const patch: Record<string, unknown> = {};
    if (typeof data.active === "boolean") patch.active = data.active;
    if (typeof data.auto_generate === "boolean") patch.auto_generate = data.auto_generate;
    const { data: updated, error } = await context.supabase
      .from("preventive_maintenance_plans")
      .update(patch as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "pm_plan.toggle", row.id, patch);
    return row;
  });

export const deletePmPlan = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const { error } = await context.supabase
      .from("preventive_maintenance_plans")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    await audit(context, "pm_plan.delete", data.id, {});
    return { ok: true };
  });

export const generatePmNow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ plan_id: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const summary = await generatePmWorkOrders(context.supabase, {
      companyId,
      planId: data.plan_id,
    });
    await audit(context, "pm.generate", null, summary as unknown as Record<string, unknown>);
    return summary;
  });
