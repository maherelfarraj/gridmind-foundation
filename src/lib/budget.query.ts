// P-075 — TanStack Query wrappers for budgets + cost codes.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getBudgetAccess,
  listBudgets,
  listCostCodes,
  listProjectPurchaseOrders,
} from "@/lib/budget.functions";

export function budgetAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getBudgetAccess>>,
) {
  return queryOptions({
    queryKey: ["budget", "access"],
    queryFn: () => fn({}),
  });
}

export function costCodesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listCostCodes>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["budget", "cost-codes", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function budgetsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listBudgets>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["budget", "budgets", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function eligiblePosQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listProjectPurchaseOrders>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["budget", "eligible-pos", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function budgetErrorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      /* ignore */
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}
