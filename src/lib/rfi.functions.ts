// P-059 — RFI server functions (RLS-scoped).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";
import {
  computeKpis,
  nextRfiNumber,
  type RfiKpis,
  type RfiStatus,
} from "@/lib/rfi-rules";

// ---------------------------------------------------------------------------
// constants + errors
// ---------------------------------------------------------------------------
const ADMIN_ROLES = [
  "engineering_admin",
  "project_admin",
  "super_admin",
] as const;

const DISCIPLINES = [
  "civil",
  "structural",
  "electrical",
  "mechanical",
  "scada_controls",
  "survey",
  "general",
] as const;

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProjectCompany(context: any, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string };
}

async function loadRfi(context: any, rfiId: string) {
  const { data, error } = await context.supabase
    .from("rfis")
    .select("*")
    .eq("id", rfiId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "rfi_not_found");
  return data as any;
}

async function isAdminOfCompany(context: any, companyId: string) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("company_id", companyId)
    .in("role", ADMIN_ROLES as unknown as string[])
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

async function audit(
  context: any,
  action: string,
  entityId: string,
  metadata: Record<string, any>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "rfis",
      p_entity_id: entityId,
      p_metadata: metadata,
    });
  } catch {
    // never fail the write on audit
  }
}

// ---------------------------------------------------------------------------
// Types returned to UI
// ---------------------------------------------------------------------------
export interface RfiRow {
  id: string;
  project_id: string;
  rfi_number: string;
  subject: string;
  question: string;
  discipline: (typeof DISCIPLINES)[number];
  priority: (typeof PRIORITIES)[number];
  status: RfiStatus;
  raised_by: string | null;
  raised_by_name: string | null;
  routed_to: string | null;
  routed_to_name: string | null;
  drawing_id: string | null;
  drawing_number: string | null;
  due_date: string | null;
  answer: string | null;
  answered_by: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  closed_at: string | null;
  cost_impact: boolean;
  schedule_impact: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoutableMember {
  user_id: string;
  full_name: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// listRfis
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid(),
  status: z.string().nullable().optional(),
  discipline: z.string().nullable().optional(),
  assignee: z.string().uuid().nullable().optional(),
  search: z.string().nullable().optional(),
});

export const listRfis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<RfiRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("rfis")
      .select(
        "*, raised_profile:profiles!rfis_raised_by_fkey (id, full_name, email), routed_profile:profiles!rfis_routed_to_fkey (id, full_name, email), answered_profile:profiles!rfis_answered_by_fkey (id, full_name, email), drawing:drawing_register!rfis_drawing_id_fkey (id, drawing_number)",
      )
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.discipline) q = q.eq("discipline", data.discipline);
    if (data.assignee) q = q.eq("routed_to", data.assignee);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.or(
        `subject.ilike.%${s}%,rfi_number.ilike.%${s}%,question.ilike.%${s}%`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toRfiRow);
  });

function toRfiRow(r: any): RfiRow {
  return {
    id: r.id,
    project_id: r.project_id,
    rfi_number: r.rfi_number,
    subject: r.subject,
    question: r.question,
    discipline: r.discipline,
    priority: r.priority,
    status: r.status,
    raised_by: r.raised_by,
    raised_by_name:
      r.raised_profile?.full_name ?? r.raised_profile?.email ?? null,
    routed_to: r.routed_to,
    routed_to_name:
      r.routed_profile?.full_name ?? r.routed_profile?.email ?? null,
    drawing_id: r.drawing_id,
    drawing_number: r.drawing?.drawing_number ?? null,
    due_date: r.due_date,
    answer: r.answer,
    answered_by: r.answered_by,
    answered_by_name:
      r.answered_profile?.full_name ?? r.answered_profile?.email ?? null,
    answered_at: r.answered_at,
    closed_at: r.closed_at,
    cost_impact: !!r.cost_impact,
    schedule_impact: !!r.schedule_impact,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// getRfi
// ---------------------------------------------------------------------------
export const getRfi = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ rfiId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RfiRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("rfis")
      .select(
        "*, raised_profile:profiles!rfis_raised_by_fkey (id, full_name, email), routed_profile:profiles!rfis_routed_to_fkey (id, full_name, email), answered_profile:profiles!rfis_answered_by_fkey (id, full_name, email), drawing:drawing_register!rfis_drawing_id_fkey (id, drawing_number)",
      )
      .eq("id", data.rfiId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "rfi_not_found");
    return toRfiRow(row);
  });

// ---------------------------------------------------------------------------
// listRoutableMembers — any company member in the project's company
// ---------------------------------------------------------------------------
export const listRoutableMembers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RoutableMember[]> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", project.company_id)
      .order("full_name", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map((p) => ({
      user_id: p.id,
      full_name: p.full_name ?? p.email ?? "Unnamed user",
      email: p.email ?? null,
    }));
  });

// ---------------------------------------------------------------------------
// getMyRfiRole
// ---------------------------------------------------------------------------
export const getMyRfiRole = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{
    userId: string;
    isAdmin: boolean;
  }> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);
    const isAdmin = await isAdminOfCompany(context, project.company_id);
    return { userId: context.user.id, isAdmin };
  });

// ---------------------------------------------------------------------------
// raiseRfi
// ---------------------------------------------------------------------------
const raiseInput = z.object({
  projectId: z.string().uuid(),
  subject: z.string().min(3).max(140),
  question: z.string().min(10).max(4000),
  discipline: z.enum([...DISCIPLINES] as [string, ...string[]]),
  priority: z.enum([...PRIORITIES] as [string, ...string[]]),

  routedTo: z.string().uuid(),
  drawingId: z.string().uuid().nullable().optional(),
  dueDate: z.string().min(1),
  costImpact: z.boolean().optional(),
  scheduleImpact: z.boolean().optional(),
});

export const raiseRfi = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => raiseInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; rfi_number: string }> => {
    requireSupabaseAuth(context);
    const project = await loadProjectCompany(context, data.projectId);

    // Confirm routed_to is in same company.
    const { data: routedProfile, error: rpErr } = await context.supabase
      .from("profiles")
      .select("id, company_id")
      .eq("id", data.routedTo)
      .maybeSingle();
    if (rpErr) throw rpErr;
    if (!routedProfile || routedProfile.company_id !== project.company_id) {
      httpError(400, "routed_to_invalid", "Routed reviewer is not in this company.");
    }

    // Compute next RFI-#### from existing rows for this project.
    const { data: existing, error: exErr } = await context.supabase
      .from("rfis")
      .select("rfi_number")
      .eq("project_id", data.projectId);
    if (exErr) throw exErr;
    const number = nextRfiNumber(((existing ?? []) as any[]).map((r) => r.rfi_number));

    const insertRow = {
      company_id: project.company_id,
      project_id: data.projectId,
      rfi_number: number,
      subject: data.subject,
      question: data.question,
      discipline: data.discipline,
      priority: data.priority,
      status: "open" as const,
      raised_by: context.user.id,
      routed_to: data.routedTo,
      drawing_id: data.drawingId ?? null,
      due_date: data.dueDate,
      cost_impact: !!data.costImpact,
      schedule_impact: !!data.scheduleImpact,
      created_by: context.user.id,
    };

    const { data: inserted, error: iErr } = await context.supabase
      .from("rfis")
      .insert(insertRow)
      .select("id, rfi_number")
      .single();
    if (iErr) {
      const msg = String((iErr as any).message ?? "");
      const code = String((iErr as any).code ?? "");
      if (code === "23505" || msg.toLowerCase().includes("duplicate")) {
        httpError(
          409,
          "rfi_duplicate_number",
          `RFI number ${number} was just taken. Try again.`,
        );
      }
      throw iErr;
    }

    await audit(context, "rfi.raised", inserted.id, {
      rfi_number: inserted.rfi_number,
      project_id: data.projectId,
      routed_to: data.routedTo,
      priority: data.priority,
      discipline: data.discipline,
    });

    return { id: inserted.id, rfi_number: inserted.rfi_number };
  });

// ---------------------------------------------------------------------------
// answerRfi
// ---------------------------------------------------------------------------
const answerInput = z.object({
  rfiId: z.string().uuid(),
  answer: z.string().min(3).max(4000),
});

export const answerRfi = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => answerInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const rfi = await loadRfi(context, data.rfiId);
    const isAdmin = await isAdminOfCompany(context, rfi.company_id);
    if (!isAdmin && rfi.routed_to !== context.user.id) {
      httpError(403, "rfi_not_authorized_to_answer");
    }
    if (rfi.status !== "open" && rfi.status !== "in_review") {
      httpError(409, "rfi_not_answerable", `RFI is ${rfi.status}.`);
    }
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase
      .from("rfis")
      .update({
        answer: data.answer,
        answered_by: context.user.id,
        answered_at: nowIso,
        status: "answered",
      })
      .eq("id", data.rfiId);
    if (error) throw error;
    await audit(context, "rfi.answered", data.rfiId, {
      rfi_number: rfi.rfi_number,
      answered_at: nowIso,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// closeRfi
// ---------------------------------------------------------------------------
export const closeRfi = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ rfiId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const rfi = await loadRfi(context, data.rfiId);
    const isAdmin = await isAdminOfCompany(context, rfi.company_id);
    if (!isAdmin && rfi.raised_by !== context.user.id) {
      httpError(403, "rfi_not_authorized_to_close");
    }
    if (rfi.status !== "answered") {
      httpError(409, "rfi_not_closable", `RFI is ${rfi.status}; must be answered to close.`);
    }
    const nowIso = new Date().toISOString();
    const { error } = await context.supabase
      .from("rfis")
      .update({ status: "closed", closed_at: nowIso })
      .eq("id", data.rfiId);
    if (error) throw error;
    await audit(context, "rfi.closed", data.rfiId, {
      rfi_number: rfi.rfi_number,
      closed_at: nowIso,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// voidRfi (admin only)
// ---------------------------------------------------------------------------
export const voidRfi = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ rfiId: z.string().uuid(), reason: z.string().min(3).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const rfi = await loadRfi(context, data.rfiId);
    const isAdmin = await isAdminOfCompany(context, rfi.company_id);
    if (!isAdmin) httpError(403, "forbidden");
    if (rfi.status === "closed" || rfi.status === "void") {
      httpError(409, "rfi_not_voidable", `RFI is ${rfi.status}.`);
    }
    const { error } = await context.supabase
      .from("rfis")
      .update({ status: "void" })
      .eq("id", data.rfiId);
    if (error) throw error;
    await audit(context, "rfi.voided", data.rfiId, {
      rfi_number: rfi.rfi_number,
      reason: data.reason,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// getRfiKpis — last 90 days, plus 6-month raised/answered by month
// ---------------------------------------------------------------------------
export interface RfiKpiResult extends RfiKpis {
  by_month: { month: string; raised: number; answered: number }[];
}

export const getRfiKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RfiKpiResult> => {
    requireSupabaseAuth(context);
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const { data: rows, error } = await context.supabase
      .from("rfis")
      .select(
        "status, due_date, created_at, answered_at, raised_by, routed_to",
      )
      .eq("project_id", data.projectId)
      .gte("created_at", since.toISOString());
    if (error) throw error;
    const list = (rows ?? []) as any[];
    const kpis = computeKpis(list);

    // 6-month bar
    const buckets = new Map<string, { raised: number; answered: number }>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(k, { raised: 0, answered: 0 });
    }
    const monthKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };
    // Pull a wider window for the chart (last 6 months).
    const chartSince = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const { data: allRows, error: allErr } = await context.supabase
      .from("rfis")
      .select("created_at, answered_at")
      .eq("project_id", data.projectId)
      .gte("created_at", chartSince.toISOString());
    if (allErr) throw allErr;
    for (const r of (allRows ?? []) as any[]) {
      const rk = monthKey(r.created_at);
      if (buckets.has(rk)) buckets.get(rk)!.raised += 1;
      if (r.answered_at) {
        const ak = monthKey(r.answered_at);
        if (buckets.has(ak)) buckets.get(ak)!.answered += 1;
      }
    }
    const by_month = Array.from(buckets.entries()).map(([month, v]) => ({
      month,
      raised: v.raised,
      answered: v.answered,
    }));

    return { ...kpis, by_month };
  });
