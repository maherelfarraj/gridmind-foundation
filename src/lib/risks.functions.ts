// P-074 — Risk register server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  riskCreateSchema,
  riskDeleteSchema,
  riskUpdateSchema,
  type RiskCategory,
  type RiskStatus,
} from "@/lib/risks.rules";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export interface RiskRow {
  id: string;
  company_id: string;
  project_id: string;
  title: string;
  description: string | null;
  category: RiskCategory;
  probability: number;
  impact: number;
  score: number;
  status: RiskStatus;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  mitigation: string | null;
  contingency_amount: number | null;
  currency_code: string | null;
  target_close_date: string | null;
  identified_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

const WRITE_ROLES = ["project_admin", "hse_admin", "finance_admin", "company_admin"] as const;

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

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function loadProject(context: AuthContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string };
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

function toRiskRow(r: any, ownerLookup?: Map<string, ProjectMember>): RiskRow {
  const owner = r.owner_id ? (ownerLookup?.get(r.owner_id) ?? null) : null;
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    title: r.title,
    description: r.description,
    category: r.category as RiskCategory,
    probability: Number(r.probability),
    impact: Number(r.impact),
    score: Number(r.score ?? r.probability * r.impact),
    status: r.status as RiskStatus,
    owner_id: r.owner_id,
    owner_name: owner?.full_name ?? null,
    owner_email: owner?.email ?? null,
    mitigation: r.mitigation,
    contingency_amount: r.contingency_amount == null ? null : Number(r.contingency_amount),
    currency_code: r.currency_code,
    target_close_date: r.target_close_date,
    identified_at: r.identified_at,
    closed_at: r.closed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const listInput = z.object({ projectId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getRisksAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    const canWrite = await hasAnyRole(context, WRITE_ROLES);
    return { canWrite };
  });

// ---------------------------------------------------------------------------
// List risks (+ owner names)
// ---------------------------------------------------------------------------
export const listRisks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<RiskRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("risks")
      .select("*")
      .eq("project_id", data.projectId)
      .order("identified_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    const list = (rows ?? []) as any[];
    const ownerIds = Array.from(new Set(list.map((r) => r.owner_id).filter(Boolean))) as string[];
    let lookup = new Map<string, ProjectMember>();
    if (ownerIds.length > 0) {
      const { data: owners, error: oErr } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ownerIds);
      if (oErr) throw oErr;
      lookup = new Map(
        ((owners ?? []) as any[]).map((o) => [
          o.id as string,
          { id: o.id, full_name: o.full_name, email: o.email },
        ]),
      );
    }
    return list.map((r) => toRiskRow(r, lookup));
  });

// ---------------------------------------------------------------------------
// Project members (same company) — for owner select.
// ---------------------------------------------------------------------------
export const listProjectMembers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectMember[]> => {
    requireSupabaseAuth(context);
    const project = await loadProject(context, data.projectId);
    const { data: rows, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", project.company_id)
      .order("full_name", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      full_name: r.full_name,
      email: r.email,
    }));
  });

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export const createRisk = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => riskCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<RiskRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    const today = new Date().toISOString().slice(0, 10);
    const insert = {
      company_id: project.company_id,
      project_id: project.id,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      category: data.category,
      probability: data.probability,
      impact: data.impact,
      status: data.status,
      owner_id: data.owner_id ?? null,
      mitigation: data.mitigation?.trim() || null,
      contingency_amount: data.contingency_amount ?? null,
      currency_code: data.currency_code?.toUpperCase() || null,
      target_close_date: data.target_close_date ?? null,
      identified_at: data.identified_at ?? today,
      closed_at: data.status === "closed" ? new Date().toISOString() : null,
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("risks")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRiskRow(inserted);
    await audit(context, "risk.create", "risks", row.id, {
      project_id: project.id,
      title: row.title,
      category: row.category,
      score: row.score,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
export const updateRisk = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => riskUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<RiskRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    const { data: current, error: curErr } = await context.supabase
      .from("risks")
      .select("id, project_id, status, closed_at, title")
      .eq("id", data.id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) httpError(404, "risk_not_found");

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      if (k === "currency_code" && typeof v === "string") {
        patch[k] = v.toUpperCase();
      } else if (typeof v === "string") {
        patch[k] = v.trim() === "" ? null : v.trim();
      } else {
        patch[k] = v;
      }
    }

    const prevStatus = (current as any).status as RiskStatus;
    const nextStatus = (patch.status as RiskStatus | undefined) ?? prevStatus;
    const statusChanged = nextStatus !== prevStatus;

    if (statusChanged) {
      if (nextStatus === "closed") {
        patch.closed_at = new Date().toISOString();
      } else if (prevStatus === "closed") {
        patch.closed_at = null;
      }
    }

    const { data: updated, error } = await context.supabase
      .from("risks")
      .update(patch as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRiskRow(updated);
    await audit(context, "risk.update", "risks", row.id, {
      project_id: (current as any).project_id,
      changes: Object.keys(patch),
    });
    if (statusChanged) {
      await audit(context, "risk.status_change", "risks", row.id, {
        project_id: (current as any).project_id,
        from: prevStatus,
        to: nextStatus,
      });
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export const deleteRisk = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => riskDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    const { data: current } = await context.supabase
      .from("risks")
      .select("id, project_id, title")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) httpError(404, "risk_not_found");

    const { error } = await context.supabase.from("risks").delete().eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "risk.delete", "risks", data.id, {
      project_id: (current as any).project_id,
      title: (current as any).title,
    });
    return { ok: true };
  });
