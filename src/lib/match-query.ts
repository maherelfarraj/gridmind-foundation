// P-067 — TanStack Query wrappers for three-way matches.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  attachInvoiceFile,
  createMatch,
  getMatch,
  getMatchContextForPo,
  getMatchVarianceKpi,
  getMatchWriteAccess,
  listMatchablePos,
  listMatches,
  overrideMatchVariance,
  updateMatchThreshold,
} from "@/lib/match.functions";
import type { MatchCreatePayload, MatchStatus } from "@/lib/match-rules";

function errorMessage(err: unknown): string {
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

export interface MatchFilters {
  status?: MatchStatus | null;
  poId?: string | null;
  search?: string | null;
}

export function matchListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listMatches>>,
  filters: MatchFilters,
) {
  return queryOptions({
    queryKey: ["matches", filters],
    queryFn: () =>
      fn({
        data: {
          status: filters.status ?? null,
          poId: filters.poId ?? null,
          search: filters.search ?? null,
        },
      }),
    staleTime: 30_000,
  });
}

export function matchDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMatch>>,
  matchId: string,
) {
  return queryOptions({
    queryKey: ["match", matchId],
    queryFn: () => fn({ data: { matchId } }),
    staleTime: 15_000,
  });
}

export function matchContextForPoQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMatchContextForPo>>,
  poId: string,
) {
  return queryOptions({
    queryKey: ["match-context", poId],
    queryFn: () => fn({ data: { poId } }),
    staleTime: 5_000,
  });
}

export function matchablePosQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listMatchablePos>>,
) {
  return queryOptions({
    queryKey: ["pos", "matchable"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function matchKpiQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMatchVarianceKpi>>,
) {
  return queryOptions({
    queryKey: ["match-kpi"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function matchWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMatchWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["match-access"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------
export function useCreateMatch() {
  const qc = useQueryClient();
  const fn = useServerFn(createMatch);
  return useMutation({
    mutationFn: (payload: MatchCreatePayload) => fn({ data: payload }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["match-kpi"] });
      if (res.status === "variance_blocked") {
        toast.error("Payment release blocked — variance exceeds tolerance");
      } else {
        toast.success("Invoice matched");
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useAttachInvoiceFile() {
  const qc = useQueryClient();
  const fn = useServerFn(attachInvoiceFile);
  return useMutation({
    mutationFn: (input: { matchId: string; path: string }) =>
      fn({ data: input }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["match", vars.matchId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useOverrideMatch(matchId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(overrideMatchVariance);
  return useMutation({
    mutationFn: (resolution_note: string) =>
      fn({ data: { matchId, resolution_note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", matchId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      toast.success("Payment release approved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUpdateMatchThreshold(matchId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(updateMatchThreshold);
  return useMutation({
    mutationFn: (variance_threshold_pct: number) =>
      fn({ data: { matchId, variance_threshold_pct } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match", matchId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      toast.success("Threshold updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
