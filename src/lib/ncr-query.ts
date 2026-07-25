// P-091 — Query options for NCRs.
import { queryOptions } from "@tanstack/react-query";

import {
  getNcr,
  listNcrCurrencies,
  listNcrProjects,
  listNcrs,
} from "@/lib/ncr.functions";
import type {
  NcrDisposition,
  NcrSource,
  NcrStatus,
} from "@/lib/ncr.rules";

export { errorMessage } from "@/lib/hse-query";

export interface NcrListFilters {
  projectId?: string | null;
  status?: NcrStatus | null;
  disposition?: NcrDisposition | null;
  source?: NcrSource | null;
  search?: string | null;
}

export const ncrProjectsQueryOptions = () =>
  queryOptions({
    queryKey: ["ncr", "projects"],
    queryFn: () => listNcrProjects(),
    staleTime: 30_000,
  });

export const ncrCurrenciesQueryOptions = () =>
  queryOptions({
    queryKey: ["ncr", "currencies"],
    queryFn: () => listNcrCurrencies(),
    staleTime: 300_000,
  });

export const ncrListQueryOptions = (filters: NcrListFilters) =>
  queryOptions({
    queryKey: ["ncr", "list", filters],
    queryFn: () => listNcrs({ data: filters as any }),
    staleTime: 10_000,
  });

export const ncrDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["ncr", "item", id],
    queryFn: () => getNcr({ data: { id } }),
    staleTime: 5_000,
  });
