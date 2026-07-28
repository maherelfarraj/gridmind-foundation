// P-258 — Subcontract register + claim certification server functions.
// Certification never writes the claim status directly: it goes through the
// P-111 engine (`decide_approval` → `settle_approval_entity` → the derived
// settler), which is the only writer allowed past the guard trigger.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { settleEntityForApproval } from "@/lib/approval-settle.server";
import {
  ClaimDecisionSchema,
  ClaimSaveSchema,
  SUBCONTRACT_CLAIM_ENTITY_TYPE,
  SUBCONTRACT_CLAIM_RULE_KEY,
  SubcontractSaveSchema,
  computeClaimTotals,
  isSubcontractorCapable,
  reconcileSov,
  type SubcontractClaimStatus,
  type SubcontractStatus,
} from "@/lib/subcontracts.rules";

const WRITE_ROLES = [
  "project_admin",
  "construction_admin",
  "procurement_admin",
  "finance_admin",
  "company_admin",
] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as never })),
  );
  return results.some((r) => r?.data === true);
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as { company_id: string | null } | null)?.company_id;
  if (!id) httpError(400, "no_company", "User is not linked to a company.");
  return id;
}

async function audit(
  ctx: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await ctx.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* audit is best-effort */
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
export interface SubcontractRow {
  id: string;
  subcontract_number: string | null;
  title: string;
  vendor_id: string;
  vendor_name: string | null;
  project_id: string;
  project_name: string | null;
  wbs_item_id: string | null;
  scope_summary: string | null;
  contract_value: number;
  currency_code: string;
  retention_pct: number;
  start_date: string | null;
  end_date: string | null;
  status: SubcontractStatus;
  notes: string | null;
  certified_to_date: number;
  retention_held: number;
  retention_released: number;
  created_at: string;
}

export interface SubcontractLineRow {
  id: string;
  line_no: number;
  description: string;
  uom: string | null;
  qty: number;
  unit_price: number;
  amount: number;
  wbs_item_id: string | null;
}

export interface ClaimRow {
  id: string;
  claim_number: string | null;
  subcontract_id: string;
  period_start: string;
  period_end: string;
  gross_to_date: number;
  previous_certified: number;
  this_period_amount: number;
  retention_amount: number;
  net_payable: number;
  status: SubcontractClaimStatus;
  approval_instance_id: string | null;
  submitted_at: string | null;
  certified_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface ClaimLineRow {
  id: string;
  subcontract_line_id: string;
  line_no: number;
  description: string;
  previous_pct: number;
  this_period_pct: number;
  cumulative_pct: number;
  line_amount: number;
  previous_amount: number;
  this_period_amount: number;
}

const N = (v: unknown) => Number(v ?? 0);

function toSubcontract(
  r: Record<string, unknown>,
  vendorName: string | null,
  projectName: string | null,
): SubcontractRow {
  return {
    id: r.id as string,
    subcontract_number: (r.subcontract_number as string) ?? null,
    title: r.title as string,
    vendor_id: r.vendor_id as string,
    vendor_name: vendorName,
    project_id: r.project_id as string,
    project_name: projectName,
    wbs_item_id: (r.wbs_item_id as string) ?? null,
    scope_summary: (r.scope_summary as string) ?? null,
    contract_value: N(r.contract_value),
    currency_code: r.currency_code as string,
    retention_pct: N(r.retention_pct),
    start_date: (r.start_date as string) ?? null,
    end_date: (r.end_date as string) ?? null,
    status: r.status as SubcontractStatus,
    notes: (r.notes as string) ?? null,
    certified_to_date: N(r.certified_to_date),
    retention_held: N(r.retention_held),
    retention_released: N(r.retention_released),
    created_at: r.created_at as string,
  };
}

function toClaim(r: Record<string, unknown>): ClaimRow {
  return {
    id: r.id as string,
    claim_number: (r.claim_number as string) ?? null,
    subcontract_id: r.subcontract_id as string,
    period_start: r.period_start as string,
    period_end: r.period_end as string,
    gross_to_date: N(r.gross_to_date),
    previous_certified: N(r.previous_certified),
    this_period_amount: N(r.this_period_amount),
    retention_amount: N(r.retention_amount),
    net_payable: N(r.net_payable),
    status: r.status as SubcontractClaimStatus,
    approval_instance_id: (r.approval_instance_id as string) ?? null,
    submitted_at: (r.submitted_at as string) ?? null,
    certified_at: (r.certified_at as string) ?? null,
    rejection_reason: (r.rejection_reason as string) ?? null,
    notes: (r.notes as string) ?? null,
    created_at: r.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Access probe
// ---------------------------------------------------------------------------
export const getSubcontractAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyRole(context, WRITE_ROLES) };
  });

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------
export const listSubcontracts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        search: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        project_id: z.string().uuid().nullable().optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<SubcontractRow[]> => {
    requireSupabaseAuth(context);
    let query = context.supabase
      .from("subcontracts")
      .select("*")
      .order("created_at", { ascending: false });
    if (data.status) query = query.eq("status", data.status as never);
    if (data.project_id) query = query.eq("project_id", data.project_id);
    const { data: rows, error } = await query;
    if (error) throw error;
    const list = (rows ?? []) as Record<string, unknown>[];

    const vendorIds = Array.from(new Set(list.map((r) => r.vendor_id as string)));
    const projectIds = Array.from(new Set(list.map((r) => r.project_id as string)));
    const [{ data: vendors }, { data: projects }] = await Promise.all([
      vendorIds.length
        ? context.supabase.from("vendors").select("id, name").in("id", vendorIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      projectIds.length
        ? context.supabase.from("projects").select("id, name").in("id", projectIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
    const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));

    const mapped = list.map((r) =>
      toSubcontract(
        r,
        vendorName.get(r.vendor_id as string) ?? null,
        projectName.get(r.project_id as string) ?? null,
      ),
    );
    const needle = (data.search ?? "").trim().toLowerCase();
    if (!needle) return mapped;
    return mapped.filter((r) =>
      [r.subcontract_number, r.title, r.vendor_name, r.project_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  });

export const getSubcontract = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      subcontract: SubcontractRow;
      lines: SubcontractLineRow[];
      claims: ClaimRow[];
    }> => {
      requireSupabaseAuth(context);
      const { data: sc, error } = await context.supabase
        .from("subcontracts")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw error;
      if (!sc) httpError(404, "not_found", "Subcontract not found.");
      const row = sc as Record<string, unknown>;

      const [{ data: lines }, { data: claims }, { data: vendor }, { data: project }] =
        await Promise.all([
          context.supabase
            .from("subcontract_lines")
            .select("*")
            .eq("subcontract_id", data.id)
            .order("line_no", { ascending: true }),
          context.supabase
            .from("subcontract_claims")
            .select("*")
            .eq("subcontract_id", data.id)
            .order("created_at", { ascending: false }),
          context.supabase
            .from("vendors")
            .select("name")
            .eq("id", row.vendor_id as string)
            .maybeSingle(),
          context.supabase
            .from("projects")
            .select("name")
            .eq("id", row.project_id as string)
            .maybeSingle(),
        ]);

      return {
        subcontract: toSubcontract(
          row,
          (vendor as { name: string } | null)?.name ?? null,
          (project as { name: string } | null)?.name ?? null,
        ),
        lines: ((lines ?? []) as Record<string, unknown>[]).map((l) => ({
          id: l.id as string,
          line_no: Number(l.line_no),
          description: l.description as string,
          uom: (l.uom as string) ?? null,
          qty: N(l.qty),
          unit_price: N(l.unit_price),
          amount: N(l.amount),
          wbs_item_id: (l.wbs_item_id as string) ?? null,
        })),
        claims: ((claims ?? []) as Record<string, unknown>[]).map(toClaim),
      };
    },
  );

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------
export const listSubcontractPickers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid().nullable().optional() }).parse(raw ?? {}),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      vendors: { id: string; name: string; categories: string[] }[];
      projects: { id: string; name: string }[];
      wbs: { id: string; code: string; name: string; project_id: string }[];
      currencies: string[];
    }> => {
      requireSupabaseAuth(context);
      const [{ data: vendors }, { data: projects }, { data: currencies }] = await Promise.all([
        context.supabase
          .from("vendors")
          .select("id, name, categories, status")
          .eq("status", "active")
          .order("name"),
        context.supabase.from("projects").select("id, name").order("name"),
        context.supabase.from("currencies").select("code").order("code"),
      ]);

      let wbsRows: { id: string; code: string; name: string; project_id: string }[] = [];
      if (data.project_id) {
        const { data: wbs } = await context.supabase
          .from("wbs_items")
          .select("id, code, name, project_id")
          .eq("project_id", data.project_id)
          .order("code");
        wbsRows = (wbs ?? []) as typeof wbsRows;
      }

      return {
        vendors: ((vendors ?? []) as { id: string; name: string; categories: string[] | null }[])
          .filter((v) => isSubcontractorCapable(v.categories))
          .map((v) => ({ id: v.id, name: v.name, categories: v.categories ?? [] })),
        projects: (projects ?? []) as { id: string; name: string }[],
        wbs: wbsRows,
        currencies: ((currencies ?? []) as { code: string }[]).map((c) => c.code),
      };
    },
  );

// ---------------------------------------------------------------------------
// Save subcontract + SOV
// ---------------------------------------------------------------------------
export const saveSubcontract = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => SubcontractSaveSchema.parse(raw))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const companyId = await currentCompanyId(context);

    const recon = reconcileSov(data.lines, data.contract_value);
    if (!recon.reconciled) httpError(422, "sov_mismatch", "SOV total must equal contract value.");

    const header = {
      company_id: companyId,
      title: data.title,
      vendor_id: data.vendor_id,
      project_id: data.project_id,
      wbs_item_id: data.wbs_item_id ?? null,
      scope_summary: data.scope_summary ?? null,
      contract_value: data.contract_value,
      currency_code: data.currency_code,
      retention_pct: data.retention_pct,
      start_date: data.start_date ?? null,
      end_date: data.end_date ?? null,
      status: data.status,
      notes: data.notes ?? null,
    };

    let id = data.id ?? null;
    if (id) {
      const { error } = await context.supabase
        .from("subcontracts")
        .update(header as never)
        .eq("id", id);
      if (error) throw error;
      await context.supabase.from("subcontract_lines").delete().eq("subcontract_id", id);
    } else {
      const { data: created, error } = await context.supabase
        .from("subcontracts")
        .insert({ ...header, created_by: context.user!.id } as never)
        .select("id")
        .single();
      if (error) throw error;
      id = (created as { id: string }).id;
    }

    const { error: linesErr } = await context.supabase.from("subcontract_lines").insert(
      data.lines.map((l) => ({
        company_id: companyId,
        subcontract_id: id,
        line_no: l.line_no,
        description: l.description,
        uom: l.uom ?? null,
        qty: l.qty,
        unit_price: l.unit_price,
        wbs_item_id: l.wbs_item_id ?? null,
      })) as never,
    );
    if (linesErr) throw linesErr;

    await audit(
      context,
      data.id ? "subcontract.updated" : "subcontract.created",
      "subcontracts",
      id!,
      {
        contract_value: data.contract_value,
        lines: data.lines.length,
      },
    );
    return { id: id! };
  });

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
export const getClaim = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      claim: ClaimRow;
      lines: ClaimLineRow[];
      subcontract: SubcontractRow;
      approval: { approval_id: string; step_order: number } | null;
      canWrite: boolean;
    }> => {
      requireSupabaseAuth(context);
      const { data: claimRaw, error } = await context.supabase
        .from("subcontract_claims")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw error;
      if (!claimRaw) httpError(404, "not_found", "Claim not found.");
      const claim = toClaim(claimRaw as Record<string, unknown>);

      const { data: scRaw, error: scErr } = await context.supabase
        .from("subcontracts")
        .select("*")
        .eq("id", claim.subcontract_id)
        .maybeSingle();
      if (scErr) throw scErr;
      const scRow = (scRaw ?? {}) as Record<string, unknown>;

      const [{ data: clines }, { data: slines }, { data: vendor }, { data: project }] =
        await Promise.all([
          context.supabase.from("subcontract_claim_lines").select("*").eq("claim_id", data.id),
          context.supabase
            .from("subcontract_lines")
            .select("id, line_no, description")
            .eq("subcontract_id", claim.subcontract_id),
          context.supabase
            .from("vendors")
            .select("name")
            .eq("id", scRow.vendor_id as string)
            .maybeSingle(),
          context.supabase
            .from("projects")
            .select("name")
            .eq("id", scRow.project_id as string)
            .maybeSingle(),
        ]);

      const meta = new Map(
        ((slines ?? []) as { id: string; line_no: number; description: string }[]).map((l) => [
          l.id,
          l,
        ]),
      );
      const lines: ClaimLineRow[] = ((clines ?? []) as Record<string, unknown>[])
        .map((l) => {
          const m = meta.get(l.subcontract_line_id as string);
          return {
            id: l.id as string,
            subcontract_line_id: l.subcontract_line_id as string,
            line_no: m?.line_no ?? 0,
            description: m?.description ?? "",
            previous_pct: N(l.previous_pct),
            this_period_pct: N(l.this_period_pct),
            cumulative_pct: N(l.cumulative_pct),
            line_amount: N(l.line_amount),
            previous_amount: N(l.previous_amount),
            this_period_amount: N(l.this_period_amount),
          };
        })
        .sort((a, b) => a.line_no - b.line_no);

      // Pending approval row addressed to this user (drives the decision buttons).
      let approval: { approval_id: string; step_order: number } | null = null;
      if (claim.approval_instance_id) {
        const { data: rows } = await context.supabase
          .from("approvals")
          .select("id, step_order, status, approver_id")
          .eq("instance_id", claim.approval_instance_id)
          .eq("status", "pending");
        const mine = (
          (rows ?? []) as { id: string; step_order: number; approver_id: string }[]
        ).find((r) => r.approver_id === context.user!.id);
        if (mine) approval = { approval_id: mine.id, step_order: mine.step_order };
      }

      return {
        claim,
        lines,
        subcontract: toSubcontract(
          scRow,
          (vendor as { name: string } | null)?.name ?? null,
          (project as { name: string } | null)?.name ?? null,
        ),
        approval,
        canWrite: await hasAnyRole(context, WRITE_ROLES),
      };
    },
  );

export const saveClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ClaimSaveSchema.parse(raw))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");
    const companyId = await currentCompanyId(context);

    let id = data.id ?? null;
    if (id) {
      const { error } = await context.supabase
        .from("subcontract_claims")
        .update({
          period_start: data.period_start,
          period_end: data.period_end,
          notes: data.notes ?? null,
        } as never)
        .eq("id", id);
      if (error) throw error;
      await context.supabase.from("subcontract_claim_lines").delete().eq("claim_id", id);
    } else {
      const { data: created, error } = await context.supabase
        .from("subcontract_claims")
        .insert({
          company_id: companyId,
          subcontract_id: data.subcontract_id,
          period_start: data.period_start,
          period_end: data.period_end,
          notes: data.notes ?? null,
          created_by: context.user!.id,
        } as never)
        .select("id")
        .single();
      if (error) throw error;
      id = (created as { id: string }).id;
    }

    const { error: linesErr } = await context.supabase.from("subcontract_claim_lines").insert(
      data.lines.map((l) => ({
        company_id: companyId,
        claim_id: id,
        subcontract_line_id: l.subcontract_line_id,
        this_period_pct: l.this_period_pct,
      })) as never,
    );
    if (linesErr) throw linesErr;

    await audit(
      context,
      data.id ? "subcontract_claim.updated" : "subcontract_claim.created",
      "subcontract_claims",
      id!,
      {
        lines: data.lines.length,
      },
    );
    return { id: id! };
  });

/** Submit for certification — opens the P-111 instance on the seeded rule. */
export const submitClaimForCertification = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ claim_id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<{ instance_id: string | null }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden_role");

    const { data: claimRaw, error } = await context.supabase
      .from("subcontract_claims")
      .select("*")
      .eq("id", data.claim_id)
      .maybeSingle();
    if (error) throw error;
    if (!claimRaw) httpError(404, "not_found", "Claim not found.");
    const claim = toClaim(claimRaw as Record<string, unknown>);
    if (claim.status === "certified") httpError(409, "already_certified");

    const { data: sc } = await context.supabase
      .from("subcontracts")
      .select("title, subcontract_number, currency_code")
      .eq("id", claim.subcontract_id)
      .maybeSingle();
    const scRow = (sc ?? {}) as Record<string, unknown>;

    const { data: instanceId, error: startErr } = await context.supabase.rpc(
      "start_approval_instance",
      {
        p_rule_key: SUBCONTRACT_CLAIM_RULE_KEY,
        p_entity_type: SUBCONTRACT_CLAIM_ENTITY_TYPE,
        p_entity_id: claim.id,
        p_amount: claim.net_payable,
        p_metadata: {
          title: `${claim.claim_number ?? "Claim"} · ${scRow.subcontract_number ?? ""} ${
            scRow.title ?? ""
          }`.trim(),
          reference: claim.claim_number,
          subcontract_id: claim.subcontract_id,
          currency: scRow.currency_code ?? null,
          net_payable: claim.net_payable,
          retention_amount: claim.retention_amount,
        } as never,
      },
    );
    if (startErr) throw startErr;

    const { error: updErr } = await context.supabase
      .from("subcontract_claims")
      .update({
        status: "submitted",
        submitted_by: context.user!.id,
        submitted_at: new Date().toISOString(),
        approval_instance_id: (instanceId as string | null) ?? null,
        rejection_reason: null,
      } as never)
      .eq("id", claim.id);
    if (updErr) throw updErr;

    await audit(context, "subcontract_claim.submitted", "subcontract_claims", claim.id, {
      instance_id: instanceId ?? null,
      net_payable: claim.net_payable,
    });
    return { instance_id: (instanceId as string | null) ?? null };
  });

/** Certify / reject through the engine. The engine writes the claim status. */
export const decideClaim = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => ClaimDecisionSchema.parse(raw))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { error } = await context.supabase.rpc("decide_approval", {
      p_approval_id: data.approval_id,
      p_decision: data.decision,
      p_comment: data.comment ?? undefined,
    });
    if (error) throw error;
    await settleEntityForApproval(context.supabase, data.approval_id);
    await audit(
      context,
      data.decision === "approved" ? "subcontract_claim.certified" : "subcontract_claim.rejected",
      "subcontract_claims",
      data.claim_id,
      { comment: data.comment ?? null },
    );
    return { ok: true };
  });

/** Preview totals for an in-progress claim edit (server-side mirror of the SQL). */
export const previewClaimTotals = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        retention_pct: z.number().finite().min(0).max(100),
        lines: z.array(
          z.object({
            line_amount: z.number().finite().nonnegative(),
            previous_pct: z.number().finite(),
            this_period_pct: z.number().finite(),
          }),
        ),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return computeClaimTotals(data.lines, data.retention_pct);
  });
