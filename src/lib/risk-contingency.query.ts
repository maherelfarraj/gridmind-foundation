// GC-17 — TanStack Query options for the risk & contingency cockpits.
import { queryOptions } from "@tanstack/react-query";

import {
  getPortfolioRiskAppendix,
  getPortfolioRiskContingency,
  getRiskContingencyAppendix,
  getRiskContingencyAccess,
  getRiskContingencyWorkspace,
} from "@/lib/risk-contingency.functions";

export function riskContingencyWorkspaceQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["risk-contingency", "workspace", projectId],
    queryFn: () => getRiskContingencyWorkspace({ data: { project_id: projectId } }),
    staleTime: 10_000,
  });
}

export function riskContingencyAccessQueryOptions() {
  return queryOptions({
    queryKey: ["risk-contingency", "access"],
    queryFn: () => getRiskContingencyAccess(),
    staleTime: 60_000,
  });
}

export function riskContingencyAppendixQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["risk-contingency", "appendix", projectId],
    queryFn: () => getRiskContingencyAppendix({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}

export function portfolioRiskAppendixQueryOptions() {
  return queryOptions({
    queryKey: ["risk-contingency", "portfolio-appendix"],
    queryFn: () => getPortfolioRiskAppendix(),
    staleTime: 30_000,
  });
}

export function portfolioRiskContingencyQueryOptions() {
  return queryOptions({
    queryKey: ["risk-contingency", "portfolio"],
    queryFn: () => getPortfolioRiskContingency(),
    staleTime: 30_000,
  });
}

/** Human message out of a server-fn error envelope. */
export function riskContingencyErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const parsed = JSON.parse(e.body) as { message?: string; error?: string };
      if (parsed.message) return String(parsed.message);
      if (parsed.error) return String(parsed.error);
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}
