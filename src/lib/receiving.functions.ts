// P-237 — Receiving dashboard server function. Reads through the caller's
// RLS-scoped client; no service-role shortcuts.
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  rankBySlippage,
  summarizeReceiving,
  type EtaRow,
  type MatchExceptionRow,
  type ReceivingCounts,
  type SlipResult,
} from "@/lib/receiving-dashboard.rules";

export interface OpenReceiptRow {
  id: string;
  grn_number: string;
  po_number: string | null;
  status: string;
  created_at: string;
}

export interface ExceptionRow extends MatchExceptionRow {
  po_number: string | null;
  vendor_invoice_number: string | null;
  invoice_amount: number | null;
}

export interface ReceivingDashboard {
  counts: ReceivingCounts;
  open_receipts: OpenReceiptRow[];
  exceptions: ExceptionRow[];
  slippage: Array<EtaRow & SlipResult>;
}

async function companyId(context: AuthContext): Promise<string | null> {
  const { data } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  return ((data as any)?.company_id as string) ?? null;
}

export const getReceivingDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ReceivingDashboard> => {
    requireSupabaseAuth(context);
    const co = await companyId(context);
    if (!co) {
      return {
        counts: { open_receipts: 0, match_exceptions: 0, unconfirmed_etas: 0, late_lines: 0 },
        open_receipts: [],
        exceptions: [],
        slippage: [],
      };
    }

    const [grnRes, matchRes, etaRes] = await Promise.all([
      context.supabase
        .from("goods_receipts")
        .select("id, grn_number, status, created_at, purchase_orders:po_id(po_number)")
        .in("status", ["draft", "has_defects"])
        .order("created_at", { ascending: false })
        .limit(50),
      context.supabase
        .from("three_way_matches")
        .select(
          "id, status, payment_release_blocked, amount_variance, vendor_invoice_number, invoice_amount, purchase_orders:po_id(po_number)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      context.supabase
        .from("expediting_logs")
        .select(
          "id, item_description, site_need_date, current_eta, eta_confirmed, purchase_orders:po_id(po_number)",
        )
        .neq("status", "delivered")
        .limit(200),
    ]);

    if (grnRes.error) throw grnRes.error;
    if (matchRes.error) throw matchRes.error;
    if (etaRes.error) throw etaRes.error;

    const open_receipts: OpenReceiptRow[] = ((grnRes.data ?? []) as any[]).map((r) => ({
      id: r.id,
      grn_number: r.grn_number,
      po_number: r.purchase_orders?.po_number ?? null,
      status: r.status,
      created_at: r.created_at,
    }));

    const allMatches: ExceptionRow[] = ((matchRes.data ?? []) as any[]).map((r) => ({
      id: r.id,
      status: r.status,
      payment_release_blocked: !!r.payment_release_blocked,
      amount_variance: r.amount_variance == null ? null : Number(r.amount_variance),
      vendor_invoice_number: r.vendor_invoice_number ?? null,
      invoice_amount: r.invoice_amount == null ? null : Number(r.invoice_amount),
      po_number: r.purchase_orders?.po_number ?? null,
    }));

    const etas: EtaRow[] = ((etaRes.data ?? []) as any[]).map((r) => ({
      id: r.id,
      po_number: r.purchase_orders?.po_number ?? null,
      item_description: r.item_description ?? "",
      site_need_date: r.site_need_date ?? null,
      current_eta: r.current_eta ?? null,
      eta_confirmed: !!r.eta_confirmed,
    }));

    const exceptions = allMatches.filter(
      (m) => m.status === "variance_blocked" || m.payment_release_blocked,
    );

    return {
      counts: summarizeReceiving({
        drafts: open_receipts.filter((r) => r.status === "draft").length,
        matches: allMatches,
        etas,
      }),
      open_receipts,
      exceptions,
      slippage: rankBySlippage(etas).slice(0, 25),
    };
  });
