// P-082 — TanStack Query options for project finance modules.
import { queryOptions } from "@tanstack/react-query";

import {
  getProjectFinanceAccess,
  listPpaContractCandidates,
  listPpaTerms,
} from "@/lib/ppa.functions";
import { listLcoeScenarios } from "@/lib/lcoe.functions";
import {
  listCompanyMembers,
  listDdItems,
} from "@/lib/lender-dd.functions";
import { listBankFacilities } from "@/lib/bank-facilities.functions";

export { projectFinanceErrorMessage } from "@/lib/project-finance-shared";

export function ppaListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pf", "ppa", projectId],
    queryFn: () => listPpaTerms({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function ppaContractsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pf", "ppa-contracts", projectId],
    queryFn: () =>
      listPpaContractCandidates({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}

export function lcoeListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pf", "lcoe", projectId],
    queryFn: () => listLcoeScenarios({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function ddListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pf", "dd", projectId],
    queryFn: () => listDdItems({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function ddMembersQueryOptions() {
  return queryOptions({
    queryKey: ["pf", "dd-members"],
    queryFn: () => listCompanyMembers(),
    staleTime: 60_000,
  });
}

export function bankFacilitiesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pf", "facilities", projectId],
    queryFn: () =>
      listBankFacilities({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function projectFinanceAccessQueryOptions() {
  return queryOptions({
    queryKey: ["pf", "access"],
    queryFn: () => getProjectFinanceAccess(),
    staleTime: 60_000,
  });
}
