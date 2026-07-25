// P-090 — Punch item detail with role-gated typed-name signoff.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ExternalLink, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, punchDetailQueryOptions } from "@/lib/qaqc-query";
import { markPunchReady, signoffPunchItem, voidPunchItem } from "@/lib/qaqc.functions";
import {
  PUNCH_CATEGORY_LABELS,
  PUNCH_STATUS_LABELS,
  QAQC_DISCIPLINE_LABELS,
  punchCategoryTint,
  punchStatusTint,
  type PunchCategory,
  type PunchStatus,
  type QaqcDiscipline,
} from "@/lib/qaqc.rules";

const paramsSchema = z.object({ id: z.string().uuid() });

export const Route = createFileRoute("/_authenticated/qaqc/punch/$id")({
  parseParams: (raw) => paramsSchema.parse(raw),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(punchDetailQueryOptions(params.id)),
  head: ({ params }) => ({
    meta: [
      { title: `Punch item — GridMind EPC` },
      {
        name: "description",
        content: `Punch item ${params.id.slice(0, 8)} — details, photos, and signoff.`,
      },
      { property: "og:title", content: "Punch item — GridMind EPC" },
      {
        property: "og:description",
        content: "Category, assignee, photos, and irreversible typed signoff.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PunchDetailPage,
});

function PunchDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detailQuery = useQuery(punchDetailQueryOptions(id));

  const [signoffOpen, setSignoffOpen] = useState(false);
  const [signoffName, setSignoffName] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const readyMut = useMutation({
    mutationFn: () => markPunchReady({ data: { id } }),
    onSuccess: () => {
      toast.success("Marked ready for review.");
      qc.invalidateQueries({ queryKey: ["qaqc", "punch"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const signoffMut = useMutation({
    mutationFn: (payload: { signoffName: string }) =>
      signoffPunchItem({ data: { id, signoffName: payload.signoffName } }),
    onSuccess: (row) => {
      toast.success(`${row.punch_number} closed.`);
      setSignoffOpen(false);
      setSignoffName("");
      qc.invalidateQueries({ queryKey: ["qaqc", "punch"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const voidMut = useMutation({
    mutationFn: (payload: { reason: string }) =>
      voidPunchItem({ data: { id, reason: payload.reason } }),
    onSuccess: () => {
      toast.success("Item voided.");
      setVoidOpen(false);
      setVoidReason("");
      qc.invalidateQueries({ queryKey: ["qaqc", "punch"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load punch item</AlertTitle>
          <AlertDescription>{errorMessage(detailQuery.error) || "Not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { item, photos, permissions } = detailQuery.data;
  const category = item.category as PunchCategory;
  const status = item.status as PunchStatus;
  const discipline = item.discipline as QaqcDiscipline;

  const signoffConfirmed =
    signoffName.trim().length >= 2 &&
    signoffName.trim().toLowerCase() === signoffName.trim().replace(/\s+/g, " ").toLowerCase();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-8">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/qaqc/punch">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{item.punch_number}</span>
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${punchCategoryTint(category)}`}
            >
              {PUNCH_CATEGORY_LABELS[category]}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs ${punchStatusTint(status)}`}>
              {PUNCH_STATUS_LABELS[status]}
            </span>
          </div>
          <h1 className="font-display text-xl font-semibold text-foreground md:text-2xl">
            {item.project_name ?? "—"} · {item.area}
          </h1>
        </div>
        {status !== "closed" && status !== "void" ? (
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/qaqc/ncrs/new"
              search={{
                projectId: item.project_id,
                source: "punch_item",
                sourceId: item.id,
                discipline,
                area: item.area ?? undefined,
              }}
            >
              Raise NCR
            </Link>
          </Button>
        ) : null}
      </header>

      {category === "A" && status !== "closed" && status !== "void" ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Category A blocker</AlertTitle>
          <AlertDescription>This item must be closed before COD / energization.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-2">
          <Row label="Discipline">{QAQC_DISCIPLINE_LABELS[discipline]}</Row>
          <Row label="Walk date">{item.walk_date}</Row>
          <Row label="Due date">{item.due_date ?? "—"}</Row>
          <Row label="Assigned to">{item.assignee_email ?? "Unassigned"}</Row>
          <Row label="Raised by">{item.raised_by_email ?? "—"}</Row>
          <Row label="Updated">{new Date(item.updated_at).toLocaleString()}</Row>
          <div className="md:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Description
            </div>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{item.description}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Photos ({photos.length})
          </div>
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos attached.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {photos.map((p) => (
                <a
                  key={p.id}
                  href={p.signed_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-md border border-border"
                >
                  {p.signed_url ? (
                    <img
                      src={p.signed_url}
                      alt={p.caption ?? "punch photo"}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      unavailable
                    </div>
                  )}
                  <div className="absolute right-1 top-1 rounded bg-background/80 p-0.5 opacity-0 shadow group-hover:opacity-100">
                    <ExternalLink className="h-3 w-3" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {item.signoff_at ? (
        <Card>
          <CardContent className="flex flex-col gap-1 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="h-4 w-4" /> Closed
            </div>
            <div className="text-sm text-foreground">
              Signed off by <strong>{item.signoff_name}</strong> on{" "}
              {new Date(item.signoff_at).toLocaleString()}. This action is irreversible.
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === "open" && permissions.canMarkReady ? (
          <Button onClick={() => readyMut.mutate()} disabled={readyMut.isPending}>
            {readyMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Mark ready for review
          </Button>
        ) : null}
        {status === "ready_for_review" && permissions.canSignoff ? (
          <Button onClick={() => setSignoffOpen(true)}>
            <Check className="mr-2 h-4 w-4" /> Sign off & close
          </Button>
        ) : null}
        {status !== "closed" && status !== "void" && permissions.canSignoff ? (
          <Button variant="outline" onClick={() => setVoidOpen(true)}>
            <X className="mr-2 h-4 w-4" /> Void
          </Button>
        ) : null}
        {status === "ready_for_review" && !permissions.canSignoff ? (
          <Badge variant="outline">Awaiting construction admin signoff</Badge>
        ) : null}
      </div>

      <Dialog open={signoffOpen} onOpenChange={setSignoffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign off and close {item.punch_number}</DialogTitle>
            <DialogDescription>
              Type your full name to confirm. This action is irreversible — closed items cannot be
              reopened.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="signoff-name">Full name</Label>
            <Input
              id="signoff-name"
              value={signoffName}
              onChange={(e) => setSignoffName(e.target.value)}
              placeholder="e.g. Alex Rivera"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignoffOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!signoffConfirmed || signoffMut.isPending}
              onClick={() => signoffMut.mutate({ signoffName: signoffName.trim() })}
            >
              {signoffMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm signoff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {item.punch_number}</DialogTitle>
            <DialogDescription>
              Voided items are archived and excluded from KPIs. Provide a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidReason.trim().length < 2 || voidMut.isPending}
              onClick={() => voidMut.mutate({ reason: voidReason.trim() })}
            >
              {voidMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Void item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}
