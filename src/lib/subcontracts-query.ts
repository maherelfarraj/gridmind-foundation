// P-258 — TanStack Query wrappers for the subcontract register + claims.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  decideClaim,
  saveClaim,
  saveSubcontract,
  submitClaimForCertification,
  type ClaimLineRow,
  type ClaimRow,
  type SubcontractLineRow,
  type SubcontractRow,
} from "@/lib/subcontracts.functions";
import type {
  ClaimDecisionInput,
  ClaimSaveInput,
  SubcontractSaveInput,
} from "@/lib/subcontracts.rules";

export function subcontractErrorMessage(err: unknown): string {
  const anyErr = err as { body?: unknown; message?: unknown };
  if (typeof anyErr?.body === "string") {
    try {
      const parsed = JSON.parse(anyErr.body) as { message?: string; error?: string };
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      /* ignore */
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}

export interface SubcontractFilters {
  search?: string | null;
  status?: string | null;
  project_id?: string | null;
}

type Fetch<TData, TResult> = (opts: { data: TData }) => Promise<TResult>;
type FetchNoData<TResult> = (opts?: Record<string, never>) => Promise<TResult>;

export interface SubcontractPickers {
  vendors: { id: string; name: string; categories: string[] }[];
  projects: { id: string; name: string }[];
  wbs: { id: string; code: string; name: string; project_id: string }[];
  currencies: string[];
}

export const subcontractListQueryOptions = (
  fn: Fetch<SubcontractFilters, SubcontractRow[]>,
  filters: SubcontractFilters = {},
) =>
  queryOptions({
    queryKey: ["subcontracts", "list", filters],
    queryFn: () => fn({ data: filters }),
  });

export const subcontractQueryOptions = (
  fn: Fetch<
    { id: string },
    { subcontract: SubcontractRow; lines: SubcontractLineRow[]; claims: ClaimRow[] }
  >,
  id: string,
) =>
  queryOptions({
    queryKey: ["subcontracts", "detail", id],
    queryFn: () => fn({ data: { id } }),
  });

export const subcontractAccessQueryOptions = (fn: FetchNoData<{ canWrite: boolean }>) =>
  queryOptions({ queryKey: ["subcontracts", "access"], queryFn: () => fn() });

export const subcontractPickersQueryOptions = (
  fn: Fetch<{ project_id: string | null }, SubcontractPickers>,
  projectId: string | null,
) =>
  queryOptions({
    queryKey: ["subcontracts", "pickers", projectId],
    queryFn: () => fn({ data: { project_id: projectId } }),
  });

export interface ClaimWorkspaceData {
  claim: ClaimRow;
  lines: ClaimLineRow[];
  subcontract: SubcontractRow;
  approval: { approval_id: string; step_order: number } | null;
  canWrite: boolean;
}

export const claimQueryOptions = (fn: Fetch<{ id: string }, ClaimWorkspaceData>, id: string) =>
  queryOptions({
    queryKey: ["subcontracts", "claim", id],
    queryFn: () => fn({ data: { id } }),
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["subcontracts"] });
}

export function useSaveSubcontract(onDone?: (id: string) => void) {
  const fn = useServerFn(saveSubcontract);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: SubcontractSaveInput) => fn({ data: input }),
    onSuccess: async (res) => {
      await invalidate();
      onDone?.(res.id);
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}

export function useSaveClaim(onDone?: (id: string) => void) {
  const fn = useServerFn(saveClaim);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: ClaimSaveInput) => fn({ data: input }),
    onSuccess: async (res) => {
      await invalidate();
      onDone?.(res.id);
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}

export function useSubmitClaim(onDone?: () => void) {
  const fn = useServerFn(submitClaimForCertification);
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (claimId: string) => fn({ data: { claim_id: claimId } }),
    onSuccess: async () => {
      await invalidate();
      onDone?.();
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}

export function useDecideClaim(onDone?: () => void) {
  const fn = useServerFn(decideClaim);
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClaimDecisionInput) => fn({ data: input }),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({ queryKey: ["approvals"] });
      onDone?.();
    },
    onError: (err) => toast.error(subcontractErrorMessage(err)),
  });
}
