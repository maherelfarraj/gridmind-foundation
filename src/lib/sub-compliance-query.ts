// P-260 — TanStack Query wrappers for compliance docs + sub scorecards.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  computeSubScorecard,
  deleteComplianceDoc,
  saveComplianceDoc,
  type ComplianceDocRow,
  type ScorecardRow,
} from "@/lib/sub-compliance.functions";
import { subcontractErrorMessage } from "@/lib/subcontracts-query";
import type { ComplianceDocSaveInput, ScorecardComputeInput } from "@/lib/sub-compliance.rules";

type Fetch<TData, TResult> = (opts: { data: TData }) => Promise<TResult>;

export interface ComplianceFilters {
  vendor_id?: string | null;
  subcontract_id?: string | null;
  include_vendor_level?: boolean;
}

export const complianceDocsQueryOptions = (
  fn: Fetch<ComplianceFilters, ComplianceDocRow[]>,
  filters: ComplianceFilters,
) =>
  queryOptions({
    queryKey: ["sub-compliance", "docs", filters],
    queryFn: () => fn({ data: filters }),
  });

export const subScorecardsQueryOptions = (
  fn: Fetch<{ vendor_id: string | null }, ScorecardRow[]>,
  vendorId: string | null,
) =>
  queryOptions({
    queryKey: ["sub-compliance", "scorecards", vendorId],
    queryFn: () => fn({ data: { vendor_id: vendorId } }),
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["sub-compliance"] });
}

export function useSaveComplianceDoc(onDone?: () => void) {
  const fn = useServerFn(saveComplianceDoc);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ComplianceDocSaveInput) => fn({ data: input }),
    onSuccess: async () => {
      await invalidate();
      onDone?.();
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}

export function useDeleteComplianceDoc() {
  const fn = useServerFn(deleteComplianceDoc);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => fn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}

export function useComputeSubScorecard(onDone?: () => void) {
  const fn = useServerFn(computeSubScorecard);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ScorecardComputeInput) => fn({ data: input }),
    onSuccess: async () => {
      await invalidate();
      onDone?.();
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}
