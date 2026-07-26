// POL-5 — Project overview KPI aggregation (real tables only, RLS-scoped).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const input = z.object({ project_id: z.string().uuid() });

export type ProjectOverviewKpis = {
  capacity_mw: number | null;
  capacity_mwh: number | null;
  target_cod: string | null;
  days_to_cod: number | null;
  current_gate: { name: string; phase: string; status: string; readiness_pct: number } | null;
  budget: {
    currency_code: string;
    bac: number;
    committed: number;
    actual: number;
    variance: number;
    lines: number;
  } | null;
  open_rfis: number;
  open_risks: number;
  top_risk_score: number | null;
  next_milestone: { name: string; date: string | null; kind: "task" | "gate" } | null;
};

const OPEN_RFI_STATUSES = ["open", "draft", "routed", "in_review", "answered"];

export const getProjectOverviewKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<ProjectOverviewKpis | null> => {
    requireSupabaseAuth(context);

    const { data: proj, error } = await context.supabase
      .from("projects")
      .select("id, phase, capacity_mw, capacity_mwh, target_cod")
      .eq("id", data.project_id)
      .maybeSingle();
    if (error) throw error;
    if (!proj) return null;

    const [gatesRes, budgetRes, risksRes, rfisRes, taskRes] = await Promise.all([
      context.supabase
        .from("project_phase_gates")
        .select("id, name, phase, status, sort_order, checklist")
        .eq("project_id", proj.id)
        .order("sort_order", { ascending: true }),
      context.supabase
        .from("budgets")
        .select("current_amount, committed_amount, actual_amount, currency_code")
        .eq("project_id", proj.id),
      context.supabase
        .from("risks")
        .select("score, status")
        .eq("project_id", proj.id)
        .in("status", ["open", "mitigating"]),
      context.supabase
        .from("rfis")
        .select("id, status")
        .eq("project_id", proj.id)
        .in("status", OPEN_RFI_STATUSES),
      context.supabase
        .from("schedule_tasks")
        .select("name, end_date, is_milestone, status")
        .eq("project_id", proj.id)
        .eq("is_milestone", true)
        .neq("status", "complete")
        .order("end_date", { ascending: true })
        .limit(1),
    ]);
    if (gatesRes.error) throw gatesRes.error;
    if (budgetRes.error) throw budgetRes.error;

    // Current gate + readiness from checklist completion.
    const gates = (gatesRes.data ?? []) as any[];
    const active =
      gates.find((g) => g.status === "open" || g.status === "in_review") ??
      gates.find((g) => g.phase === proj.phase) ??
      null;
    let currentGate: ProjectOverviewKpis["current_gate"] = null;
    if (active) {
      const items: any[] = Array.isArray(active.checklist) ? active.checklist : [];
      const done = items.filter((i) => !!i?.done).length;
      currentGate = {
        name: active.name,
        phase: active.phase,
        status: active.status,
        readiness_pct: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
      };
    }

    // Budget rollup.
    const budgetRows = (budgetRes.data ?? []) as Array<{
      current_amount: number | string | null;
      committed_amount: number | string | null;
      actual_amount: number | string | null;
      currency_code: string;
    }>;
    const num = (v: number | string | null) => (v == null ? 0 : Number(v));
    const budget =
      budgetRows.length === 0
        ? null
        : {
            currency_code: budgetRows[0].currency_code,
            bac: budgetRows.reduce((s, r) => s + num(r.current_amount), 0),
            committed: budgetRows.reduce((s, r) => s + num(r.committed_amount), 0),
            actual: budgetRows.reduce((s, r) => s + num(r.actual_amount), 0),
            variance: 0,
            lines: budgetRows.length,
          };
    if (budget) budget.variance = budget.bac - budget.committed - budget.actual;

    // COD countdown.
    let daysToCod: number | null = null;
    if (proj.target_cod) {
      const target = new Date(`${proj.target_cod}T00:00:00Z`).getTime();
      const today = new Date();
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      daysToCod = Math.round((target - todayUtc) / 86_400_000);
    }

    const risks = (risksRes.data ?? []) as Array<{ score: number | null }>;
    const nextTask = (taskRes.data ?? [])[0] as
      | { name: string; end_date: string | null }
      | undefined;
    const nextGate = gates.find((g) => g.status === "open" || g.status === "locked");

    return {
      capacity_mw: proj.capacity_mw == null ? null : Number(proj.capacity_mw),
      capacity_mwh: proj.capacity_mwh == null ? null : Number(proj.capacity_mwh),
      target_cod: proj.target_cod ?? null,
      days_to_cod: daysToCod,
      current_gate: currentGate,
      budget,
      open_rfis: (rfisRes.data ?? []).length,
      open_risks: risks.length,
      top_risk_score: risks.length === 0 ? null : Math.max(...risks.map((r) => Number(r.score ?? 0))),
      next_milestone: nextTask
        ? { name: nextTask.name, date: nextTask.end_date, kind: "task" }
        : nextGate
          ? { name: `${nextGate.name} gate`, date: null, kind: "gate" }
          : null,
    };
  });
