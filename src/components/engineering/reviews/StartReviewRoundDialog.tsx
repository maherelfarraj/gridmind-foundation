// P-058 — Start Review Round dialog (invoked from the drawing detail page).
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { listEligibleReviewers } from "@/lib/drawing-reviews.functions";
import {
  eligibleReviewersQueryOptions,
  useStartReviewRound,
} from "@/lib/drawing-reviews-query";
import type { ReviewerOrg } from "@/lib/drawing-reviews.functions";

type PickedReviewer = { userId: string; org: ReviewerOrg };

export function StartReviewRoundDialog({
  projectId,
  revisionId,
  disabled,
}: {
  projectId: string;
  revisionId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          Start review round
        </Button>
      </DialogTrigger>
      {open && (
        <DialogInner
          projectId={projectId}
          revisionId={revisionId}
          onDone={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function DialogInner({
  projectId,
  revisionId,
  onDone,
}: {
  projectId: string;
  revisionId: string;
  onDone: () => void;
}) {
  const fn = useServerFn(listEligibleReviewers);
  const { data: reviewers } = useSuspenseQuery(
    eligibleReviewersQueryOptions(fn, projectId),
  );
  const start = useStartReviewRound(projectId);
  const [picked, setPicked] = useState<Record<string, PickedReviewer>>({});
  const [dueDate, setDueDate] = useState("");

  const toggle = (userId: string, suggested: ReviewerOrg) => {
    setPicked((prev) => {
      const copy = { ...prev };
      if (copy[userId]) delete copy[userId];
      else copy[userId] = { userId, org: suggested };
      return copy;
    });
  };
  const setOrg = (userId: string, org: ReviewerOrg) => {
    setPicked((prev) => ({ ...prev, [userId]: { userId, org } }));
  };

  const chosen = Object.values(picked);
  const canSubmit = chosen.length > 0 && !start.isPending;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Start review round</DialogTitle>
        <DialogDescription>
          Pick reviewers for this IFD revision. Every reviewer must sign
          (or be waived) before this drawing can be promoted to IFC.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Due date (optional)</Label>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-2">
          {reviewers.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">
              No eligible reviewers found. Assign client_viewer / lender_viewer
              or engineering roles to team members first.
            </p>
          )}
          {reviewers.map((r) => {
            const p = picked[r.user_id];
            return (
              <div
                key={r.user_id}
                className="flex items-center gap-2 rounded p-1"
              >
                <Checkbox
                  checked={!!p}
                  onCheckedChange={() => toggle(r.user_id, r.suggested_org)}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{r.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.roles.join(", ")}
                  </p>
                </div>
                {p && (
                  <Select
                    value={p.org}
                    onValueChange={(v) => setOrg(r.user_id, v as ReviewerOrg)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client">Client</SelectItem>
                      <SelectItem value="lender">Lender</SelectItem>
                      <SelectItem value="utility">Utility</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={start.isPending}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          onClick={() =>
            start.mutate(
              {
                revisionId,
                dueDate: dueDate || null,
                reviewers: chosen,
              },
              { onSuccess: onDone },
            )
          }
        >
          Open round ({chosen.length})
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
