// P-070 — Query helpers for price alerts.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getPriceAlertAccess, listPriceAlerts } from "@/lib/price-alerts.functions";

export function priceAlertsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPriceAlerts>>,
) {
  return queryOptions({
    queryKey: ["price-alerts", "list"],
    queryFn: () => fn({}),
  });
}

export function priceAlertsAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPriceAlertAccess>>,
) {
  return queryOptions({
    queryKey: ["price-alerts", "access"],
    queryFn: () => fn({}),
  });
}

export function errorMessage(err: unknown): string {
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
