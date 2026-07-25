// P-091 — NCR server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  canWriteNcr,
  NCR_DISPOSITIONS,
  NCR_SOURCES,
  NCR_STATUSES,
  ncrCloseInput,
  ncrCreateInput,
  ncrDispositionInput,
  ncrVoidInput,
  nextNcrNumber,
  type NcrDisposition,
  type NcrSource,
  type NcrStatus,
} from "@/lib/ncr.rules";

export interface NcrRow {
  id: string;
  company_id: string;
  project_id: string;
  ncr_number: string;
  source: NcrSource;
  source_id: string | null;
  discipline: string | null;
  area: string | null;
  description: string;
  root_cause: string | null;
  disposition: NcrDisposition;
  corrective_action: string | null;
  status: NcrStatus;
  cost_impact: number | null;
  currency_code: string | null;
  raised_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface NcrListItem extends NcrRow {
  project_name: string | null;
  project_code: string | null;
}
export interface NcrDetail {
  ncr: NcrListItem;
  source_summary: { label: string; href: string | null } | null;
  permissions: { canWrite: boolean };
}

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
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best effort */
  }
}

async function allocateNcrNumber(context: AuthContext, companyId: string): Promise<string> {
  const { data, error } = await context.supabase
    .from("ncrs")
    .select("ncr_number")
    .eq("company_id", companyId)
    .order("ncr_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = ((data ?? []) as { ncr_number: string }[]).map((r) => r.ncr_number);
  return nextNcrNumber(list);
}

function mapRow(r: any): NcrListItem {
  return {
    ...(r as NcrRow),
    cost_impact: r.cost_impact === null ? null : Number(r.cost_impact),
    project_name: r.projects?.name ?? null,
    project_code: r.projects?.code ?? null,
  };
}

const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  status: z.enum(NCR_STATUSES).nullable().optional(),
  disposition: z.enum(NCR_DISPOSITIONS).nullable().optional(),
  source: z.enum(NCR_SOURCES).nullable().optional(),
  search: z.string().trim().max(200).nullable().optional(),
});

export const listNcrs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<NcrListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("ncrs")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.status) q = q.eq("status", data.status);
    if (data.disposition) q = q.eq("disposition", data.disposition);
    if (data.source) q = q.eq("source", data.source);
    const { data: rows, error } = await q;
    if (error) throw error;
    const term = (data.search ?? "").toLowerCase();
    const mapped = (rows ?? []).map(mapRow);
    if (!term) return mapped;
    return mapped.filter(
      (r) =>
        r.ncr_number.toLowerCase().includes(term) ||
        r.description.toLowerCase().includes(term) ||
        (r.area ?? "").toLowerCase().includes(term) ||
        (r.discipline ?? "").toLowerCase().includes(term),
    );
  });

async function resolveSourceSummary(
  context: AuthContext,
  companyId: string,
  source: NcrSource,
  sourceId: string | null,
): Promise<NcrDetail["source_summary"]> {
  if (!sourceId) return null;
  if (source === "inspection") {
    const { data } = await context.supabase
      .from("qaqc_inspections")
      .select("inspection_number")
      .eq("company_id", companyId)
      .eq("id", sourceId)
      .maybeSingle();
    if (!data) return null;
    return {
      label: `Inspection ${(data as any).inspection_number}`,
      href: `/qaqc/inspections/${sourceId}`,
    };
  }
  if (source === "punch_item") {
    const { data } = await context.supabase
      .from("qaqc_punch_items")
      .select("punch_number")
      .eq("company_id", companyId)
      .eq("id", sourceId)
      .maybeSingle();
    if (!data) return null;
    return {
      label: `Punch ${(data as any).punch_number}`,
      href: `/qaqc/punch/${sourceId}`,
    };
  }
  if (source === "observation") {
    return { label: `Observation ${sourceId.slice(0, 8)}`, href: null };
  }
  return null;
}

export const getNcr = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<NcrDetail> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("ncrs")
      .select("*, projects:project_id(name, code)")
      .eq("company_id", companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "ncr_not_found");
    const roles = await currentRoles(context);
    const ncr = mapRow(row);
    const source_summary = await resolveSourceSummary(
      context,
      companyId,
      ncr.source,
      ncr.source_id,
    );
    return {
      ncr,
      source_summary,
      permissions: { canWrite: canWriteNcr(roles) },
    };
  });

export const createNcr = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ncrCreateInput.parse(raw))
  .handler(async ({ data, context }): Promise<NcrRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteNcr(roles)) httpError(403, "forbidden");

    // verify project belongs to same company
    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId) httpError(400, "invalid_project");

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ncrNumber = await allocateNcrNumber(context, companyId);
      const insertRow = {
        company_id: companyId,
        project_id: data.projectId,
        ncr_number: ncrNumber,
        source: data.source,
        source_id: data.sourceId ?? null,
        discipline: data.discipline ?? null,
        area: data.area ?? null,
        description: data.description,
        cost_impact: data.costImpact ?? null,
        currency_code: data.currencyCode ?? null,
        raised_by: context.user!.id,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("ncrs")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (!error && inserted) {
        await audit(context, "ncr.raise", "ncrs", (inserted as any).id, {
          project_id: data.projectId,
          ncr_number: ncrNumber,
          source: data.source,
          source_id: data.sourceId ?? null,
        });
        return {
          ...(inserted as unknown as NcrRow),
          cost_impact:
            (inserted as any).cost_impact === null ? null : Number((inserted as any).cost_impact),
        };
      }
      lastErr = error;
      if ((error as any)?.code !== "23505") break;
    }
    throw lastErr ?? new Error("create_failed");
  });

export const setNcrDisposition = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ncrDispositionInput.parse(raw))
  .handler(async ({ data, context }): Promise<NcrRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteNcr(roles)) httpError(403, "forbidden");

    const patch: Record<string, unknown> = {
      disposition: data.disposition,
    };
    if (data.rootCause !== undefined) patch.root_cause = data.rootCause ?? null;
    if (data.correctiveAction !== undefined)
      patch.corrective_action = data.correctiveAction ?? null;
    if (data.status !== undefined) patch.status = data.status;
    else if (data.disposition !== "pending") patch.status = "in_progress";

    const { data: updated, error } = await context.supabase
      .from("ncrs")
      .update(patch as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "ncr_not_found");

    await audit(context, "ncr.disposition", "ncrs", data.id, {
      disposition: data.disposition,
      status: (updated as any).status,
    });
    return {
      ...(updated as unknown as NcrRow),
      cost_impact:
        (updated as any).cost_impact === null ? null : Number((updated as any).cost_impact),
    };
  });

export const closeNcr = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ncrCloseInput.parse(raw))
  .handler(async ({ data, context }): Promise<NcrRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteNcr(roles)) httpError(403, "forbidden");

    const { data: updated, error } = await context.supabase
      .from("ncrs")
      .update({
        status: "closed",
        closed_by: context.user!.id,
        closed_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "ncr_not_found");

    await audit(context, "ncr.close", "ncrs", data.id, {});
    return {
      ...(updated as unknown as NcrRow),
      cost_impact:
        (updated as any).cost_impact === null ? null : Number((updated as any).cost_impact),
    };
  });

export const voidNcr = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ncrVoidInput.parse(raw))
  .handler(async ({ data, context }): Promise<NcrRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWriteNcr(roles)) httpError(403, "forbidden");

    const { data: updated, error } = await context.supabase
      .from("ncrs")
      .update({ status: "void" } as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "ncr_not_found");
    await audit(context, "ncr.void", "ncrs", data.id, { reason: data.reason });
    return {
      ...(updated as unknown as NcrRow),
      cost_impact:
        (updated as any).cost_impact === null ? null : Number((updated as any).cost_impact),
    };
  });

export const listNcrProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; code: string | null }[];
  });

export const listNcrCurrencies = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("currencies")
      .select("code")
      .order("code", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as { code: string }[]).map((r) => r.code);
  });
