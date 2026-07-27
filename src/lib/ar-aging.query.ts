// P-195 — TanStack Query options for AR aging & collections.
import { queryOptions } from "@tanstack/react-query";

import { getArAccess, getArAging, listInvoiceReminders } from "@/lib/ar-aging.functions";
import type { GetArAgingInput } from "@/lib/ar-aging.rules";

export function arAgingQueryOptions(filters: GetArAgingInput = {}) {
  return queryOptions({
    queryKey: ["ar-aging", filters],
    queryFn: () => getArAging({ data: filters }),
    staleTime: 30_000,
  });
}

export function arAccessQueryOptions() {
  return queryOptions({
    queryKey: ["ar-aging", "access"],
    queryFn: () => getArAccess(),
    staleTime: 60_000,
  });
}

export function invoiceRemindersQueryOptions(invoiceId: string) {
  return queryOptions({
    queryKey: ["ar-reminders", invoiceId],
    queryFn: () => listInvoiceReminders({ data: { invoice_id: invoiceId } }),
    staleTime: 5_000,
  });
}
