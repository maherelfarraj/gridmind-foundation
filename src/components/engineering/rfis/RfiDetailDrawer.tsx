// P-059 — RFI detail drawer (sheet).
import { useState, Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getMyRfiRole, getRfi } from "@/lib/rfi.functions";
import {
  rfiDetailQueryOptions,
  rfiRoleQueryOptions,
  useAnswerRfi,
  useCloseRfi,
} from "@/lib/rfi-query";
import { canAnswer, canClose, isOverdue } from "@/lib/rfi-rules";
import { RfiPriorityBadge, RfiStatusBadge } from "./rfi-badges";

export function RfiDetailDrawer({
  projectId,
  rfiId,
  open,
  onClose,
}: {
  projectId: string;
  rfiId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        {rfiId ? (
          <Suspense
            fallback={
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            }
          >
            <Body projectId={projectId} rfiId={rfiId} />
          </Suspense>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ projectId, rfiId }: { projectId: string; rfiId: string }) {
  const rfiFn = useServerFn(getRfi);
  const roleFn = useServerFn(getMyRfiRole);
  const { data: rfi } = useSuspenseQuery(rfiDetailQueryOptions(rfiFn, rfiId));
  const { data: role } = useSuspenseQuery(
    rfiRoleQueryOptions(roleFn, projectId),
  );
  const [answer, setAnswer] = useState("");
  const answerMut = useAnswerRfi(projectId, rfiId);
  const closeMut = useCloseRfi(projectId, rfiId);

  const overdue = isOverdue({ status: rfi.status, due_date: rfi.due_date });
  const answerAllowed = canAnswer({
    userId: role.userId,
    isAdmin: role.isAdmin,
    routed_to: rfi.routed_to,
    status: rfi.status,
  });
  const closeAllowed = canClose({
    userId: role.userId,
    isAdmin: role.isAdmin,
    raised_by: rfi.raised_by,
    status: rfi.status,
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {rfi.rfi_number}
          <RfiStatusBadge status={rfi.status} />
          <RfiPriorityBadge priority={rfi.priority} />
        </SheetTitle>
        <SheetDescription>{rfi.subject}</SheetDescription>
      </SheetHeader>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <Meta label="Discipline" value={rfi.discipline.replace("_", " ")} />
        <Meta
          label="Due"
          value={rfi.due_date ?? "—"}
          danger={overdue}
        />
        <Meta label="Raised by" value={rfi.raised_by_name ?? "—"} />
        <Meta label="Routed to" value={rfi.routed_to_name ?? "—"} />
        {rfi.drawing_number && (
          <Meta label="Drawing" value={rfi.drawing_number} />
        )}
        <Meta
          label="Created"
          value={format(new Date(rfi.created_at), "PP")}
        />
      </div>

      <Card className="p-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Question
        </p>
        <p className="whitespace-pre-wrap text-sm">{rfi.question}</p>
      </Card>

      {rfi.answer && (
        <Card className="p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Answer{" "}
            {rfi.answered_by_name ? `— ${rfi.answered_by_name}` : ""}
            {rfi.answered_at
              ? `, ${format(new Date(rfi.answered_at), "PPp")}`
              : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm">{rfi.answer}</p>
        </Card>
      )}

      {answerAllowed && !rfi.answer && (
        <Card className="flex flex-col gap-2 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Provide answer
          </p>
          <Textarea
            rows={4}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Answer this RFI…"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={answerMut.isPending || answer.trim().length < 3}
              onClick={() => answerMut.mutate({ answer })}
            >
              {answerMut.isPending ? "Saving…" : "Submit answer"}
            </Button>
          </div>
        </Card>
      )}

      {closeAllowed && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={closeMut.isPending}
            onClick={() => closeMut.mutate()}
          >
            {closeMut.isPending ? "Closing…" : "Close RFI"}
          </Button>
        </div>
      )}

      {rfi.closed_at && (
        <p className="text-xs text-muted-foreground">
          Closed {format(new Date(rfi.closed_at), "PPp")}
        </p>
      )}
    </>
  );
}

function Meta({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={danger ? "text-destructive" : "text-foreground"}>
        {value}
      </p>
    </div>
  );
}
