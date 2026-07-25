// P-058 — Review round detail drawer.
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { getReviewRound } from "@/lib/drawing-reviews.functions";
import {
  reviewRoundQueryOptions,
  useCloseReviewRound,
  useSubmitSignoff,
  useWaiveSignoff,
} from "@/lib/drawing-reviews-query";
import { decisionLabel, roundIsComplete } from "@/lib/review-rules";

export function ReviewRoundDrawer({
  roundId,
  projectId,
  currentUserId,
  canWaive,
  canClose,
  onClose,
}: {
  roundId: string;
  projectId: string;
  currentUserId: string;
  canWaive: boolean;
  canClose: boolean;
  onClose: () => void;
}) {
  const fn = useServerFn(getReviewRound);
  const { data: round } = useSuspenseQuery(reviewRoundQueryOptions(fn, roundId));
  const submit = useSubmitSignoff(roundId, projectId);
  const waive = useWaiveSignoff(roundId, projectId);
  const close = useCloseReviewRound(roundId, projectId);

  return (
    <Sheet open onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {round.drawing_number} · rev {round.revision_code} · round #{round.round_no}
          </SheetTitle>
          <SheetDescription>{round.drawing_title}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>Status: {round.status}</Badge>
            <Badge variant="outline">Markups open: {round.markup_summary.open}</Badge>
            <Badge variant="outline">Resolved: {round.markup_summary.resolved}</Badge>
            {round.due_date && <Badge variant="outline">Due {round.due_date}</Badge>}
          </div>

          <Separator />

          <div className="space-y-3">
            {round.signoffs.map((s) => (
              <div key={s.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{s.reviewer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.reviewer_org} · {s.reviewer_email ?? "no email"}
                    </p>
                  </div>
                  <Badge variant={s.decision == null ? "outline" : "default"} className="text-xs">
                    {decisionLabel(s.decision)}
                  </Badge>
                </div>

                {s.decision != null && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {s.signed_at && (
                      <p>
                        Signed{" "}
                        {formatDistanceToNow(new Date(s.signed_at), {
                          addSuffix: true,
                        })}
                      </p>
                    )}
                    {s.comment && <p className="italic">"{s.comment}"</p>}
                  </div>
                )}

                {s.decision == null && s.reviewer_id === currentUserId && (
                  <SignoffForm
                    onSubmit={(decision, comment) =>
                      submit.mutate({
                        signoffId: s.id,
                        decision,
                        comment: comment || null,
                      })
                    }
                    pending={submit.isPending}
                  />
                )}

                {s.decision == null && s.reviewer_id !== currentUserId && canWaive && (
                  <WaiveForm
                    onSubmit={(comment) => waive.mutate({ signoffId: s.id, comment })}
                    pending={waive.isPending}
                  />
                )}
              </div>
            ))}
          </div>

          {canClose && round.status === "open" && roundIsComplete(round.signoffs) && (
            <Button variant="outline" onClick={() => close.mutate()} disabled={close.isPending}>
              Close round
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SignoffForm({
  onSubmit,
  pending,
}: {
  onSubmit: (decision: "approved" | "approved_with_comments" | "rejected", comment: string) => void;
  pending: boolean;
}) {
  const [decision, setDecision] = useState<"approved" | "approved_with_comments" | "rejected">(
    "approved",
  );
  const [comment, setComment] = useState("");
  const commentRequired = decision === "approved_with_comments" || decision === "rejected";
  const disabled = pending || (commentRequired && comment.trim().length === 0);

  return (
    <div className="mt-3 space-y-2">
      <div>
        <Label className="text-xs">Decision</Label>
        <Select value={decision} onValueChange={(v) => setDecision(v as any)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="approved_with_comments">Approved with comments</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">
          Comment {commentRequired && <span className="text-destructive">*</span>}
        </Label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Reviewer notes..."
        />
      </div>
      <Button size="sm" disabled={disabled} onClick={() => onSubmit(decision, comment.trim())}>
        Submit sign-off
      </Button>
    </div>
  );
}

function WaiveForm({
  onSubmit,
  pending,
}: {
  onSubmit: (comment: string) => void;
  pending: boolean;
}) {
  const [comment, setComment] = useState("");
  const disabled = pending || comment.trim().length === 0;
  return (
    <div className="mt-3 space-y-2">
      <Label className="text-xs">
        Waiver reason <span className="text-destructive">*</span>
      </Label>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Why is this reviewer being waived?"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onSubmit(comment.trim())}
      >
        Waive sign-off
      </Button>
    </div>
  );
}
