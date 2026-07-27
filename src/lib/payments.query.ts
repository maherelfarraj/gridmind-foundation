// P-194 — TanStack Query options for payments.
import { queryOptions } from "@tanstack/react-query";

import { getPaymentsAccess, listInvoicePayments, listPayments } from "@/lib/payments.functions";
import type { ListPaymentsInput } from "@/lib/payments.rules";

export function paymentsListQueryOptions(filters: ListPaymentsInput = {}) {
  return queryOptions({
    queryKey: ["payments", "list", filters],
    queryFn: () => listPayments({ data: filters }),
    staleTime: 15_000,
  });
}

export function invoicePaymentsQueryOptions(invoiceId: string) {
  return queryOptions({
    queryKey: ["payments", "invoice", invoiceId],
    queryFn: () => listInvoicePayments({ data: { invoice_id: invoiceId } }),
    staleTime: 5_000,
  });
}

export function paymentsAccessQueryOptions() {
  return queryOptions({
    queryKey: ["payments", "access"],
    queryFn: () => getPaymentsAccess(),
    staleTime: 60_000,
  });
}
