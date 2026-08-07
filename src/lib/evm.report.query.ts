// GC-12 — Query options for the EVM cockpit and portfolio EVM dashboard.
import { queryOptions } from "@tanstack/react-query";

import {
  getEvmAppendix,
  getEvmDetail,
  getEvmMappings,
  getEvmMappingVersions,
  getEvmOverrides,
  getEvmScopeCatalog,
  getEvmWorkspace,
  getPortfolioEvm,
  getPortfolioEvmAppendix,
} from "@/lib/evm.report.functions";

export function evmWorkspaceQueryOptions(projectId: string, period?: string, currency?: string) {
  return queryOptions({
    queryKey: ["evm", "workspace", projectId, period ?? "current", currency ?? "default"],
    queryFn: () =>
      getEvmWorkspace({
        data: { project_id: projectId, ...(period ? { period } : {}), ...(currency ? { currency } : {}) },
      }),
    staleTime: 10_000,
  });
}

export function evmDetailQueryOptions(
  reportId: string | null,
  page: number,
  pageSize: number,
  filters?: { cost_code_id?: string; wbs_item_id?: string },
) {
  return queryOptions({
    queryKey: ["evm", "detail", reportId ?? "none", page, pageSize, filters ?? {}],
    queryFn: () =>
      getEvmDetail({
        data: { report_id: reportId as string, page, page_size: pageSize, ...(filters ?? {}) },
      }),
    enabled: Boolean(reportId),
    staleTime: 30_000,
  });
}

export function evmMappingVersionsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["evm", "mapping-versions", projectId],
    queryFn: () => getEvmMappingVersions({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}

export function evmMappingsQueryOptions(versionId: string | null) {
  return queryOptions({
    queryKey: ["evm", "mappings", versionId ?? "none"],
    queryFn: () => getEvmMappings({ data: { id: versionId as string } }),
    enabled: Boolean(versionId),
    staleTime: 30_000,
  });
}

export function evmAppendixQueryOptions(projectId: string, period?: string) {
  return queryOptions({
    queryKey: ["evm", "appendix", projectId, period ?? "current"],
    queryFn: () =>
      getEvmAppendix({ data: { project_id: projectId, ...(period ? { period } : {}) } }),
    staleTime: 60_000,
  });
}

export function portfolioEvmQueryOptions(filter: {
  period?: string;
  currency?: string;
  status?: "working" | "submitted" | "approved" | "superseded";
  project_id?: string;
}) {
  return queryOptions({
    queryKey: ["evm", "portfolio", filter],
    queryFn: () => getPortfolioEvm({ data: filter }),
    staleTime: 30_000,
  });
}

export function portfolioEvmAppendixQueryOptions(filter: { period?: string; currency?: string }) {
  return queryOptions({
    queryKey: ["evm", "portfolio-appendix", filter],
    queryFn: () => getPortfolioEvmAppendix({ data: filter }),
    staleTime: 60_000,
  });
}

export function evmScopeCatalogQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["evm", "scope-catalog", projectId],
    queryFn: () => getEvmScopeCatalog({ data: { project_id: projectId } }),
    staleTime: 60_000,
  });
}

export function evmOverridesQueryOptions(projectId: string, period: string) {
  return queryOptions({
    queryKey: ["evm", "overrides", projectId, period],
    queryFn: () => getEvmOverrides({ data: { project_id: projectId, period } }),
    staleTime: 15_000,
  });
}
