// P-058 — TanStack Query hooks for drawing review workflow.
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  closeReviewRound,
  getMyReviewRoles,
  getReviewRound,
  listEligibleReviewers,
  listReviewRounds,
  startReviewRound,
  submitSignoff,
  waiveSignoff,
  type ReviewDecisionInput,
  type ReviewerOrg,
} from "@/lib/drawing-reviews.functions";

export function reviewRoundsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listReviewRounds>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["review-rounds", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function reviewRoundQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getReviewRound>>,
  roundId: string,
) {
  return queryOptions({
    queryKey: ["review-round", roundId],
    queryFn: () => fn({ data: { roundId } }),
    staleTime: 10_000,
  });
}

export function eligibleReviewersQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listEligibleReviewers>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["review-eligible-reviewers", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function reviewRolesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getMyReviewRoles>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["review-roles", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 5 * 60_000,
  });
}

export function useStartReviewRound(projectId: string) {
  const fn = useServerFn(startReviewRound);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      revisionId: string;
      dueDate?: string | null;
      reviewers: { userId: string; org: ReviewerOrg }[];
    }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-rounds", projectId] });
      toast.success("Review round opened");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to open round"),
  });
}

export function useSubmitSignoff(roundId: string, projectId: string) {
  const fn = useServerFn(submitSignoff);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      signoffId: string;
      decision: ReviewDecisionInput;
      comment?: string | null;
    }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-round", roundId] });
      qc.invalidateQueries({ queryKey: ["review-rounds", projectId] });
      toast.success("Sign-off recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sign-off failed"),
  });
}

export function useWaiveSignoff(roundId: string, projectId: string) {
  const fn = useServerFn(waiveSignoff);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { signoffId: string; comment: string }) => fn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-round", roundId] });
      qc.invalidateQueries({ queryKey: ["review-rounds", projectId] });
      toast.success("Waived");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Waiver failed"),
  });
}

export function useCloseReviewRound(roundId: string, projectId: string) {
  const fn = useServerFn(closeReviewRound);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { roundId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-round", roundId] });
      qc.invalidateQueries({ queryKey: ["review-rounds", projectId] });
      toast.success("Round closed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Close failed"),
  });
}
