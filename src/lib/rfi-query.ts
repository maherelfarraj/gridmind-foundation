// P-059 — TanStack Query hooks for the RFI module.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  answerRfi,
  closeRfi,
  getMyRfiRole,
  getRfi,
  getRfiKpis,
  listRfis,
  listRoutableMembers,
  raiseRfi,
  voidRfi,
} from "@/lib/rfi.functions";

export interface RfiFilters {
  status?: string | null;
  discipline?: string | null;
  assignee?: string | null;
  search?: string | null;
}

export function rfiListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRfis>>,
  projectId: string,
  filters: RfiFilters,
) {
  return queryOptions({
    queryKey: ["rfis", projectId, filters],
    queryFn: () =>
      fn({
        data: {
          projectId,
          status: filters.status ?? null,
          discipline: filters.discipline ?? null,
          assignee: filters.assignee ?? null,
          search: filters.search ?? null,
        },
      }),
    staleTime: 30_000,
  });
}

export function rfiDetailQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getRfi>>,
  rfiId: string,
) {
  return queryOptions({
    queryKey: ["rfi", rfiId],
    queryFn: () => fn({ data: { rfiId } }),
    staleTime: 15_000,
  });
}

export function rfiKpiQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getRfiKpis>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["rfi-kpis", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function routableMembersQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRoutableMembers>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["routable-members", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function rfiRoleQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyRfiRole>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["rfi-role", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function useRaiseRfi(projectId: string) {
  const fn = useServerFn(raiseRfi);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      subject: string;
      question: string;
      discipline: any;
      priority: any;
      routedTo: string;
      drawingId?: string | null;
      dueDate: string;
      costImpact?: boolean;
      scheduleImpact?: boolean;
    }) => fn({ data: { projectId, ...input } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["rfis", projectId] });
      qc.invalidateQueries({ queryKey: ["rfi-kpis", projectId] });
      toast.success(`Raised ${res.rfi_number}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Raise failed"),
  });
}

export function useAnswerRfi(projectId: string, rfiId: string) {
  const fn = useServerFn(answerRfi);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { answer: string }) => fn({ data: { rfiId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfi", rfiId] });
      qc.invalidateQueries({ queryKey: ["rfis", projectId] });
      qc.invalidateQueries({ queryKey: ["rfi-kpis", projectId] });
      toast.success("Answer recorded");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Answer failed"),
  });
}

export function useCloseRfi(projectId: string, rfiId: string) {
  const fn = useServerFn(closeRfi);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { rfiId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfi", rfiId] });
      qc.invalidateQueries({ queryKey: ["rfis", projectId] });
      qc.invalidateQueries({ queryKey: ["rfi-kpis", projectId] });
      toast.success("RFI closed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Close failed"),
  });
}

export function useVoidRfi(projectId: string, rfiId: string) {
  const fn = useServerFn(voidRfi);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { reason: string }) => fn({ data: { rfiId, ...input } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rfi", rfiId] });
      qc.invalidateQueries({ queryKey: ["rfis", projectId] });
      qc.invalidateQueries({ queryKey: ["rfi-kpis", projectId] });
      toast.success("RFI voided");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Void failed"),
  });
}
