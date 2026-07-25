// P-091 — NCR detail with disposition + close/void actions.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, ncrDetailQueryOptions } from "@/lib/ncr-query";
import { closeNcr, setNcrDisposition, voidNcr } from "@/lib/ncr.functions";
import {
  daysOpen,
  NCR_DISPOSITION_LABELS,
  NCR_DISPOSITIONS,
  NCR_SOURCE_LABELS,
  NCR_STATUS_LABELS,
  ncrDispositionTint,
  ncrStatusTint,
  type NcrDisposition,
} from "@/lib/ncr.rules";

export const Route = createFileRoute("/_authenticated/qaqc/ncrs/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `NCR ${params.id.slice(0, 8)} — GridMind EPC` },
      { name: "description", content: "Non-conformance report detail." },
      { property: "og:title", content: "NCR detail — GridMind EPC" },
      {
        property: "og:description",
        content: "Disposition, corrective action, and closure for a non-conformance report.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NcrDetailPage,
});

function NcrDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const detailQuery = useQuery(ncrDetailQueryOptions(id));

  const [disposition, setDisposition] = useState<NcrDisposition>("pending");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  useEffect(() => {
    if (!detailQuery.data) return;
    const n = detailQuery.data.ncr;
    setDisposition(n.disposition);
    setRootCause(n.root_cause ?? "");
    setCorrectiveAction(n.corrective_action ?? "");
  }, [detailQuery.data]);

  const dispositionMut = useMutation({
    mutationFn: () =>
      setNcrDisposition({
        data: {
          id,
          disposition,
          rootCause: rootCause || null,
          correctiveAction: correctiveAction || null,
        } as any,
      }),
    onSuccess: async () => {
      toast.success("Disposition saved");
      await qc.invalidateQueries({ queryKey: ["ncr"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const closeMut = useMutation({
    mutationFn: () => closeNcr({ data: { id } }),
    onSuccess: async () => {
      toast.success("NCR closed");
      await qc.invalidateQueries({ queryKey: ["ncr"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const voidMut = useMutation({
    mutationFn: () => voidNcr({ data: { id, reason: voidReason } }),
    onSuccess: async () => {
      toast.success("NCR voided");
      setVoidOpen(false);
      setVoidReason("");
      await qc.invalidateQueries({ queryKey: ["ncr"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="page-shell">
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="page-shell">
        <Alert variant="destructive">
          <AlertTitle>Could not load NCR</AlertTitle>
          <AlertDescription>{errorMessage(detailQuery.error) || "Not found"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { ncr, source_summary, permissions } = detailQuery.data;
  const canWrite = permissions.canWrite && ncr.status !== "void" && ncr.status !== "closed";

  const useAsIsError =
    disposition === "use_as_is" && (!rootCause.trim() || !correctiveAction.trim())
      ? "Use-as-is requires both root cause and corrective action."
      : null;

  return (
    <div className="page-shell">
      <div>
        <Link
          to="/qaqc/ncrs"
          className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to NCRs
        </Link>
        <PageHeader
          title={ncr.ncr_number}
          description="Non-conformance report detail and disposition."
          actions={
            <>
              <Badge className={ncrStatusTint(ncr.status)} variant="outline">
                {NCR_STATUS_LABELS[ncr.status]}
              </Badge>
              <Badge className={ncrDispositionTint(ncr.disposition)} variant="outline">
                {NCR_DISPOSITION_LABELS[ncr.disposition]}
              </Badge>
            </>
          }
        />
        <span className="text-xs text-muted-foreground">
          {ncr.project_name ?? "—"} · {daysOpen(ncr)} days open
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Description
            </span>
            <p className="whitespace-pre-wrap">{ncr.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Source</span>
              <div>{NCR_SOURCE_LABELS[ncr.source]}</div>
              {source_summary ? (
                source_summary.href ? (
                  <Link
                    to={source_summary.href}
                    className="mt-1 inline-flex items-center gap-1 text-foreground hover:underline"
                  >
                    {source_summary.label}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <div className="text-muted-foreground">{source_summary.label}</div>
                )
              ) : null}
            </div>
            <div>
              <span className="text-muted-foreground">Discipline / area</span>
              <div>
                {ncr.discipline ?? "—"} / {ncr.area ?? "—"}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Cost impact</span>
              <div>
                {ncr.cost_impact === null || ncr.cost_impact === undefined
                  ? "—"
                  : new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: ncr.currency_code ?? "USD",
                    }).format(Number(ncr.cost_impact))}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Raised</span>
              <div>{new Date(ncr.created_at).toLocaleString()}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disposition</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Disposition</Label>
            <Select
              value={disposition}
              onValueChange={(v) => setDisposition(v as NcrDisposition)}
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NCR_DISPOSITIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {NCR_DISPOSITION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              Root cause
              {disposition === "use_as_is" ? (
                <span className="ml-1 text-destructive">*</span>
              ) : null}
            </Label>
            <Textarea
              rows={3}
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>
              Corrective action
              {disposition === "use_as_is" ? (
                <span className="ml-1 text-destructive">*</span>
              ) : null}
            </Label>
            <Textarea
              rows={3}
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          {useAsIsError ? <p className="text-xs text-destructive">{useAsIsError}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={!canWrite || !!useAsIsError || dispositionMut.isPending}
              onClick={() => dispositionMut.mutate()}
            >
              {dispositionMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save disposition
            </Button>
          </div>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closure</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setVoidOpen(true)}
              disabled={voidMut.isPending}
            >
              Void
            </Button>
            <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
              {closeMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Close NCR
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void NCR</DialogTitle>
            <DialogDescription>
              Voiding hides this NCR from open counts and is not reversible.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label>Reason</Label>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Why is this being voided?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidReason.trim().length < 2 || voidMut.isPending}
              onClick={() => voidMut.mutate()}
            >
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
