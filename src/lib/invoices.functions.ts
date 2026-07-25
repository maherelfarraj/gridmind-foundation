// P-079 — Invoices read-only fetchers (writes land in P-080).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  direction: "receivable" | "payable";
  status: string;
  amount: number;
  currency_code: string;
  issue_date: string | null;
  due_date: string | null;
  milestone_label: string | null;
  contract_id: string | null;
  project_id: string | null;
  created_at: string;
}

function toRow(r: any): InvoiceRow {
  return {
    id: r.id,
    invoice_number: r.invoice_number,
    direction: r.direction,
    status: r.status,
    amount: Number(r.amount ?? 0),
    currency_code: r.currency_code,
    issue_date: r.issue_date ?? null,
    due_date: r.due_date ?? null,
    milestone_label: r.milestone_label ?? null,
    contract_id: r.contract_id ?? null,
    project_id: r.project_id ?? null,
    created_at: r.created_at,
  };
}

export const getInvoice = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<InvoiceRow | null> => {
    requireSupabaseAuth(context);
    const { data: r, error } = await context.supabase
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return r ? toRow(r) : null;
  });
