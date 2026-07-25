// P-080 — TanStack Query options for invoices.
import { queryOptions } from "@tanstack/react-query";

import {
  getContractBillingSummary,
  getInvoiceDetail,
  getInvoicesAccess,
  listInvoices,
} from "@/lib/invoices.functions";
import type { InvoiceDirection, InvoiceStatus } from "@/lib/invoices.rules";

export function invoicesListQueryOptions(
  filters: { project_id?: string; direction?: InvoiceDirection; status?: InvoiceStatus; q?: string } = {},
) {
  return queryOptions({
    queryKey: [
      "invoices",
      "list",
      filters.project_id ?? null,
      filters.direction ?? null,
      filters.status ?? null,
      filters.q?.trim() || null,
    ],
    queryFn: () => listInvoices({ data: filters }),
    staleTime: 15_000,
  });
}

export function invoiceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["invoices", "detail", id],
    queryFn: () => getInvoiceDetail({ data: { id } }),
    staleTime: 5_000,
  });
}

export function invoicesAccessQueryOptions() {
  return queryOptions({
    queryKey: ["invoices", "access"],
    queryFn: () => getInvoicesAccess(),
    staleTime: 60_000,
  });
}

export function contractBillingSummaryQueryOptions(contractId: string) {
  return queryOptions({
    queryKey: ["invoices", "billing-summary", contractId],
    queryFn: () => getContractBillingSummary({ data: { contract_id: contractId } }),
    staleTime: 10_000,
  });
}

export function invoiceErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return p.message;
      if (p?.error) return p.error;
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}

export function invoiceErrorCode(err: unknown): string | null {
  const e = err as { body?: string };
  if (!e?.body) return null;
  try {
    const p = JSON.parse(e.body);
    return (p?.error as string) ?? null;
  } catch {
    return null;
  }
}
