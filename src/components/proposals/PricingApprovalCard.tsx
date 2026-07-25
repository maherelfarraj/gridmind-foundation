// P-046 — Pricing checklist + CFO approval gate UI.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, Lock, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  pricingChecklistQueryOptions,
  useDecidePricingApproval,
  useSubmitPricingApproval,
} from "@/lib/proposal-query";
import { getPricingChecklist } from "@/lib/proposal.functions";

interface Props {
  proposalId: string;
  canWrite: boolean;
  isFinanceAdmin: boolean;
}

export function PricingApprovalCard({ proposalId, canWrite, isFinanceAdmin }: Props) {
  const fn = useServerFn(getPricingChecklist);
  const q = useQuery(pricingChecklistQueryOptions(fn, proposalId));

  const submit = useSubmitPricingApproval(proposalId);
  const decide = useDecidePricingApproval(proposalId);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  if (q.isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card className="p-4 text-sm text-destructive">
        Failed to load pricing checklist.{" "}
        <button type="button" className="underline" onClick={() => q.refetch()}>
          Retry
        </button>
      </Card>
    );
  }

  const { items, allPass, pricingLock, approvalInstance } = q.data;
  const lockStatus = pricingLock?.status;
  const pending = lockStatus === "pending" || approvalInstance?.status === "pending";
  const approved = lockStatus === "approved";
  const rejected = lockStatus === "rejected";

  const requestedAt = pricingLock?.requested_at ?? approvalInstance?.created_at ?? null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck size={16} aria-hidden />
            Pricing &amp; approval
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            CFO must approve pricing before the proposal can be sent.
          </p>
        </div>
        <StatusBadge
          approved={approved}
          rejected={rejected}
          pending={pending}
          requestedAt={requestedAt}
        />
      </header>

      <ul className="grid gap-1.5">
        {items.map((it) => (
          <li
            key={it.key}
            className={`flex items-start gap-2 text-xs ${
              it.pass ? "text-foreground" : "text-destructive"
            }`}
          >
            <span className="mt-0.5" aria-hidden>
              {it.pass ? <Check size={14} className="text-success" /> : <X size={14} />}
            </span>
            <span className="flex-1">
              <span className="font-medium">{it.label}</span>
              {it.detail && <span className="ml-1 text-muted-foreground">— {it.detail}</span>}
            </span>
          </li>
        ))}
      </ul>

      {approved && (
        <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success">
          <Lock size={14} className="mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Pricing locked by CFO approval</div>
            <div className="text-success/80">
              Margin, contingency, FX and totals are immutable. Create a new version to change
              pricing.
            </div>
          </div>
        </div>
      )}

      {rejected && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <ShieldAlert size={14} className="mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold">Rejected by CFO</div>
            {pricingLock?.comment && (
              <div className="text-destructive/80">{pricingLock.comment}</div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canWrite && !approved && (
          <Button
            size="sm"
            disabled={!allPass || pending || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting…" : pending ? "Submitted" : "Submit to CFO"}
          </Button>
        )}

        {isFinanceAdmin && pending && (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "approve" })}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
          </>
        )}

        {!allPass && !approved && (
          <span className="text-xs text-muted-foreground">
            Resolve every failing check to enable submission.
          </span>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject pricing</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Add a reason so the deal team can revise and resubmit.
          </p>
          <Textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            rows={4}
            placeholder="Reason for rejection…"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending || rejectComment.trim().length === 0}
              onClick={() =>
                decide.mutate(
                  { decision: "reject", comment: rejectComment.trim() },
                  {
                    onSuccess: () => {
                      setRejectOpen(false);
                      setRejectComment("");
                    },
                  },
                )
              }
            >
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StatusBadge({
  approved,
  rejected,
  pending,
  requestedAt,
}: {
  approved: boolean;
  rejected: boolean;
  pending: boolean;
  requestedAt: string | null;
}) {
  if (approved) {
    return <Badge className="bg-success/15 text-success hover:bg-success/15">Approved</Badge>;
  }
  if (rejected) return <Badge variant="destructive">Rejected</Badge>;
  if (pending) {
    const age = requestedAt
      ? formatDistanceToNowStrict(new Date(requestedAt), { addSuffix: false })
      : null;
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        Pending CFO review{age ? ` · ${age} ago` : ""}
      </Badge>
    );
  }
  return <Badge variant="outline">Draft</Badge>;
}
