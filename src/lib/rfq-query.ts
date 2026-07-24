// P-063 — TanStack Query wrappers for RFQs.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  getRfq,
  getRfqWriteAccess,
  inviteRfqVendors,
  issueRfq,
  listProjectsForRfq,
  listRfqEligibleVendors,
  listRfqs,
  removeRfqInvite,
  saveRfqDraft,
  submitBid,
} from "@/lib/rfq.functions";
import type { RfqStatus } from "@/lib/rfq-rules";

export interface RfqFilters {
  search?: string | null;
  status?: RfqStatus | null;
  projectId?: string | null;
}

function errorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      // ignore
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}

export function rfqsListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRfqs>>,
  filters: RfqFilters,
) {
  return queryOptions({
    queryKey: ["rfqs", filters],
    queryFn: () =>
      fn({
        data: {
          search: filters.search ?? null,
          status: filters.status ?? null,
          projectId: filters.projectId ?? null,
        },
      }),
    staleTime: 30_000,
  });
}

export function rfqDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getRfq>>,
  rfqId: string,
) {
  return queryOptions({
    queryKey: ["rfq", rfqId],
    queryFn: () => fn({ data: { rfqId } }),
    staleTime: 15_000,
  });
}

export function rfqWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getRfqWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["rfq-write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function rfqEligibleVendorsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRfqEligibleVendors>>,
  search: string | null,
) {
  return queryOptions({
    queryKey: ["rfq-eligible-vendors", search],
    queryFn: () => fn({ data: { search } }),
    staleTime: 60_000,
  });
}

export function rfqProjectsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listProjectsForRfq>>,
) {
  return queryOptions({
    queryKey: ["rfq-projects"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------
export interface SaveRfqDraftInput {
  id?: string | null;
  projectId: string;
  title: string;
  description?: string | null;
  currencyCode: string;
  issueDate?: string | null;
  dueDate?: string | null;
  terms?: string | null;
  lines: Array<{
    line_no: number;
    description: string;
    spec?: string | null;
    qty: number;
    uom: string;
    target_price?: number | null;
    site_need_date?: string | null;
  }>;
}

export function useSaveRfqDraft() {
  const qc = useQueryClient();
  const fn = useServerFn(saveRfqDraft);
  return useMutation({
    mutationFn: (input: SaveRfqDraftInput) => fn({ data: input as any }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      if (vars?.id) {
        qc.invalidateQueries({ queryKey: ["rfq", vars.id] });
      }
      toast.success("RFQ saved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}


export function useInviteVendors(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(inviteRfqVendors);
  return useMutation({
    mutationFn: (vendorIds: string[]) =>
      fn({ data: { rfqId, vendorIds } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      toast.success("Vendors invited");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRemoveInvite(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(removeRfqInvite);
  return useMutation({
    mutationFn: (bidId: string) => fn({ data: { bidId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      toast.success("Invite removed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useIssueRfq(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(issueRfq);
  return useMutation({
    mutationFn: () => fn({ data: { rfqId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfqs"] });
      toast.success(`RFQ issued as ${res.rfq_number}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSubmitBid(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(submitBid);
  return useMutation({
    mutationFn: (input: Parameters<typeof fn>[0]["data"]) =>
      fn({ data: input as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      toast.success("Bid recorded");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
