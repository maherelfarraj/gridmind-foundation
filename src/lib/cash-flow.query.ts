// P-077 — TanStack Query hooks for cash flows.
import { queryOptions } from "@tanstack/react-query";

import {
  getCashFlowAccess,
  listCashFlows,
  listCurrencies,
} from "@/lib/cash-flow.functions";
import type { CashFlowRow } from "@/lib/cash-flow.rules";

export function cashFlowsQueryOptions(input: {
  projectId: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
}) {
  return queryOptions<{ rows: CashFlowRow[]; baseCurrency: string }>({
    queryKey: [
      "cash-flow",
      "list",
      input.projectId,
      input.from ?? null,
      input.to ?? null,
      Boolean(input.includeVoided),
    ],
    queryFn: () => listCashFlows({ data: input }),
    staleTime: 30_000,
  });
}

export function cashFlowAccessQueryOptions() {
  return queryOptions({
    queryKey: ["cash-flow", "access"],
    queryFn: () => getCashFlowAccess(),
    staleTime: 60_000,
  });
}

export function currenciesQueryOptions() {
  return queryOptions({
    queryKey: ["currencies"],
    queryFn: () => listCurrencies(),
    staleTime: 5 * 60_000,
  });
}

export function cashFlowErrorMessage(err: unknown): string {
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
