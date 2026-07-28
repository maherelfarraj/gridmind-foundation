// P-064 — TanStack Query wrappers for POs and awards.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  approvePo,
  awardRfqLine,
  createPoShareLink,
  generatePosFromAwards,
  getPo,
  getPoApprovalThreshold,
  getPoPdfDownloadUrl,
  getPoWriteAccess,
  issuePo,
  listPos,
  listRfqAwards,
  rejectPo,
  rfqHasPos,
  revokePoShareLink,
  setPoApprovalThreshold,
  submitPoForApproval,
  unawardRfqLine,
} from "@/lib/po.functions";
import type { PoStatus } from "@/lib/po-rules";

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

export interface PoFilters {
  search?: string | null;
  status?: PoStatus | null;
  projectId?: string | null;
}

export function posListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listPos>>,
  filters: PoFilters,
) {
  return queryOptions({
    queryKey: ["pos", filters],
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

export function poDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPo>>,
  poId: string,
) {
  return queryOptions({
    queryKey: ["po", poId],
    queryFn: () => fn({ data: { poId } }),
    staleTime: 15_000,
  });
}

export function poWriteAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPoWriteAccess>>,
) {
  return queryOptions({
    queryKey: ["po-write-access"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function poApprovalThresholdQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getPoApprovalThreshold>>,
) {
  return queryOptions({
    queryKey: ["po-approval-threshold"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function rfqAwardsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRfqAwards>>,
  rfqId: string,
) {
  return queryOptions({
    queryKey: ["rfq-awards", rfqId],
    queryFn: () => fn({ data: { rfqId } }),
    staleTime: 15_000,
  });
}

export function rfqHasPosQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof rfqHasPos>>,
  rfqId: string,
) {
  return queryOptions({
    queryKey: ["rfq-has-pos", rfqId],
    queryFn: () => fn({ data: { rfqId } }),
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------
export interface AwardLineInput {
  rfqId: string;
  bidId: string;
  lineNo: number;
  awardedQty?: number | null;
  awardNote?: string | null;
}

export function useAwardLine(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(awardRfqLine);
  return useMutation({
    mutationFn: (input: AwardLineInput) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-awards", rfqId] });
      toast.success("Line awarded");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useUnawardLine(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(unawardRfqLine);
  return useMutation({
    mutationFn: (awardId: string) => fn({ data: { awardId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-awards", rfqId] });
      toast.success("Award removed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useGeneratePos(rfqId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(generatePosFromAwards);
  return useMutation({
    mutationFn: () => fn({ data: { rfqId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["rfq", rfqId] });
      qc.invalidateQueries({ queryKey: ["rfq-awards", rfqId] });
      if (res.created > 0) {
        toast.success(
          `${res.created} PO${res.created === 1 ? "" : "s"} generated${
            res.skipped ? ` (${res.skipped} skipped)` : ""
          }`,
        );
      } else if (res.skipped > 0) {
        toast.info("POs already exist for this RFQ");
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSubmitPoForApproval(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(submitPoForApproval);
  return useMutation({
    mutationFn: (note?: string | null) => fn({ data: { poId, note: note ?? null } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      toast.success(
        res.auto_approved ? "Below threshold — auto-approved" : "Sent for CFO approval",
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useApprovePo(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(approvePo);
  return useMutation({
    mutationFn: (note: string) => fn({ data: { poId, note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      toast.success("PO approved");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRejectPo(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(rejectPo);
  return useMutation({
    mutationFn: (note: string) => fn({ data: { poId, note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      toast.success("PO rejected — returned to draft");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useIssuePo(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(issuePo);
  return useMutation({
    mutationFn: () => fn({ data: { poId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      qc.invalidateQueries({ queryKey: ["pos"] });
      toast.success("PO issued");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSetPoThreshold() {
  const qc = useQueryClient();
  const fn = useServerFn(setPoApprovalThreshold);
  return useMutation({
    mutationFn: (threshold: number) => fn({ data: { threshold } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po-approval-threshold"] });
      toast.success("Approval threshold updated");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDownloadPoPdf(poId: string) {
  const fn = useServerFn(getPoPdfDownloadUrl);
  return useMutation({
    mutationFn: async () => {
      const { url } = await fn({ data: { poId } });
      if (!url) throw new Error("Could not generate a signed PDF URL.");
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return url;
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useCreatePoShareLink(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(createPoShareLink);
  return useMutation({
    mutationFn: () => fn({ data: { poId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      toast.success("Vendor share link created — valid for 14 days");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useRevokePoShareLink(poId: string) {
  const qc = useQueryClient();
  const fn = useServerFn(revokePoShareLink);
  return useMutation({
    mutationFn: () => fn({ data: { poId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["po", poId] });
      toast.success("Vendor link revoked");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
