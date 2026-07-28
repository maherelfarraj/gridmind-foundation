// P-261 — Subcontract finance surface: AP invoices, payments, retention release.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { RetentionReleaseSchema } from "@/lib/subcontract-finance.rules";

export interface SubApInvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  amount: number;
  paid_amount: number;
  balance: number;
  currency_code: string;
  issue_date: string | null;
  due_date: string | null;
  milestone_label: string | null;
  subcontract_claim_id: string | null;
}

export interface RetentionReleaseRow {
  id: string;
  amount: number;
  release_date: string;
  reason: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
}

export interface SubcontractFinance {
  payment_terms_days: number;
  retention_held: number;
  retention_released: number;
  defects_liability_end: string | null;
  ap_invoices: SubApInvoiceRow[];
  releases: RetentionReleaseRow[];
}

const N = (v: unknown) => Number(v ?? 0);

export const getSubcontractFinance = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ subcontract_id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }): Promise<SubcontractFinance> => {
    requireSupabaseAuth(context);

    const [{ data: sc }, { data: invoices }, { data: releases }] = await Promise.all([
      context.supabase
        .from("subcontracts")
        .select("payment_terms_days, retention_held, retention_released, defects_liability_end")
        .eq("id", data.subcontract_id)
        .maybeSingle(),
      context.supabase
        .from("invoices")
        .select(
          "id, invoice_number, status, amount, tax_amount, paid_amount, currency_code, issue_date, due_date, milestone_label, subcontract_claim_id",
        )
        .eq("subcontract_id", data.subcontract_id)
        .order("issue_date", { ascending: false }),
      context.supabase
        .from("subcontract_retention_releases")
        .select("id, amount, release_date, reason, invoice_id, invoices(invoice_number)")
        .eq("subcontract_id", data.subcontract_id)
        .order("release_date", { ascending: false }),
    ]);

    const header = (sc ?? {}) as Record<string, unknown>;
    return {
      payment_terms_days: Number(header.payment_terms_days ?? 30),
      retention_held: N(header.retention_held),
      retention_released: N(header.retention_released),
      defects_liability_end: (header.defects_liability_end as string) ?? null,
      ap_invoices: ((invoices ?? []) as Record<string, unknown>[]).map((r) => {
        const amount = N(r.amount) + N(r.tax_amount);
        const paid = N(r.paid_amount);
        return {
          id: r.id as string,
          invoice_number: r.invoice_number as string,
          status: r.status as string,
          amount,
          paid_amount: paid,
          balance: Math.round((amount - paid) * 100) / 100,
          currency_code: r.currency_code as string,
          issue_date: (r.issue_date as string) ?? null,
          due_date: (r.due_date as string) ?? null,
          milestone_label: (r.milestone_label as string) ?? null,
          subcontract_claim_id: (r.subcontract_claim_id as string) ?? null,
        };
      }),
      releases: ((releases ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r.id as string,
        amount: N(r.amount),
        release_date: r.release_date as string,
        reason: (r.reason as string) ?? null,
        invoice_id: (r.invoice_id as string) ?? null,
        invoice_number:
          (r.invoices as { invoice_number: string } | null)?.invoice_number ?? null,
      })),
    };
  });

export const releaseSubcontractRetention = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => RetentionReleaseSchema.parse(raw))
  .handler(
    async ({
      context,
      data,
    }): Promise<{
      release_id: string;
      invoice_id: string;
      invoice_number: string;
      retention_held: number;
      retention_released: number;
    }> => {
      requireSupabaseAuth(context);
      const { data: res, error } = await context.supabase.rpc(
        "subcontract_release_retention" as never,
        {
          p_subcontract_id: data.subcontract_id,
          p_amount: data.amount,
          p_release_date: data.release_date ?? new Date().toISOString().slice(0, 10),
          p_reason: data.reason ?? null,
        } as never,
      );
      if (error) {
        const message = String(error.message ?? "");
        const code = message.includes("retention_release_exceeds_held")
          ? "retention_release_exceeds_held"
          : message.includes("retention_release_before_dlp")
            ? "retention_release_before_dlp"
            : message.includes("finance_period_closed")
              ? "finance_period_closed"
              : message.includes("forbidden")
                ? "forbidden"
                : "retention_release_failed";
        const status = code === "forbidden" || code === "retention_release_before_dlp" ? 403 : 409;
        throw Object.assign(new Error(code), {
          statusCode: status,
          body: JSON.stringify({ error: code, message }),
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      const out = (res ?? {}) as Record<string, unknown>;
      return {
        release_id: String(out.release_id ?? ""),
        invoice_id: String(out.invoice_id ?? ""),
        invoice_number: String(out.invoice_number ?? ""),
        retention_held: N(out.retention_held),
        retention_released: N(out.retention_released),
      };
    },
  );
