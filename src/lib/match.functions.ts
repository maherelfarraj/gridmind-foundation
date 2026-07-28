// P-067 — Three-way match server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  MATCH_STATUSES,
  amountVariancePct,
  assertInvoicePath,
  computeVariances,
  deriveMatchStatus,
  matchCreatePayload,
  matchOverridePayload,
  matchThresholdPayload,
  type MatchStatus,
} from "@/lib/match-rules";
import type { PoLine } from "@/lib/po-rules";
import type { GrnLine } from "@/lib/grn-rules";

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

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<Record<string, boolean>> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return Object.fromEntries(roles.map((r, i) => [r, Boolean(results[i]?.data)]));
}

async function requireWriter(context: AuthContext) {
  const flags = await hasAnyRole(context, ["procurement_admin", "finance_admin", "company_admin"]);
  if (!Object.values(flags).some(Boolean)) httpError(403, "forbidden");
  return flags;
}

async function requireFinance(context: AuthContext) {
  const flags = await hasAnyRole(context, ["finance_admin", "company_admin"]);
  if (!Object.values(flags).some(Boolean)) httpError(403, "forbidden");
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "three_way_matches",
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* audit is best-effort */
  }
}

async function loadPoForMatch(
  context: AuthContext,
  poId: string,
): Promise<{
  id: string;
  company_id: string;
  po_number: string;
  currency_code: string;
  lines: PoLine[];
  total_amount: number;
  vendor_name: string | null;
}> {
  const { data, error } = await context.supabase
    .from("purchase_orders")
    .select(
      "id, company_id, po_number, currency_code, lines, total_amount, vendors:vendor_id(name)",
    )
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "po_not_found");
  return {
    id: (data as any).id,
    company_id: (data as any).company_id,
    po_number: (data as any).po_number,
    currency_code: (data as any).currency_code,
    lines: ((data as any).lines ?? []) as PoLine[],
    total_amount: Number((data as any).total_amount ?? 0),
    vendor_name: (data as any).vendors?.name ?? null,
  };
}

async function receivedQtyByLine(context: AuthContext, poId: string): Promise<Map<number, number>> {
  const { data, error } = await context.supabase
    .from("goods_receipts")
    .select("lines, status")
    .eq("po_id", poId)
    .in("status", ["confirmed", "has_defects", "closed"]);
  if (error) throw error;
  const acc = new Map<number, number>();
  for (const r of (data ?? []) as any[]) {
    for (const l of (r.lines ?? []) as GrnLine[]) {
      acc.set(l.po_line_no, (acc.get(l.po_line_no) ?? 0) + Number(l.qty_received || 0));
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// row + list
// ---------------------------------------------------------------------------
export interface MatchRow {
  id: string;
  company_id: string;
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  goods_receipt_id: string | null;
  grn_number: string | null;
  vendor_invoice_number: string;
  invoice_date: string | null;
  invoice_amount: number;
  invoice_currency_code: string;
  invoice_file_path: string | null;
  invoice_file_url: string | null;
  status: MatchStatus;
  qty_variance_pct: number | null;
  price_variance_pct: number | null;
  amount_variance: number | null;
  variance_threshold_pct: number;
  payment_release_blocked: boolean;
  resolution_note: string | null;
  matched_by: string | null;
  matched_at: string | null;
  po_total: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

async function signInvoice(context: AuthContext, path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await context.supabase.storage.from("documents").createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

async function toMatchRow(context: AuthContext, r: any): Promise<MatchRow> {
  return {
    id: r.id,
    company_id: r.company_id,
    po_id: r.po_id,
    po_number: r.purchase_orders?.po_number ?? null,
    vendor_name: r.purchase_orders?.vendors?.name ?? null,
    goods_receipt_id: r.goods_receipt_id ?? null,
    grn_number: r.goods_receipts?.grn_number ?? null,
    vendor_invoice_number: r.vendor_invoice_number,
    invoice_date: r.invoice_date,
    invoice_amount: Number(r.invoice_amount ?? 0),
    invoice_currency_code: r.invoice_currency_code,
    invoice_file_path: r.invoice_file_path,
    invoice_file_url: await signInvoice(context, r.invoice_file_path),
    status: r.status as MatchStatus,
    qty_variance_pct: r.qty_variance_pct == null ? null : Number(r.qty_variance_pct),
    price_variance_pct: r.price_variance_pct == null ? null : Number(r.price_variance_pct),
    amount_variance: r.amount_variance == null ? null : Number(r.amount_variance),
    variance_threshold_pct: Number(r.variance_threshold_pct ?? 0),
    payment_release_blocked: Boolean(r.payment_release_blocked),
    resolution_note: r.resolution_note,
    matched_by: r.matched_by,
    matched_at: r.matched_at,
    po_total: Number(r.purchase_orders?.total_amount ?? 0),
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// listMatches / getMatch
// ---------------------------------------------------------------------------
const listInput = z.object({
  status: z.enum(MATCH_STATUSES).nullable().optional(),
  poId: z.string().uuid().nullable().optional(),
  search: z.string().nullable().optional(),
});

export const listMatches = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<MatchRow[]> => {
    requireSupabaseAuth(context);
    let q = context.supabase
      .from("three_way_matches")
      .select(
        "*, purchase_orders:po_id(po_number, total_amount, vendors:vendor_id(name)), goods_receipts:goods_receipt_id(grn_number)",
      )
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.poId) q = q.eq("po_id", data.poId);
    if (data.search && data.search.trim().length > 0) {
      const s = data.search.trim().replace(/[%_]/g, "");
      q = q.ilike("vendor_invoice_number", `%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return Promise.all(((rows ?? []) as any[]).map((r) => toMatchRow(context, r)));
  });

export const getMatch = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ matchId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MatchRow> => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("three_way_matches")
      .select(
        "*, purchase_orders:po_id(po_number, total_amount, vendors:vendor_id(name)), goods_receipts:goods_receipt_id(grn_number)",
      )
      .eq("id", data.matchId)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "match_not_found");
    return toMatchRow(context, row);
  });

// ---------------------------------------------------------------------------
// context helpers for the form
// ---------------------------------------------------------------------------
export interface MatchContext {
  po_id: string;
  po_number: string;
  vendor_name: string | null;
  currency_code: string;
  po_total: number;
  lines: Array<{
    po_line_no: number;
    description: string;
    uom: string;
    qty_ordered: number;
    qty_received: number;
    unit_price: number;
  }>;
  goods_receipts: Array<{ id: string; grn_number: string; status: string }>;
}

export const getMatchContextForPo = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<MatchContext> => {
    requireSupabaseAuth(context);
    const po = await loadPoForMatch(context, data.poId);
    const received = await receivedQtyByLine(context, po.id);
    const { data: grns } = await context.supabase
      .from("goods_receipts")
      .select("id, grn_number, status")
      .eq("po_id", po.id)
      .in("status", ["confirmed", "has_defects", "closed"])
      .order("created_at", { ascending: false });
    return {
      po_id: po.id,
      po_number: po.po_number,
      vendor_name: po.vendor_name,
      currency_code: po.currency_code,
      po_total: po.total_amount,
      lines: po.lines.map((l) => ({
        po_line_no: l.line_no,
        description: l.description,
        uom: l.uom,
        qty_ordered: Number(l.qty || 0),
        qty_received: Number(received.get(l.line_no) ?? 0),
        unit_price: Number(l.unit_price || 0),
      })),
      goods_receipts: ((grns ?? []) as any[]).map((g) => ({
        id: g.id,
        grn_number: g.grn_number,
        status: g.status,
      })),
    };
  });

export const listMatchablePos = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      Array<{
        id: string;
        po_number: string;
        vendor_name: string | null;
        total_amount: number;
        currency_code: string;
        status: string;
      }>
    > => {
      requireSupabaseAuth(context);
      const { data, error } = await context.supabase
        .from("purchase_orders")
        .select("id, po_number, status, currency_code, total_amount, vendors:vendor_id(name)")
        .in("status", ["issued", "partially_received", "received", "closed"])
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        po_number: r.po_number,
        vendor_name: r.vendors?.name ?? null,
        total_amount: Number(r.total_amount ?? 0),
        currency_code: r.currency_code,
        status: r.status,
      }));
    },
  );

// ---------------------------------------------------------------------------
// createMatch
// ---------------------------------------------------------------------------
export const createMatch = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => matchCreatePayload.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      id: string;
      status: MatchStatus;
      payment_release_blocked: boolean;
    }> => {
      requireSupabaseAuth(context);
      await requireWriter(context);
      const companyId = await currentCompanyId(context);

      const po = await loadPoForMatch(context, data.poId);
      if (po.company_id !== companyId) httpError(404, "po_not_found");

      // Optional GRN link — must belong to same PO/company.
      if (data.goodsReceiptId) {
        const { data: grn, error: gErr } = await context.supabase
          .from("goods_receipts")
          .select("id, po_id, company_id")
          .eq("id", data.goodsReceiptId)
          .maybeSingle();
        if (gErr) throw gErr;
        if (!grn || (grn as any).company_id !== companyId || (grn as any).po_id !== po.id)
          httpError(400, "invalid_grn");
      }

      const grnQty = await receivedQtyByLine(context, po.id);
      const poLinesForMatch = po.lines.map((l) => ({
        po_line_no: l.line_no,
        qty: Number(l.qty || 0),
        unit_price: Number(l.unit_price || 0),
      }));
      const invoiceLinesForMatch = data.invoice_lines?.map((l) => ({
        po_line_no: l.po_line_no,
        qty: l.qty,
        unit_price: l.unit_price ?? null,
      }));
      // Partial deliveries invoice the received scope, not the whole PO —
      // price the received qty of the invoiced lines at PO rates.
      const expectedAmount =
        data.goodsReceiptId && invoiceLinesForMatch && invoiceLinesForMatch.length > 0
          ? invoiceLinesForMatch.reduce((sum, inv) => {
              const poLine = poLinesForMatch.find((l) => l.po_line_no === inv.po_line_no);
              const received = Number(grnQty.get(inv.po_line_no) ?? 0);
              return sum + received * Number(poLine?.unit_price ?? 0);
            }, 0)
          : null;
      const variances = computeVariances({
        poTotal: po.total_amount,
        poLines: poLinesForMatch,
        grnQtyByLine: grnQty,
        invoiceAmount: data.invoice_amount,
        invoiceLines: invoiceLinesForMatch,
        expectedAmount,
      });
      const threshold = data.variance_threshold_pct ?? 5;
      const derived = deriveMatchStatus({
        variances,
        poTotal: po.total_amount,
        expectedAmount,
        thresholdPct: threshold,
      });
      const blocked = derived === "variance_blocked";

      const { data: inserted, error } = await context.supabase
        .from("three_way_matches")
        .insert({
          company_id: companyId,
          po_id: po.id,
          goods_receipt_id: data.goodsReceiptId ?? null,
          vendor_invoice_number: data.vendor_invoice_number,
          invoice_date: data.invoice_date ?? null,
          invoice_amount: data.invoice_amount,
          invoice_currency_code: data.invoice_currency_code ?? po.currency_code,
          status: derived,
          qty_variance_pct: variances.qty_variance_pct,
          price_variance_pct: variances.price_variance_pct,
          amount_variance: variances.amount_variance,
          variance_threshold_pct: threshold,
          payment_release_blocked: blocked,
          matched_by: blocked ? null : (context as any).user.id,
          matched_at: blocked ? null : new Date().toISOString(),
          created_by: (context as any).user.id,
        } as any)
        .select("id")
        .single();
      if (error) {
        if ((error as any).code === "42501") httpError(403, "forbidden");
        throw error;
      }

      const id = (inserted as any).id as string;
      await audit(context, "match.create", id, {
        po_id: po.id,
        po_number: po.po_number,
        vendor_invoice_number: data.vendor_invoice_number,
        invoice_amount: data.invoice_amount,
        amount_variance: variances.amount_variance,
        qty_variance_pct: variances.qty_variance_pct,
        price_variance_pct: variances.price_variance_pct,
        status: derived,
      });
      if (blocked) {
        await audit(context, "match.block", id, {
          po_id: po.id,
          amount_variance_pct: amountVariancePct(variances.amount_variance, po.total_amount),
          threshold_pct: threshold,
        });
      }

      return {
        id,
        status: derived,
        payment_release_blocked: blocked,
      };
    },
  );

// ---------------------------------------------------------------------------
// attachInvoiceFile
// ---------------------------------------------------------------------------
export const attachInvoiceFile = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        matchId: z.string().uuid(),
        path: z.string().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await requireWriter(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("three_way_matches")
      .select("id, company_id")
      .eq("id", data.matchId)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).company_id !== companyId) httpError(404, "match_not_found");

    assertInvoicePath(data.path, companyId, data.matchId);

    const { error: uErr } = await context.supabase
      .from("three_way_matches")
      .update({ invoice_file_path: data.path } as any)
      .eq("id", data.matchId);
    if (uErr) {
      if ((uErr as any).code === "42501") httpError(403, "forbidden");
      throw uErr;
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// overrideMatchVariance (finance-admin only)
// ---------------------------------------------------------------------------
export const overrideMatchVariance = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => matchOverridePayload.parse(input))
  .handler(async ({ data, context }): Promise<{ status: MatchStatus }> => {
    requireSupabaseAuth(context);
    await requireFinance(context);
    const companyId = await currentCompanyId(context);

    const { data: row, error } = await context.supabase
      .from("three_way_matches")
      .select("id, company_id, status")
      .eq("id", data.matchId)
      .maybeSingle();
    if (error) throw error;
    if (!row || (row as any).company_id !== companyId) httpError(404, "match_not_found");
    if ((row as any).status !== "variance_blocked")
      httpError(409, "not_blocked", "Only variance-blocked matches can be overridden.");

    const { error: uErr } = await context.supabase
      .from("three_way_matches")
      .update({
        status: "approved_with_variance" as MatchStatus,
        payment_release_blocked: false,
        resolution_note: data.resolution_note,
        matched_by: (context as any).user.id,
        matched_at: new Date().toISOString(),
      } as any)
      .eq("id", data.matchId);
    if (uErr) {
      if ((uErr as any).code === "42501") httpError(403, "forbidden");
      throw uErr;
    }

    await audit(context, "match.override", data.matchId, {
      from_status: "variance_blocked",
      note: data.resolution_note,
    });
    return { status: "approved_with_variance" };
  });

// ---------------------------------------------------------------------------
// updateMatchThreshold — recompute status against stored variances
// ---------------------------------------------------------------------------
export const updateMatchThreshold = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => matchThresholdPayload.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: MatchStatus; payment_release_blocked: boolean }> => {
      requireSupabaseAuth(context);
      await requireFinance(context);
      const companyId = await currentCompanyId(context);

      const { data: row, error } = await context.supabase
        .from("three_way_matches")
        .select(
          "id, company_id, status, qty_variance_pct, price_variance_pct, amount_variance, po_id, purchase_orders:po_id(total_amount)",
        )
        .eq("id", data.matchId)
        .maybeSingle();
      if (error) throw error;
      if (!row || (row as any).company_id !== companyId) httpError(404, "match_not_found");
      // Once overridden the threshold stays informational; we won't downgrade.
      if ((row as any).status === "approved_with_variance") {
        return { status: "approved_with_variance", payment_release_blocked: false };
      }

      const poTotal = Number((row as any).purchase_orders?.total_amount ?? 0);
      const derived = deriveMatchStatus({
        variances: {
          qty_variance_pct:
            (row as any).qty_variance_pct == null ? null : Number((row as any).qty_variance_pct),
          price_variance_pct:
            (row as any).price_variance_pct == null
              ? null
              : Number((row as any).price_variance_pct),
          amount_variance: Number((row as any).amount_variance ?? 0),
        },
        poTotal,
        thresholdPct: data.variance_threshold_pct,
      });
      const blocked = derived === "variance_blocked";

      const { error: uErr } = await context.supabase
        .from("three_way_matches")
        .update({
          variance_threshold_pct: data.variance_threshold_pct,
          status: derived,
          payment_release_blocked: blocked,
          matched_by: blocked ? null : (context as any).user.id,
          matched_at: blocked ? null : new Date().toISOString(),
        } as any)
        .eq("id", data.matchId);
      if (uErr) {
        if ((uErr as any).code === "42501") httpError(403, "forbidden");
        throw uErr;
      }

      await audit(context, "match.threshold_update", data.matchId, {
        threshold_pct: data.variance_threshold_pct,
        derived_status: derived,
      });
      return { status: derived, payment_release_blocked: blocked };
    },
  );

// ---------------------------------------------------------------------------
// KPI — avg abs amount variance % in current quarter
// ---------------------------------------------------------------------------
function currentQuarterStart(now = new Date()): string {
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)).toISOString();
}

export const getMatchVarianceKpi = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ avgPct: number; count: number }> => {
    requireSupabaseAuth(context);
    const since = currentQuarterStart();
    const { data, error } = await context.supabase
      .from("three_way_matches")
      .select("amount_variance, purchase_orders:po_id(total_amount), created_at")
      .gte("created_at", since);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    const pcts = rows
      .map((r) => {
        const total = Number(r.purchase_orders?.total_amount ?? 0);
        if (!total) return null;
        return (Math.abs(Number(r.amount_variance ?? 0)) / total) * 100;
      })
      .filter((n): n is number => n != null);
    const avgPct =
      pcts.length === 0
        ? 0
        : Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100;
    return { avgPct, count: rows.length };
  });

// ---------------------------------------------------------------------------
// role flags for UI gating
// ---------------------------------------------------------------------------
export const getMatchWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean; canOverride: boolean }> => {
    requireSupabaseAuth(context);
    const flags = await hasAnyRole(context, [
      "procurement_admin",
      "finance_admin",
      "company_admin",
    ]);
    return {
      canWrite: Boolean(flags.procurement_admin || flags.finance_admin || flags.company_admin),
      canOverride: Boolean(flags.finance_admin || flags.company_admin),
    };
  });
