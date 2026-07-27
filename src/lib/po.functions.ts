// P-064 — Purchase Order server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  PO_STATUSES,
  buildPoLinesFromAwards,
  computePoTotals,
  maxSiteNeedDate,
  nextPoNumber,
  type PoLine,
  type PoStatus,
} from "@/lib/po-rules";
import type { RfqLine } from "@/lib/rfq-rules";
import { assertNotUnderChangeControl } from "@/lib/moc.exec.server";

// ---------------------------------------------------------------------------
// row types
// ---------------------------------------------------------------------------
export interface PoRow {
  id: string;
  company_id: string;
  project_id: string;
  project_name: string | null;
  vendor_id: string;
  vendor_name: string | null;
  rfq_id: string | null;
  po_number: string;
  status: PoStatus;
  currency_code: string;
  lines: PoLine[];
  subtotal: number;
  tax_pct: number;
  tax_amount: number;
  total_amount: number;
  payment_terms: string | null;
  incoterms: string | null;
  delivery_address: string | null;
  required_by_date: string | null;
  approval_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  issued_at: string | null;
  pdf_path: string | null;
  share_token: string | null;
  share_token_expires_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_email: string | null;
  acknowledgment_status: "accepted" | "accepted_with_comments" | "rejected" | null;
  acknowledgment_note: string | null;
  created_at: string;
  updated_at: string;
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
  if (!companyId) httpError(400, "no_company");
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

function toPoRow(r: any): PoRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    project_name: r.projects?.name ?? null,
    vendor_id: r.vendor_id,
    vendor_name: r.vendors?.name ?? null,
    rfq_id: r.rfq_id,
    po_number: r.po_number,
    status: r.status,
    currency_code: r.currency_code,
    lines: (r.lines ?? []) as PoLine[],
    subtotal: Number(r.subtotal ?? 0),
    tax_pct: Number(r.tax_pct ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    total_amount: Number(r.total_amount ?? 0),
    payment_terms: r.payment_terms,
    incoterms: r.incoterms,
    delivery_address: r.delivery_address,
    required_by_date: r.required_by_date,
    approval_note: r.approval_note,
    approved_by: r.approved_by,
    approved_at: r.approved_at,
    issued_at: r.issued_at,
    pdf_path: r.pdf_path,
    share_token: r.share_token ?? null,
    share_token_expires_at: r.share_token_expires_at ?? null,
    acknowledged_at: r.acknowledged_at ?? null,
    acknowledged_by: r.acknowledged_by ?? null,
    acknowledged_by_email: r.acknowledged_by_email ?? null,
    acknowledgment_status: r.acknowledgment_status ?? null,
    acknowledgment_note: r.acknowledgment_note ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return Object.fromEntries(roles.map((r, i) => [r, Boolean(results[i]?.data)]));
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getPoWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      canAuthor: boolean;
      canAward: boolean;
      canApprove: boolean;
      canEditThreshold: boolean;
    }> => {
      requireSupabaseAuth(context);
      const flags = await hasAnyRole(context, [
        "procurement_admin",
        "procurement_officer",
        "finance_admin",
        "company_admin",
      ]);
      const canAward = flags.procurement_admin || flags.company_admin;
      const canAuthor =
        flags.procurement_admin ||
        flags.procurement_officer ||
        flags.finance_admin ||
        flags.company_admin;
      const canApprove = flags.finance_admin || flags.company_admin;
      const canEditThreshold = flags.company_admin;
      return { canAuthor, canAward, canApprove, canEditThreshold };
    },
  );

// ---------------------------------------------------------------------------
// award / unaward line
// ---------------------------------------------------------------------------
const awardInput = z.object({
  rfqId: z.string().uuid(),
  bidId: z.string().uuid(),
  lineNo: z.number().int().min(1).max(9999),
  awardedQty: z.number().positive().nullable().optional(),
  awardNote: z.string().trim().max(1000).nullable().optional(),
});

export const awardRfqLine = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => awardInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    // Load RFQ + bid together for validation.
    const { data: rfq, error: rErr } = await context.supabase
      .from("rfqs")
      .select("id, company_id, status, lines")
      .eq("id", data.rfqId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!rfq || (rfq as any).company_id !== companyId) httpError(404, "rfq_not_found");
    if ((rfq as any).status !== "issued")
      httpError(409, "rfq_not_issued", "RFQ must be issued before awards.");

    const rfqLines = ((rfq as any).lines ?? []) as RfqLine[];
    const rfqLine = rfqLines.find((l) => l.line_no === data.lineNo);
    if (!rfqLine) httpError(400, "line_not_on_rfq");

    const { data: bid, error: bErr } = await context.supabase
      .from("rfq_bids")
      .select("id, rfq_id, vendor_id, company_id, status, lines")
      .eq("id", data.bidId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bid || (bid as any).rfq_id !== data.rfqId) httpError(400, "bid_not_for_rfq");
    if (!["submitted", "under_review", "awarded"].includes((bid as any).status))
      httpError(409, "bid_not_awardable");

    const bidLine = ((bid as any).lines ?? []).find((l: any) => l.line_no === data.lineNo);
    if (!bidLine) httpError(400, "bid_missing_line", "Bid does not include this line.");

    const qty = Number(data.awardedQty ?? bidLine.qty ?? rfqLine.qty);
    const unit = Number(bidLine.unit_price);
    if (!(qty > 0)) httpError(400, "invalid_qty");
    const amount = Math.round(qty * unit * 100) / 100;

    const { data: inserted, error } = await context.supabase
      .from("rfq_line_awards")
      .insert({
        company_id: companyId,
        rfq_id: data.rfqId,
        rfq_bid_id: data.bidId,
        line_no: data.lineNo,
        awarded_qty: qty,
        awarded_unit_price: unit,
        awarded_amount: amount,
        award_note: data.awardNote ?? null,
        awarded_by: (context as any).user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      if ((error as any).code === "23505")
        httpError(409, "line_already_awarded", "This line is already awarded.");
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }

    // Mark the bid awarded (any bid with ≥1 awarded line).
    await context.supabase
      .from("rfq_bids")
      .update({ status: "awarded" as any })
      .eq("id", data.bidId);

    await audit(context, "rfq.award", "rfq_line_awards", (inserted as any).id, {
      rfq_id: data.rfqId,
      bid_id: data.bidId,
      line_no: data.lineNo,
      qty,
      unit_price: unit,
      amount,
    });
    return { id: (inserted as any).id };
  });

export const unawardRfqLine = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ awardId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);

    // Single transactional RPC: deletes the award row AND reverts the bid
    // status in one statement, so award-row and bid.status can never drift.
    const { data: result, error } = await (context.supabase as any).rpc("rfq_unaward_line", {
      p_award_id: data.awardId,
    });
    if (error) {
      const msg = String((error as any).message ?? "");
      if (msg.includes("award_not_found")) httpError(404, "award_not_found");
      if (msg.includes("award_locked"))
        httpError(409, "award_locked", "POs already exist for this RFQ — cannot unaward.");
      if (msg.includes("forbidden") || (error as any).code === "42501")
        httpError(403, "forbidden");
      throw error;
    }

    await audit(context, "rfq.unaward", "rfq_line_awards", data.awardId, {
      rfq_id: (result as any)?.rfq_id ?? null,
      line_no: (result as any)?.line_no ?? null,
      bid_id: (result as any)?.bid_id ?? null,
      bid_reverted: (result as any)?.bid_reverted ?? false,
    });
    return { ok: true };

  });

// ---------------------------------------------------------------------------
// generate POs from awards
// ---------------------------------------------------------------------------
export const generatePosFromAwards = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rfqId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ created: number; skipped: number }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data: rfq, error: rErr } = await context.supabase
      .from("rfqs")
      .select("id, company_id, project_id, currency_code, lines, status")
      .eq("id", data.rfqId)
      .maybeSingle();
    if (rErr) throw rErr;
    if (!rfq || (rfq as any).company_id !== companyId) httpError(404, "rfq_not_found");

    const rfqLines = ((rfq as any).lines ?? []) as RfqLine[];
    if (rfqLines.length === 0) httpError(400, "no_lines");

    const { data: awards, error: aErr } = await context.supabase
      .from("rfq_line_awards")
      .select("id, line_no, rfq_bid_id, awarded_qty, awarded_unit_price, award_note")
      .eq("rfq_id", data.rfqId);
    if (aErr) throw aErr;
    const awardRows = (awards ?? []) as any[];

    if (awardRows.length !== rfqLines.length) {
      httpError(
        409,
        "awards_incomplete",
        `Award every line first (${awardRows.length}/${rfqLines.length}).`,
      );
    }

    // Load vendor per bid.
    const bidIds = Array.from(new Set(awardRows.map((a) => a.rfq_bid_id)));
    const { data: bids, error: bErr } = await context.supabase
      .from("rfq_bids")
      .select(
        "id, vendor_id, vendors:vendor_id(id, name, payment_terms, incoterms, address_line, city, country)",
      )
      .in("id", bidIds);
    if (bErr) throw bErr;
    const bidByIdMap = new Map(((bids ?? []) as any[]).map((b) => [b.id, b]));

    // Existing POs for this RFQ → idempotency.
    const { data: existing, error: eErr } = await context.supabase
      .from("purchase_orders")
      .select("id, vendor_id")
      .eq("rfq_id", data.rfqId);
    if (eErr) throw eErr;
    const existingVendorSet = new Set(((existing ?? []) as any[]).map((p) => p.vendor_id));

    // Group awards by vendor.
    const byVendor = new Map<string, typeof awardRows>();
    for (const a of awardRows) {
      const bid = bidByIdMap.get(a.rfq_bid_id);
      const vendorId = bid?.vendor_id;
      if (!vendorId) continue;
      if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
      byVendor.get(vendorId)!.push(a);
    }

    // For per-company PO sequence we fetch once and increment locally.
    const { data: numRows, error: nErr } = await context.supabase
      .from("purchase_orders")
      .select("po_number")
      .eq("company_id", companyId)
      .like("po_number", "PO-%");
    if (nErr) throw nErr;
    let seedNumbers = ((numRows ?? []) as any[]).map((r) => r.po_number as string);

    let created = 0;
    let skipped = 0;
    for (const [vendorId, group] of byVendor) {
      if (existingVendorSet.has(vendorId)) {
        skipped++;
        continue;
      }
      const bid = bidByIdMap.get(group[0].rfq_bid_id);
      const vendor = bid?.vendors ?? null;

      const lines = buildPoLinesFromAwards(
        rfqLines,
        group.map((a) => ({
          line_no: a.line_no,
          awarded_qty: Number(a.awarded_qty),
          awarded_unit_price: Number(a.awarded_unit_price),
        })),
      );
      const totals = computePoTotals(lines, 0);

      // One retry on 23505 (po_number collision).
      let insertedId: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const poNumber = nextPoNumber(seedNumbers);
        const deliveryAddress = vendor
          ? [vendor.address_line, vendor.city, vendor.country].filter(Boolean).join(", ") || null
          : null;
        const row = {
          company_id: companyId,
          project_id: (rfq as any).project_id,
          vendor_id: vendorId,
          rfq_id: data.rfqId,
          po_number: poNumber,
          status: "draft" as PoStatus,
          currency_code: (rfq as any).currency_code,
          lines: lines as any,
          subtotal: totals.subtotal,
          tax_pct: 0,
          tax_amount: totals.tax_amount,
          total_amount: totals.total_amount,
          payment_terms: vendor?.payment_terms ?? null,
          incoterms: vendor?.incoterms ?? null,
          delivery_address: deliveryAddress,
          required_by_date: maxSiteNeedDate(lines),
          created_by: (context as any).user.id,
        };
        const { data: inserted, error } = await context.supabase
          .from("purchase_orders")
          .insert(row as any)
          .select("id, po_number, total_amount")
          .single();
        if (!error) {
          insertedId = (inserted as any).id;
          seedNumbers.push((inserted as any).po_number);
          await audit(context, "po.create", "purchase_orders", (inserted as any).id, {
            rfq_id: data.rfqId,
            vendor_id: vendorId,
            po_number: (inserted as any).po_number,
            total_amount: (inserted as any).total_amount,
          });
          break;
        }
        if ((error as any).code === "23505" && attempt === 0) {
          // Refresh sequence and retry once.
          const { data: refresh } = await context.supabase
            .from("purchase_orders")
            .select("po_number")
            .eq("company_id", companyId)
            .like("po_number", "PO-%");
          seedNumbers = ((refresh ?? []) as any[]).map((r) => r.po_number as string);
          continue;
        }
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      if (insertedId) created++;
    }
    return { created, skipped };
  });

// ---------------------------------------------------------------------------
// list / get
// ---------------------------------------------------------------------------
const listInput = z.object({
  search: z.string().nullable().optional(),
  status: z.enum(PO_STATUSES).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export const listPos = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PoRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("purchase_orders")
      .select("*, projects:project_id(name), vendors:vendor_id(name)")
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.ilike("po_number", `%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toPoRow);
  });

export const getPo = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PoRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("purchase_orders")
      .select("*, projects:project_id(name), vendors:vendor_id(name)")
      .eq("id", data.poId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "po_not_found");
    return toPoRow(row);
  });

// ---------------------------------------------------------------------------
// approval flow
// ---------------------------------------------------------------------------
export const submitPoForApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        poId: z.string().uuid(),
        note: z.string().trim().max(1000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ status: PoStatus; auto_approved: boolean }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);

    const { data: po, error: pErr } = await context.supabase
      .from("purchase_orders")
      .select("id, status, total_amount, company_id")
      .eq("id", data.poId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!po || (po as any).company_id !== companyId) httpError(404, "po_not_found");
    if ((po as any).status !== "draft") httpError(409, "po_not_draft");

    const { data: co, error: cErr } = await context.supabase
      .from("companies")
      .select("po_approval_threshold")
      .eq("id", companyId)
      .maybeSingle();
    if (cErr) throw cErr;
    const threshold = Number((co as any)?.po_approval_threshold ?? 0);
    const total = Number((po as any).total_amount ?? 0);

    if (total > threshold) {
      const { error } = await context.supabase
        .from("purchase_orders")
        .update({
          status: "pending_approval" as PoStatus,
          approval_note: data.note ?? null,
        } as any)
        .eq("id", data.poId);
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }
      await audit(context, "po.submit", "purchase_orders", data.poId, {
        total_amount: total,
        threshold,
        outcome: "pending_approval",
      });
      return { status: "pending_approval", auto_approved: false };
    }

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("purchase_orders")
      .update({
        status: "approved" as PoStatus,
        approval_note: "Auto-approved (below threshold)",
        approved_by: (context as any).user.id,
        approved_at: now,
      } as any)
      .eq("id", data.poId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "po.submit", "purchase_orders", data.poId, {
      total_amount: total,
      threshold,
      outcome: "auto_approved",
    });
    return { status: "approved", auto_approved: true };
  });

export const approvePo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        poId: z.string().uuid(),
        note: z.string().trim().min(1, "Note required").max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, ["finance_admin", "company_admin"]);
    if (!flags.finance_admin && !flags.company_admin)
      httpError(403, "forbidden", "Only finance_admin or company_admin can approve.");

    const { data: po, error: pErr } = await context.supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", data.poId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!po) httpError(404, "po_not_found");
    if ((po as any).status !== "pending_approval") httpError(409, "po_not_pending");

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("purchase_orders")
      .update({
        status: "approved" as PoStatus,
        approval_note: data.note,
        approved_by: (context as any).user.id,
        approved_at: now,
      } as any)
      .eq("id", data.poId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "po.approve", "purchase_orders", data.poId, {
      note: data.note,
    });
    return { ok: true };
  });

export const rejectPo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        poId: z.string().uuid(),
        note: z.string().trim().min(1, "Note required").max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, ["finance_admin", "company_admin"]);
    if (!flags.finance_admin && !flags.company_admin) httpError(403, "forbidden");

    const { data: po, error: pErr } = await context.supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", data.poId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!po) httpError(404, "po_not_found");
    if ((po as any).status !== "pending_approval") httpError(409, "po_not_pending");

    const { error } = await context.supabase
      .from("purchase_orders")
      .update({
        status: "draft" as PoStatus,
        approval_note: data.note,
        approved_by: null,
        approved_at: null,
      } as any)
      .eq("id", data.poId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "po.reject", "purchase_orders", data.poId, {
      note: data.note,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// PDF generation + storage
// ---------------------------------------------------------------------------
async function loadPoForPdf(
  context: AuthContext,
  poId: string,
): Promise<{
  companyId: string;
  poNumber: string;
  input: import("@/lib/exports/po-pdf").PoPdfInput;
}> {
  const { data: row, error } = await context.supabase
    .from("purchase_orders")
    .select(
      `id, company_id, po_number, status, currency_code, lines, subtotal,
       tax_pct, tax_amount, total_amount, payment_terms, incoterms,
       delivery_address, required_by_date, issued_at, created_at,
       vendors ( name, address ),
       projects ( name )`,
    )
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!row) httpError(404, "po_not_found");
  const r = row as any;

  const [{ data: company }, { data: branding }] = await Promise.all([
    context.supabase
      .from("companies")
      .select("name, legal_name, contact_email, phone, address")
      .eq("id", r.company_id)
      .maybeSingle(),
    context.supabase
      .from("company_branding")
      .select("primary_color, accent_color, footer_text, logo_url")
      .eq("company_id", r.company_id)
      .maybeSingle(),
  ]);

  let logoSignedUrl: string | null = null;
  const logoPath = (branding as any)?.logo_url as string | null;
  if (logoPath) {
    const { data: signed } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(logoPath, 300);
    logoSignedUrl = signed?.signedUrl ?? null;
  }

  return {
    companyId: r.company_id,
    poNumber: r.po_number,
    input: {
      po: {
        id: r.id,
        po_number: r.po_number,
        status: r.status,
        currency_code: r.currency_code,
        lines: (r.lines ?? []) as any,
        subtotal: Number(r.subtotal ?? 0),
        tax_pct: Number(r.tax_pct ?? 0),
        tax_amount: Number(r.tax_amount ?? 0),
        total_amount: Number(r.total_amount ?? 0),
        payment_terms: r.payment_terms,
        incoterms: r.incoterms,
        delivery_address: r.delivery_address,
        required_by_date: r.required_by_date,
        issued_at: r.issued_at,
        created_at: r.created_at,
      },
      vendor: r.vendors
        ? { name: r.vendors.name, address: (r.vendors as any).address ?? null }
        : null,
      project: r.projects ? { name: r.projects.name } : null,
      company: (company as any) ?? { name: "" },
      branding: {
        primaryColor: (branding as any)?.primary_color ?? null,
        accentColor: (branding as any)?.accent_color ?? null,
        footerText: (branding as any)?.footer_text ?? null,
        logoSignedUrl,
      },
    },
  };
}

async function generateAndStorePoPdf(context: AuthContext, poId: string): Promise<string> {
  const { companyId, input } = await loadPoForPdf(context, poId);
  const { buildPoPdfBytes } = await import("@/lib/exports/po-pdf");
  const bytes = await buildPoPdfBytes(input);
  // FIRST path segment MUST be the company UUID — storage RLS enforces this.
  const path = `${companyId}/po/${poId}.pdf`;

  const { error: upErr } = await context.supabase.storage.from("documents").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upErr) throw upErr;

  await context.supabase
    .from("purchase_orders")
    .update({ pdf_path: path } as any)
    .eq("id", poId);

  return path;
}

export const issuePo = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        poId: z.string().uuid(),
        overrideReason: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; pdfPath: string }> => {
    requireSupabaseAuth(context);
    // P-191 — an open change request freezes this order (admins may override).
    await assertNotUnderChangeControl(context, "purchase_order", data.poId, data.overrideReason);
    const { data: po, error: pErr } = await context.supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", data.poId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!po) httpError(404, "po_not_found");
    if ((po as any).status !== "approved")
      httpError(409, "po_not_approved", "PO must be approved before issue.");

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("purchase_orders")
      .update({ status: "issued" as PoStatus, issued_at: now } as any)
      .eq("id", data.poId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }

    let pdfPath = "";
    try {
      pdfPath = await generateAndStorePoPdf(context, data.poId);
    } catch (e) {
      // Don't roll back the issue — surface path failure but keep the transition.
      console.error("[po.issue] pdf generation failed", e);
    }

    await audit(context, "po.issue", "purchase_orders", data.poId, {
      pdf_path: pdfPath || null,
    });
    return { ok: true, pdfPath };
  });

/** Signed URL for the authenticated authoring UI. Regenerates if missing. */
export const getPoPdfDownloadUrl = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const { data: po, error } = await context.supabase
      .from("purchase_orders")
      .select("id, company_id, pdf_path")
      .eq("id", data.poId)
      .maybeSingle();
    if (error) throw error;
    if (!po) httpError(404, "po_not_found");

    let path = (po as any).pdf_path as string | null;
    if (!path) {
      path = await generateAndStorePoPdf(context, data.poId);
    }
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(path, 300);
    if (sErr) return { url: null };
    return { url: signed?.signedUrl ?? null };
  });

// ---------------------------------------------------------------------------
// Vendor share link
// ---------------------------------------------------------------------------
const SHARE_TTL_DAYS = 14;

export const createPoShareLink = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ token: string; expiresAt: string }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, [
      "procurement_admin",
      "procurement_officer",
      "finance_admin",
      "company_admin",
    ]);
    if (!Object.values(flags).some(Boolean)) httpError(403, "forbidden");

    const { data: po, error } = await context.supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", data.poId)
      .maybeSingle();
    if (error) throw error;
    if (!po) httpError(404, "po_not_found");
    if (!["approved", "issued", "partially_received", "received"].includes((po as any).status))
      httpError(409, "po_not_shareable", "PO must be approved before sharing with a vendor.");

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: uErr } = await context.supabase
      .from("purchase_orders")
      .update({
        share_token: token,
        share_token_expires_at: expiresAt,
      } as any)
      .eq("id", data.poId);
    if (uErr) {
      if ((uErr as any).code === "42501") httpError(403, "forbidden");
      throw uErr;
    }
    await audit(context, "po.share_link_create", "purchase_orders", data.poId, {
      expires_at: expiresAt,
    });
    return { token, expiresAt };
  });

export const revokePoShareLink = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("purchase_orders")
      .update({ share_token_expires_at: now } as any)
      .eq("id", data.poId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "po.share_link_revoke", "purchase_orders", data.poId, {});
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Public vendor lookup (unauthenticated). No requireSupabaseAuth.
// ---------------------------------------------------------------------------
export interface PublicPoView {
  po_number: string;
  status: string;
  currency_code: string;
  lines: Array<{
    line_no: number;
    description: string;
    spec: string | null;
    qty: number;
    uom: string;
    unit_price: number;
    amount: number;
    site_need_date: string | null;
  }>;
  subtotal: number;
  tax_pct: number;
  tax_amount: number;
  total_amount: number;
  payment_terms: string | null;
  incoterms: string | null;
  delivery_address: string | null;
  required_by_date: string | null;
  issued_at: string | null;
  vendor_name: string | null;
  project_name: string | null;
  company_name: string;
  primary_color: string | null;
  accent_color: string | null;
  footer_text: string | null;
  pdf_url: string | null;
}

export const getPoByShareToken = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PublicPoView> => {
    // No requireSupabaseAuth — this is intentionally public.
    // The SECURITY DEFINER RPC enforces token + expiry server-side, and it is
    // only reachable through this server function (EXECUTE revoked from
    // anon/authenticated), so it runs with the service-role client here.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_po_by_share_token", {
      p_token: data.token,
    });

    if (error) throw error;
    const row = (rows as any[] | null)?.[0];
    if (!row) httpError(410, "share_link_expired", "This link is no longer valid.");

    // Signed URL for the PDF — vendors aren't company members, so RLS blocks
    // them from storage.objects. The token has already been verified above,
    // so a short-lived service-role signed URL is scoped narrowly enough.
    let pdfUrl: string | null = null;
    if (row.pdf_path) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: signed } = await supabaseAdmin.storage
          .from("documents")
          .createSignedUrl(row.pdf_path, 300);
        pdfUrl = signed?.signedUrl ?? null;
      } catch (e) {
        console.error("[po.share] signed url failed", e);
      }
    }

    return {
      po_number: row.po_number,
      status: row.status,
      currency_code: row.currency_code,
      lines: (row.lines ?? []) as any,
      subtotal: Number(row.subtotal ?? 0),
      tax_pct: Number(row.tax_pct ?? 0),
      tax_amount: Number(row.tax_amount ?? 0),
      total_amount: Number(row.total_amount ?? 0),
      payment_terms: row.payment_terms,
      incoterms: row.incoterms,
      delivery_address: row.delivery_address,
      required_by_date: row.required_by_date,
      issued_at: row.issued_at,
      vendor_name: row.vendor_name,
      project_name: row.project_name,
      company_name: row.company_name,
      primary_color: row.primary_color,
      accent_color: row.accent_color,
      footer_text: row.footer_text,
      pdf_url: pdfUrl,
    };
  });

// ---------------------------------------------------------------------------
// threshold
// ---------------------------------------------------------------------------
export const getPoApprovalThreshold = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ threshold: number }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("companies")
      .select("po_approval_threshold")
      .eq("id", companyId)
      .maybeSingle();
    if (error) throw error;
    return { threshold: Number((data as any)?.po_approval_threshold ?? 0) };
  });

export const setPoApprovalThreshold = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ threshold: z.number().nonnegative().max(99_999_999) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ threshold: number }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, ["company_admin"]);
    if (!flags.company_admin) httpError(403, "forbidden");
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("companies")
      .update({ po_approval_threshold: data.threshold } as any)
      .eq("id", companyId);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "company.po_threshold_update", "companies", companyId, {
      threshold: data.threshold,
    });
    return { threshold: data.threshold };
  });

// list of awards for an RFQ (UI convenience)
export const listRfqAwards = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rfqId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<
      Array<{
        id: string;
        rfq_id: string;
        rfq_bid_id: string;
        line_no: number;
        awarded_qty: number;
        awarded_unit_price: number;
        awarded_amount: number;
      }>
    > => {
      requireSupabaseAuth(context);
      const { data: rows, error } = await context.supabase
        .from("rfq_line_awards")
        .select("id, rfq_id, rfq_bid_id, line_no, awarded_qty, awarded_unit_price, awarded_amount")
        .eq("rfq_id", data.rfqId);
      if (error) throw error;
      return ((rows ?? []) as any[]).map((r) => ({
        id: r.id,
        rfq_id: r.rfq_id,
        rfq_bid_id: r.rfq_bid_id,
        line_no: r.line_no,
        awarded_qty: Number(r.awarded_qty),
        awarded_unit_price: Number(r.awarded_unit_price),
        awarded_amount: Number(r.awarded_amount),
      }));
    },
  );

/** True when at least one PO already references this RFQ (awards become locked). */
export const rfqHasPos = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rfqId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ hasPos: boolean; count: number }> => {
    requireSupabaseAuth(context);
    const { count, error } = await context.supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("rfq_id", data.rfqId);
    if (error) throw error;
    return { hasPos: (count ?? 0) > 0, count: count ?? 0 };
  });

// re-exports for UI
export { PO_STATUSES };

