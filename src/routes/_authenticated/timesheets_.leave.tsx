// P-230 — Leave management: balances, my requests, manager decisions.
// Mobile-first at 390px; semantic tokens only.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarDays,
  CalendarOff,
  FileText,
  Palmtree,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";

import { LeaveRequestDialog } from "@/components/timesheets/leave-request-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelLeave,
  decideLeave,
  getLeaveOverview,
  signLeaveAttachment,
} from "@/lib/leave.functions";
import type { LeaveRow } from "@/lib/leave.server";
import { describeWorkingDays, LEAVE_TYPE_LABELS, type LeaveType } from "@/lib/timesheets/leave";

export const Route = createFileRoute("/_authenticated/timesheets_/leave")({
  head: () => ({
    meta: [
      { title: "Leave requests & balances — GridMind EPC" },
      {
        name: "description",
        content:
          "Request annual, sick, unpaid or travel leave, track your remaining entitlement and approve crew requests — approved days flow straight into weekly timesheets.",
      },
      { property: "og:title", content: "Leave requests & balances — GridMind EPC" },
      {
        property: "og:description",
        content: "Leave requests, balances and manager decisions with automatic timesheet entries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeavePage,
});

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatRange(from: string, to: string): string {
  const a = dayFmt.format(new Date(`${from}T00:00:00Z`));
  if (from === to) return a;
  return `${a} → ${dayFmt.format(new Date(`${to}T00:00:00Z`))}`;
}

function AttachmentLink({ id }: { id: string }) {
  const signFn = useServerFn(signLeaveAttachment);
  const open = useMutation({
    mutationFn: () => signFn({ data: { leave_request_id: id } }),
    onSuccess: (res) => {
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      else toast.error("Attachment is unavailable");
    },
    onError: () => toast.error("Could not open attachment"),
  });
  return (
    <Button variant="ghost" size="sm" onClick={() => open.mutate()} disabled={open.isPending}>
      <FileText className="mr-1.5 size-4" /> Attachment
    </Button>
  );
}

function LeavePage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getLeaveOverview);
  const overview = useQuery({ queryKey: ["leave", "overview"], queryFn: () => overviewFn() });

  const [decisionFor, setDecisionFor] = useState<LeaveRow | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [comment, setComment] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: ["leave", "overview"] });

  const decideFn = useServerFn(decideLeave);
  const decide = useMutation({
    mutationFn: () =>
      decideFn({
        data: {
          leave_request_id: decisionFor!.id,
          decision,
          comment: comment.trim() || null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        decision === "approved"
          ? `Approved — ${res.entries_created} timesheet entries created`
          : "Request rejected",
      );
      if (res.skipped_weeks.length) {
        toast.warning(`Locked weeks need manual adjustment: ${res.skipped_weeks.join(", ")}`, {
          duration: 8000,
        });
      }
      setDecisionFor(null);
      setComment("");
      refresh();
      void qc.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Decision failed"),
  });

  const cancelFn = useServerFn(cancelLeave);
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { leave_request_id: id } }),
    onSuccess: () => {
      toast.success("Request cancelled");
      refresh();
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not cancel"),
  });

  const data = overview.data;
  const balance = data?.balance;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Leave"
        description="Request time off, track your entitlement and approve crew requests."
        actions={<LeaveRequestDialog onDone={refresh} />}
      />

      {overview.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : overview.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load leave"
          description={(overview.error as Error)?.message ?? "Something went wrong."}
          action={
            <Button variant="outline" onClick={() => void overview.refetch()}>
              Retry
            </Button>
          }
        />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiTile
              label="Annual entitlement"
              value={`${numFmt.format(balance!.entitlement)} days`}
              hint="Policy default 21 days"
              icon={CalendarDays}
            />
            <KpiTile
              label="Annual remaining"
              value={`${numFmt.format(balance!.remaining)} days`}
              hint={`${numFmt.format(balance!.annualUsed)} used`}
              icon={Palmtree}
              status={balance!.remaining <= 0 ? "bad" : balance!.remaining < 5 ? "warning" : "good"}
            />
            <KpiTile
              label="Sick days used"
              value={`${numFmt.format(balance!.sickUsed)} days`}
              hint="Tracked separately from annual"
              icon={Stethoscope}
            />
          </div>

          {data.approvedThisYear.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Approved this year</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {data.approvedThisYear.map((r, i) => (
                  <span
                    key={`${r.request_number}-${i}`}
                    className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                  >
                    {r.request_number ?? "LR"} · {LEAVE_TYPE_LABELS[r.leave_type as LeaveType]} ·{" "}
                    {numFmt.format(r.days)} d
                  </span>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {data.isApprover ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pending decisions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.pending.length === 0 ? (
                  <EmptyState
                    compact
                    icon={CalendarOff}
                    title="Nothing waiting"
                    description="Crew leave requests will appear here for approval."
                  />
                ) : (
                  data.pending.map((r) => (
                    <div key={r.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {data.people[r.user_id] ?? "Team member"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.request_number} · {LEAVE_TYPE_LABELS[r.leave_type]} ·{" "}
                            {formatRange(r.date_from, r.date_to)}
                          </p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {describeWorkingDays(Number(r.days))}
                        {r.reason ? ` — ${r.reason}` : ""}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {r.attachment_path ? <AttachmentLink id={r.id} /> : null}
                        <Button
                          size="sm"
                          onClick={() => {
                            setDecisionFor(r);
                            setDecision("approved");
                            setComment("");
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDecisionFor(r);
                            setDecision("rejected");
                            setComment("");
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">My requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.myRequests.length === 0 ? (
                <EmptyState
                  compact
                  icon={Palmtree}
                  title="No leave requested yet"
                  description="Submit a request and it goes to your foreman for approval."
                />
              ) : (
                data.myRequests.map((r) => (
                  <div key={r.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {LEAVE_TYPE_LABELS[r.leave_type]} · {numFmt.format(Number(r.days))} d
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.request_number} · {formatRange(r.date_from, r.date_to)}
                        </p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    {r.decision_comment ? (
                      <p
                        className={
                          r.status === "rejected"
                            ? "mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
                            : "mt-2 text-sm text-muted-foreground"
                        }
                      >
                        {r.decision_comment}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.attachment_path ? <AttachmentLink id={r.id} /> : null}
                      {r.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(r.id)}
                        >
                          Cancel
                        </Button>
                      ) : r.status === "approved" ? (
                        <span className="text-xs text-muted-foreground">
                          Approved leave is withdrawn by a project admin.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={!!decisionFor} onOpenChange={(o) => !o && setDecisionFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision === "approved" ? "Approve leave" : "Reject leave"}</DialogTitle>
            <DialogDescription>
              {decisionFor
                ? `${decisionFor.request_number} · ${describeWorkingDays(Number(decisionFor.days))}`
                : ""}
              {decision === "approved"
                ? " Approving creates leave entries on the covered draft timesheets."
                : " A comment is required so the requester knows why."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-comment">
              Comment {decision === "rejected" ? "(required)" : "(optional)"}
            </Label>
            <Textarea
              id="decision-comment"
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisionFor(null)}>
              Close
            </Button>
            <Button
              variant={decision === "rejected" ? "destructive" : "default"}
              disabled={
                decide.isPending || (decision === "rejected" && comment.trim().length === 0)
              }
              onClick={() => decide.mutate()}
            >
              {decide.isPending
                ? "Saving…"
                : decision === "approved"
                  ? "Approve"
                  : "Reject request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
