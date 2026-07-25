// P-063 — RFQ server functions (RLS-scoped, role-gated, audited).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  RFQ_STATUSES,
  RFQ_BID_STATUSES,
  bidAttachmentSchema,
  bidLinesSchema,
  nextRfqNumber,
  rfqLinesSchema,
  type BidAttachment,
  type BidLine,
  type RfqBidStatus,
  type RfqLine,
  type RfqStatus,
} from "@/lib/rfq-rules";

// ---------------------------------------------------------------------------
// row types
// ---------------------------------------------------------------------------
export interface RfqRow {
  id: string;
  company_id: string;
  project_id: string;
  project_name: string | null;
  rfq_number: string;
  title: string;
  description: string | null;
  status: RfqStatus;
  currency_code: string;
  lines: RfqLine[];
  issue_date: string | null;
  due_date: string | null;
  terms: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BidRow {
  id: string;
  company_id: string;
  rfq_id: string;
  vendor_id: string;
  vendor_name: string;
  status: RfqBidStatus;
  total_price: number | null;
  currency_code: string | null;
  lead_time_days: number | null;
  validity_date: string | null;
  lines: BidLine[];
  attachments: BidAttachment[];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RfqDetail {
  rfq: RfqRow;
  bids: BidRow[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
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
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company", "No active company for user.");
  return companyId as string;
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
    // never fail on audit
  }
}

function toRfqRow(r: any, projectName?: string | null): RfqRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    project_name: projectName ?? r.projects?.name ?? null,
    rfq_number: r.rfq_number,
    title: r.title,
    description: r.description,
    status: r.status,
    currency_code: r.currency_code,
    lines: (r.lines ?? []) as RfqLine[],
    issue_date: r.issue_date,
    due_date: r.due_date,
    terms: r.terms,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toBidRow(r: any): BidRow {
  return {
    id: r.id,
    company_id: r.company_id,
    rfq_id: r.rfq_id,
    vendor_id: r.vendor_id,
    vendor_name: r.vendors?.name ?? "",
    status: r.status,
    total_price: r.total_price == null ? null : Number(r.total_price),
    currency_code: r.currency_code,
    lead_time_days: r.lead_time_days,
    validity_date: r.validity_date,
    lines: (r.lines ?? []) as BidLine[],
    attachments: (r.attachments ?? []) as BidAttachment[],
    submitted_at: r.submitted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getRfqWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canAuthor: boolean; canAward: boolean }> => {
    requireSupabaseAuth(context);
    const rolesToCheck = ["procurement_admin", "procurement_officer", "company_admin"] as const;
    const results = await Promise.all(
      rolesToCheck.map((r) => context.supabase.rpc("has_company_role", { p_role: r })),
    );
    const flags = Object.fromEntries(rolesToCheck.map((r, i) => [r, Boolean(results[i]?.data)]));
    const canAuthor = flags.procurement_admin || flags.procurement_officer || flags.company_admin;
    const canAward = flags.procurement_admin || flags.company_admin;
    return { canAuthor, canAward };
  });

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------
const listInput = z.object({
  search: z.string().nullable().optional(),
  status: z.enum(RFQ_STATUSES).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export const listRfqs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<RfqRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("rfqs")
      .select("*, projects:project_id(name)")
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.or(`title.ilike.%${s}%,rfq_number.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map((r) => toRfqRow(r));
  });

export const getRfq = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rfqId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<RfqDetail> => {
    requireSupabaseAuth(context);
    const { data: rfqRow, error: rfqErr } = await context.supabase
      .from("rfqs")
      .select("*, projects:project_id(name)")
      .eq("id", data.rfqId)
      .maybeSingle();
    if (rfqErr) throw rfqErr;
    if (!rfqRow) httpError(404, "rfq_not_found");
    const { data: bidRows, error: bidErr } = await context.supabase
      .from("rfq_bids")
      .select("*, vendors:vendor_id(name)")
      .eq("rfq_id", data.rfqId)
      .order("created_at", { ascending: true });
    if (bidErr) throw bidErr;
    return {
      rfq: toRfqRow(rfqRow),
      bids: ((bidRows ?? []) as any[]).map(toBidRow),
    };
  });

export const listRfqEligibleVendors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ search: z.string().nullable().optional() }).parse(input ?? {}),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<Array<{ id: string; name: string; currency_code: string | null }>> => {
      requireSupabaseAuth(context);
      let q = context.supabase
        .from("vendors")
        .select("id, name, currency_code")
        .eq("status", "active")
        .order("name", { ascending: true })
        .limit(200);
      if (data.search && data.search.trim().length > 0) {
        const s = data.search.trim().replace(/[%_]/g, "");
        q = q.ilike("name", `%${s}%`);
      }
      const { data: rows, error } = await q;
      if (error) throw error;
      return (rows ?? []) as any[];
    },
  );

export const listProjectsForRfq = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<Array<{ id: string; name: string; currency_code: string | null }>> => {
      requireSupabaseAuth(context);
      // projects has no currency column — the per-project currency lives in
      // project_financial_config (P-045). Join it so the RFQ form can default.
      const { data, error } = await context.supabase
        .from("projects")
        .select("id, name, project_financial_config(currency_code)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as any[]).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        currency_code:
          (Array.isArray(p.project_financial_config)
            ? p.project_financial_config[0]?.currency_code
            : p.project_financial_config?.currency_code) ?? null,
      }));
    },
  );


// ---------------------------------------------------------------------------
// save draft (insert or update while status='draft')
// ---------------------------------------------------------------------------
const draftInput = z.object({
  id: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  currencyCode: z.string().trim().min(3).max(3),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  terms: z.string().trim().max(4000).nullable().optional(),
  lines: rfqLinesSchema,
});

export const saveRfqDraft = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => draftInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    // Verify project belongs to this company.
    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId) {
      httpError(400, "project_invalid", "Project not in current company.");
    }

    if (data.id) {
      // Only editable while status='draft'.
      const { data: existing, error: exErr } = await context.supabase
        .from("rfqs")
        .select("id, status")
        .eq("id", data.id)
        .maybeSingle();
      if (exErr) throw exErr;
      if (!existing) httpError(404, "rfq_not_found");
      if ((existing as any).status !== "draft") {
        httpError(409, "rfq_not_draft", "Only drafts can be edited.");
      }
      const patch = {
        project_id: data.projectId,
        title: data.title,
        description: data.description ?? null,
        currency_code: data.currencyCode,
        issue_date: data.issueDate ?? null,
        due_date: data.dueDate ?? null,
        terms: data.terms ?? null,
        lines: data.lines as any,
      };
      const { error } = await context.supabase
        .from("rfqs")
        .update(patch as any)
        .eq("id", data.id);
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "rfq.update", "rfqs", data.id, {
        line_count: data.lines.length,
      });
      return { id: data.id };
    }

    // Insert draft — rfq_number placeholder based on a UUID slice keeps
    // the unique(company, rfq_number) constraint happy until issueRfq()
    // assigns the real RFQ-####.
    const draftNumber = `DRAFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const row = {
      company_id: companyId,
      project_id: data.projectId,
      rfq_number: draftNumber,
      title: data.title,
      description: data.description ?? null,
      status: "draft" as RfqStatus,
      currency_code: data.currencyCode,
      lines: data.lines as any,
      issue_date: data.issueDate ?? null,
      due_date: data.dueDate ?? null,
      terms: data.terms ?? null,
      created_by: (context as any).user.id,
    };
    const { data: inserted, error } = await context.supabase
      .from("rfqs")
      .insert(row as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "rfq.create", "rfqs", inserted.id, {
      title: data.title,
      project_id: data.projectId,
      line_count: data.lines.length,
    });
    return { id: inserted.id };
  });

// ---------------------------------------------------------------------------
// invite vendors
// ---------------------------------------------------------------------------
export const inviteRfqVendors = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        rfqId: z.string().uuid(),
        vendorIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ inserted: number }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: rfq, error: rfqErr } = await context.supabase
      .from("rfqs")
      .select("id, company_id, status, currency_code")
      .eq("id", data.rfqId)
      .maybeSingle();
    if (rfqErr) throw rfqErr;
    if (!rfq || (rfq as any).company_id !== companyId) httpError(404, "rfq_not_found");
    if ((rfq as any).status === "cancelled") httpError(409, "rfq_cancelled");

    // Verify all vendors belong to same company and are active.
    const { data: vendors, error: vErr } = await context.supabase
      .from("vendors")
      .select("id, status")
      .in("id", data.vendorIds);
    if (vErr) throw vErr;
    if ((vendors ?? []).length !== data.vendorIds.length) httpError(400, "vendor_invalid");
    for (const v of vendors ?? []) {
      if ((v as any).status !== "active")
        httpError(400, "vendor_not_active", "Only active vendors can be invited.");
    }

    const rows = data.vendorIds.map((vid) => ({
      company_id: companyId,
      rfq_id: data.rfqId,
      vendor_id: vid,
      status: "invited" as RfqBidStatus,
      currency_code: (rfq as any).currency_code,
      created_by: (context as any).user.id,
    }));
    const { data: inserted, error } = await context.supabase
      .from("rfq_bids")
      .upsert(rows as any, {
        onConflict: "rfq_id,vendor_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "rfq.invite", "rfqs", data.rfqId, {
      vendor_ids: data.vendorIds,
    });
    return { inserted: inserted?.length ?? 0 };
  });

export const removeRfqInvite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ bidId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: bid, error: bErr } = await context.supabase
      .from("rfq_bids")
      .select("id, rfq_id, vendor_id, status")
      .eq("id", data.bidId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bid) httpError(404, "bid_not_found");
    if ((bid as any).status !== "invited")
      httpError(409, "bid_locked", "Only 'invited' bids can be removed.");
    const { error } = await context.supabase.from("rfq_bids").delete().eq("id", data.bidId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "rfq.uninvite", "rfqs", (bid as any).rfq_id, {
      vendor_id: (bid as any).vendor_id,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// issue RFQ — assigns RFQ-#### with one retry on unique-violation
// ---------------------------------------------------------------------------
export const issueRfq = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rfqId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ rfq_number: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data: rfq, error: rfqErr } = await context.supabase
      .from("rfqs")
      .select("id, company_id, status, lines")
      .eq("id", data.rfqId)
      .maybeSingle();
    if (rfqErr) throw rfqErr;
    if (!rfq || (rfq as any).company_id !== companyId) httpError(404, "rfq_not_found");
    if ((rfq as any).status !== "draft")
      httpError(409, "rfq_not_draft", "Only drafts can be issued.");
    const lines = ((rfq as any).lines ?? []) as RfqLine[];
    if (lines.length === 0) httpError(400, "no_lines", "RFQ needs at least one line.");

    const { count: inviteCount, error: cErr } = await context.supabase
      .from("rfq_bids")
      .select("id", { count: "exact", head: true })
      .eq("rfq_id", data.rfqId);
    if (cErr) throw cErr;
    if ((inviteCount ?? 0) === 0) httpError(400, "no_invites", "Invite at least one vendor first.");

    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: existing, error: nErr } = await context.supabase
        .from("rfqs")
        .select("rfq_number")
        .eq("company_id", companyId)
        .like("rfq_number", "RFQ-%");
      if (nErr) throw nErr;
      const number = nextRfqNumber(((existing ?? []) as any[]).map((r) => r.rfq_number as string));
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await context.supabase
        .from("rfqs")
        .update({
          status: "issued",
          rfq_number: number,
          issue_date: today,
        } as any)
        .eq("id", data.rfqId);
      if (!error) {
        await audit(context, "rfq.issue", "rfqs", data.rfqId, {
          rfq_number: number,
        });
        return { rfq_number: number };
      }
      if ((error as any).code === "23505" && attempt === 0) continue;
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    httpError(500, "issue_failed", "Could not assign RFQ number.");
  });

// ---------------------------------------------------------------------------
// submit bid
// ---------------------------------------------------------------------------
const submitBidInput = z.object({
  bidId: z.string().uuid(),
  lines: bidLinesSchema,
  totalPrice: z.number().nonnegative().nullable().optional(),
  currencyCode: z.string().trim().min(3).max(3).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(1000).nullable().optional(),
  validityDate: z.string().nullable().optional(),
  attachments: z.array(bidAttachmentSchema).max(20).optional(),
});

export const submitBid = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => submitBidInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const { data: bid, error: bErr } = await context.supabase
      .from("rfq_bids")
      .select("id, rfq_id, status, company_id")
      .eq("id", data.bidId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bid) httpError(404, "bid_not_found");
    if ((bid as any).status === "awarded" || (bid as any).status === "withdrawn") {
      httpError(409, "bid_locked");
    }

    // Validate join integrity: every bid line_no must exist on the parent RFQ.
    const { data: rfq, error: rErr } = await context.supabase
      .from("rfqs")
      .select("id, status, lines")
      .eq("id", (bid as any).rfq_id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!rfq) httpError(404, "rfq_not_found");
    if ((rfq as any).status !== "issued")
      httpError(409, "rfq_not_issued", "RFQ is not accepting bids.");
    const rfqLineNos = new Set((((rfq as any).lines ?? []) as RfqLine[]).map((l) => l.line_no));
    for (const l of data.lines) {
      if (!rfqLineNos.has(l.line_no)) {
        httpError(400, "line_not_on_rfq", `Line ${l.line_no} is not on the parent RFQ.`);
      }
    }

    const patch = {
      status: "submitted" as RfqBidStatus,
      lines: data.lines as any,
      total_price: data.totalPrice ?? null,
      currency_code: data.currencyCode ?? null,
      lead_time_days: data.leadTimeDays ?? null,
      validity_date: data.validityDate ?? null,
      attachments: (data.attachments ?? []) as any,
      submitted_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("rfq_bids")
      .update(patch as any)
      .eq("id", data.bidId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "rfq.bid_submit", "rfq_bids", data.bidId, {
      rfq_id: (bid as any).rfq_id,
      line_count: data.lines.length,
      total_price: data.totalPrice ?? null,
    });
    return { ok: true };
  });

// re-export enums for UI convenience
export { RFQ_STATUSES, RFQ_BID_STATUSES };
