// P-210 — TanStack Query options + error shaping for the estimating workspace.
import { queryOptions } from "@tanstack/react-query";

import {
  getEstimateDetail,
  getEstimatingRegister,
  getRateLibrary,
} from "@/lib/estimating.functions";
import type { ListEstimatesInput } from "@/lib/estimating.rules";

export function estimatingRegisterQueryOptions(filters: ListEstimatesInput) {
  return queryOptions({
    queryKey: ["estimating", "register", filters],
    queryFn: () => getEstimatingRegister({ data: filters }),
    staleTime: 15_000,
  });
}

export function estimateDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["estimating", "estimate", id],
    queryFn: () => getEstimateDetail({ data: { id } }),
    staleTime: 5_000,
  });
}

export function rateLibraryQueryOptions(q: string | null = null) {
  return queryOptions({
    queryKey: ["estimating", "rates", q ?? ""],
    queryFn: () => getRateLibrary({ data: { q } }),
    staleTime: 30_000,
  });
}

/** Human message out of a server-fn error envelope. */
export function estimatingErrorMessage(err: unknown): string {
  const anyErr = err as { body?: unknown; message?: string };
  if (typeof anyErr?.body === "string") {
    try {
      const parsed = JSON.parse(anyErr.body) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return anyErr?.message ?? "Something went wrong.";
}
