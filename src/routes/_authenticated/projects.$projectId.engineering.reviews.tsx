// P-058 — Reviews tab route: rounds table + round detail drawer.
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  getMyReviewRoles,
  getReviewRound,
  listReviewRounds,
} from "@/lib/drawing-reviews.functions";
import { reviewRolesQueryOptions, reviewRoundsQueryOptions } from "@/lib/drawing-reviews-query";
import { decisionLabel, isOverdue } from "@/lib/review-rules";
import { ReviewRoundDrawer } from "@/components/engineering/reviews/ReviewRoundDrawer";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/reviews")({
  component: ReviewsPage,
  pendingComponent: () => (
    <div className="space-y-3">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">Failed to load reviews</p>
      <p className="mt-1 text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => reset()}>
        Retry
      </Button>
    </div>
  ),
});

function ReviewsPage() {
  const { projectId } = Route.useParams();
  const listFn = useServerFn(listReviewRounds);
  const rolesFn = useServerFn(getMyReviewRoles);

  const { data: rounds } = useSuspenseQuery(reviewRoundsQueryOptions(listFn, projectId));
  const { data: roles } = useSuspenseQuery(reviewRolesQueryOptions(rolesFn, projectId));

  const [openRoundId, setOpenRoundId] = useState<string | null>(null);

  const rows = useMemo(() => rounds ?? [], [rounds]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Drawing reviews</h2>
          <p className="text-sm text-muted-foreground">
            Reviewer sign-offs on IFD revisions gate promotion to IFC.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review rounds</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium">No review rounds yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a round from any IFD revision in the Drawings tab.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drawing</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead>Reviewers</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const overdue = isOverdue(r.due_date, r.status);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setOpenRoundId(r.id)}
                    >
                      <TableCell className="font-medium">
                        {r.drawing_number}
                        <div className="text-xs text-muted-foreground">{r.drawing_title}</div>
                      </TableCell>
                      <TableCell>{r.revision_code}</TableCell>
                      <TableCell>#{r.round_no}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline">
                            {r.signoff_summary.signed}/{r.signoff_summary.total} signed
                          </Badge>
                          {Object.entries(r.signoff_summary.by_decision).map(([k, v]) => (
                            <Badge key={k} variant={decisionVariant(k)} className="text-xs">
                              {decisionLabel(k === "pending" ? null : (k as any))}: {v}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.due_date ? (
                          <span
                            className={
                              overdue
                                ? "font-medium text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }
                          >
                            {r.due_date}
                            {overdue ? " · overdue" : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), {
                          addSuffix: true,
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openRoundId && (
        <ReviewRoundDrawer
          roundId={openRoundId}
          projectId={projectId}
          currentUserId={roles.userId}
          canWaive={roles.canWaive}
          canClose={roles.canClose}
          onClose={() => setOpenRoundId(null)}
        />
      )}
    </div>
  );
}

function decisionVariant(d: string): "default" | "secondary" | "destructive" | "outline" {
  if (d === "approved") return "default";
  if (d === "approved_with_comments") return "secondary";
  if (d === "rejected") return "destructive";
  if (d === "waived") return "outline";
  return "outline";
}

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "closed") return "secondary";
  if (s === "waived") return "outline";
  return "default";
}

// Ensure suspense query wrapper prefetches. Loader keeps it warm.
export const loader = async ({
  params,
  context,
}: {
  params: { projectId: string };
  context: any;
}) => {
  // These fetches are lazy; we rely on useSuspenseQuery. This loader is
  // intentionally a no-op — keeps the route file typechecked by TS.
  void params;
  void context;
  return null;
};
