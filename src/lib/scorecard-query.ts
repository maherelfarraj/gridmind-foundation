// P-069 — TanStack Query wrappers.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getScorecardAccess,
  getVendorHistory,
  listScorecards,
} from "@/lib/scorecard.functions";

export function scorecardAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getScorecardAccess>>,
) {
  return queryOptions({
    queryKey: ["scorecards", "access"],
    queryFn: () => fn({}),
  });
}

export function scorecardListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listScorecards>>,
  period: { periodStart: string; periodEnd: string },
) {
  return queryOptions({
    queryKey: ["scorecards", "list", period],
    queryFn: () => fn({ data: period }),
  });
}

export function vendorHistoryQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getVendorHistory>>,
  args: { vendorId: string; periodStart: string; periodEnd: string } | null,
) {
  return queryOptions({
    queryKey: ["scorecards", "history", args],
    queryFn: () => fn({ data: args! }),
    enabled: !!args,
  });
}

export function scorecardErrorMessage(err: unknown): string {
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
