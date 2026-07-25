// P-107 — Server-only PM auto-generation engine (idempotent per plan+due date).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { addDaysISO } from "@/lib/pm-plans.rules";
import { generateWoNumber } from "@/lib/work-orders.server";

export interface PmGenerateSummary {
  generated: number;
  skipped: number;
  plan_ids: string[];
}

interface PmPlanRow {
  id: string;
  company_id: string;
  project_id: string;
  equipment_id: string | null;
  title: string;
  description: string | null;
  interval_days: number;
  next_due_date: string;
  checklist: unknown;
  estimated_hours: number | null;
  default_assignee: string | null;
}

function renderDescription(plan: PmPlanRow): string {
  const parts: string[] = [];
  if (plan.description) parts.push(plan.description.trim());
  const cl = Array.isArray(plan.checklist)
    ? (plan.checklist as Array<{ step?: string; required?: boolean }>)
    : [];
  if (cl.length > 0) {
    parts.push("Checklist:");
    for (const it of cl) {
      const req = it.required === false ? "[ ]" : "[*]";
      parts.push(`${req} ${(it.step ?? "").trim()}`);
    }
  }
  return parts.join("\n");
}

/**
 * Generate preventive WOs for any plan whose next_due_date is due, honoring
 * an idempotency guard: a single (plan_id, due_date) window may not produce
 * duplicate WOs. Uses the generic work_orders columns (source='pm_plan',
 * scheduled_date=<plan.next_due_date>) as the idempotency key.
 */
export async function generatePmWorkOrders(
  client: SupabaseClient<Database>,
  opts: { companyId?: string; planId?: string } = {},
): Promise<PmGenerateSummary> {
  const today = new Date().toISOString().slice(0, 10);
  let q = client
    .from("preventive_maintenance_plans")
    .select(
      "id, company_id, project_id, equipment_id, title, description, interval_days, next_due_date, checklist, estimated_hours, default_assignee",
    )
    .eq("active", true)
    .eq("auto_generate", true)
    .lte("next_due_date", today);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.planId) q = q.eq("id", opts.planId);
  const { data: plansRaw, error } = await q;
  if (error) throw error;
  const plans = (plansRaw ?? []) as PmPlanRow[];

  let generated = 0;
  let skipped = 0;
  const touched: string[] = [];

  for (const plan of plans) {
    // Idempotency guard: has an open WO already been created for this
    // plan+due date? We tag it via description marker + scheduled_date.
    const marker = `[pm_plan:${plan.id}:${plan.next_due_date}]`;
    const { data: existing, error: eExist } = await client
      .from("work_orders")
      .select("id")
      .eq("company_id", plan.company_id)
      .eq("source", "pm_plan")
      .eq("scheduled_date", plan.next_due_date)
      .like("description", `%${marker}%`)
      .limit(1);
    if (eExist) throw eExist;
    if (existing && existing.length > 0) {
      skipped += 1;
      touched.push(plan.id);
      continue;
    }

    const woNumber = await generateWoNumber(client, plan.company_id);
    const description = `${marker}\n${renderDescription(plan)}`.trim();
    const payload = {
      company_id: plan.company_id,
      project_id: plan.project_id,
      equipment_id: plan.equipment_id,
      wo_number: woNumber,
      title: plan.title,
      description,
      type: "preventive" as const,
      priority: "medium" as const,
      status: plan.default_assignee ? ("assigned" as const) : ("open" as const),
      assigned_to: plan.default_assignee,
      scheduled_date: plan.next_due_date,
      due_date: plan.next_due_date,
      source: "pm_plan",
    };
    const { error: eIns } = await client.from("work_orders").insert(payload as never);
    if (eIns) {
      // If unique conflict on wo_number, retry once with a fresh number.
      if ((eIns as { code?: string }).code === "23505") {
        const retryNumber = await generateWoNumber(client, plan.company_id);
        const { error: e2 } = await client
          .from("work_orders")
          .insert({ ...payload, wo_number: retryNumber } as never);
        if (e2) throw e2;
      } else {
        throw eIns;
      }
    }

    // Advance next_due_date and record last_generated_at.
    const nextDue = addDaysISO(plan.next_due_date, plan.interval_days);
    const { error: eUpd } = await client
      .from("preventive_maintenance_plans")
      .update({
        next_due_date: nextDue,
        last_generated_at: new Date().toISOString(),
      } as never)
      .eq("id", plan.id);
    if (eUpd) throw eUpd;

    generated += 1;
    touched.push(plan.id);
  }

  return { generated, skipped, plan_ids: touched };
}
