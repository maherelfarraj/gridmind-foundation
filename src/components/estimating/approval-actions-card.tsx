// P-212 — Estimate approval + proposal conversion actions.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileSignature, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checkEstimateApproval,
  convertEstimateToProposal,
  submitEstimateForReview,
  type EstimateDetail,
} from "@/lib/estimating.functions";
import { estimatingErrorMessage } from "@/lib/estimating.query";

const STEP_LABELS = ["Engineering review", "Finance review"];

export function EstimateApprovalCard({ detail }: { detail: EstimateDetail }) {
  const queryClient = useQueryClient();
  const { estimate, approval, conversion } = detail;
  const submit = useServerFn(submitEstimateForReview);
  const check = useServerFn(checkEstimateApproval);
  const convert = useServerFn(convertEstimateToProposal);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["estimating"] });

  const submitMutation = useMutation({
    mutationFn: () => submit({ data: { estimate_id: estimate.id } }),
    onSuccess: () => {
      toast.success("Submitted for review.");
      void refresh();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const checkMutation = useMutation({
    mutationFn: () => check({ data: { estimate_id: estimate.id } }),
    onSuccess: (res) => {
      toast.success(
        res.status === "approved"
          ? "Approved — ready to convert."
          : res.status === "draft"
            ? "Returned to draft after rejection."
            : "Still awaiting a decision.",
      );
      void refresh();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const convertMutation = useMutation({
    mutationFn: () => convert({ data: { estimate_id: estimate.id, opportunity_id: null } }),
    onSuccess: (res) => {
      toast.success(`Proposal created with ${res.lines} lines.`);
      void refresh();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const canAct = detail.can_write;
  const stepLabel = STEP_LABELS[(approval?.current_step ?? 1) - 1] ?? "Review";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Approval &amp; conversion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {estimate.status === "in_review" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="mutedOutline">Pending approval — Engineering then Finance</Badge>
            <span>Current step: {stepLabel}</span>
          </div>
        ) : null}

        {conversion.rejection_comment && estimate.status === "draft" ? (
          <Alert variant="warning">
            <AlertTitle>Returned by the reviewer</AlertTitle>
            <AlertDescription>{conversion.rejection_comment}</AlertDescription>
          </Alert>
        ) : null}

        {conversion.converted_proposal_id ? (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            <span>Converted to a proposal.</span>
            <Button variant="link" className="h-auto p-0" asChild>
              <Link
                to="/proposals/$proposalId"
                params={{ proposalId: conversion.converted_proposal_id }}
              >
                Open proposal
              </Link>
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {estimate.status === "draft" ? (
            <Button
              disabled={!canAct || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              <Send className="mr-2 size-4" /> Submit for review
            </Button>
          ) : null}
          {estimate.status === "in_review" ? (
            <Button
              variant="outline"
              disabled={checkMutation.isPending}
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw className="mr-2 size-4" /> Check approval
            </Button>
          ) : null}
          {estimate.status === "approved" && !conversion.converted_proposal_id ? (
            <Button
              disabled={!canAct || convertMutation.isPending}
              onClick={() => convertMutation.mutate()}
            >
              <FileSignature className="mr-2 size-4" /> Convert to proposal
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
