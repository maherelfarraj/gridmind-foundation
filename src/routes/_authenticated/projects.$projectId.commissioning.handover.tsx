// P-099 — Handover ceremony workspace: prereq gauntlet, CCC status,
// gate advance, and immutable audit timeline.
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  Handshake,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getHandoverBoard, signCccTransfer, type HandoverBoard } from "@/lib/handover.functions";
import {
  HANDOVER_PREREQ_KEYS,
  HANDOVER_REASON_LABELS,
  type HandoverPrereqKey,
} from "@/lib/handover.rules";

export const Route = createFileRoute("/_authenticated/projects/$projectId/commissioning/handover")({
  head: () => ({
    meta: [
      { title: "Handover — GridMind EPC" },
      {
        name: "description",
        content:
          "Care, Custody & Control transfer ceremony — advance the project into Operations with an immutable, approval-gated audit trail.",
      },
      { property: "og:title", content: "Handover — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Care, Custody & Control transfer ceremony — advance the project into Operations with an immutable, approval-gated audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HandoverWorkspace,
  errorComponent: HandoverError,
  notFoundComponent: () => (
    <Card className="p-6 text-center">
      <p className="text-sm text-muted-foreground">Project not found.</p>
    </Card>
  ),
});

function HandoverError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="p-6 text-center">
      <p className="text-sm text-destructive">Failed to load the handover workspace.</p>
      <Button
        className="mt-3"
        variant="outline"
        size="sm"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Retry
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prereq row
// ---------------------------------------------------------------------------
function PrereqRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 size={16} aria-hidden className="text-success" />
        ) : (
          <XCircle size={16} aria-hidden className="text-destructive" />
        )}
        <span className={cn(ok ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      </span>
      <Badge
        variant="outline"
        className={cn(
          ok
            ? "border-success/30 bg-success/10 text-success"
            : "border-destructive/30 bg-destructive/10 text-destructive",
        )}
      >
        {ok ? "Ready" : "Blocked"}
      </Badge>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Action label per audit action
// ---------------------------------------------------------------------------
const ACTION_LABELS: Record<string, string> = {
  "handover.ccc_signed": "CCC transfer signed",
  "gate.transition_requested": "Gate transition requested",
  "gate.transition_approved": "Gate approved",
  "gate.transition_rejected": "Gate rejected",
  "gate.checklist_toggled": "Checklist updated",
  "project.phase_change": "Project phase advanced",
  "certificate.signed": "Certificate signed",
  "certificate.signature_added": "Certificate signature added",
  "certificate.issued": "Certificate issued",
  "certificate.pdf_attached": "Certificate PDF attached",
};

function actionTone(action: string): string {
  if (action === "gate.transition_approved" || action === "handover.ccc_signed")
    return "border-success/30 bg-success/10 text-success";
  if (action === "gate.transition_rejected")
    return "border-destructive/30 bg-destructive/10 text-destructive";
  if (action === "project.phase_change") return "border-primary/30 bg-primary/10 text-primary";
  return "border-border bg-muted text-foreground";
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------
function HandoverWorkspace() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["handover-board", projectId] as const,
    queryFn: () => getHandoverBoard({ data: { projectId } }),
  });

  const advance = useMutation({
    mutationFn: () => signCccTransfer({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Handover gate submitted for approval");
      qc.invalidateQueries({ queryKey: ["handover-board", projectId] });
    },
    onError: (err: unknown) => {
      const anyErr = err as any;
      let reasons: { key: HandoverPrereqKey; label: string }[] | undefined;
      try {
        const body = anyErr?.body ? JSON.parse(anyErr.body) : null;
        reasons = body?.reasons as any;
      } catch {
        /* noop */
      }
      if (reasons && reasons.length > 0) {
        toast.error("Handover blocked", {
          description: reasons.map((r) => `• ${r.label}`).join("\n"),
        });
      } else {
        toast.error(anyErr?.message ?? "Advance failed");
      }
    },
  });

  const board = query.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Handover
          </h2>
          <p className="text-sm text-muted-foreground">
            Care, Custody &amp; Control transfer — advance into Operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/projects/$projectId/commissioning" params={{ projectId }}>
              <ShieldCheck size={14} aria-hidden />
              Back to tests
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} aria-hidden className={cn(query.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </header>

      {query.isLoading || !board ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <BoardBody
          board={board}
          projectId={projectId}
          onAdvance={() => advance.mutate()}
          advancing={advance.isPending}
        />
      )}
    </div>
  );
}

function BoardBody({
  board,
  projectId,
  onAdvance,
  advancing,
}: {
  board: HandoverBoard;
  projectId: string;
  onAdvance: () => void;
  advancing: boolean;
}) {
  const { prereqs, cccCertificate, handoverGate, approvers, permissions } = board;
  const codPassed = prereqs.passes.cod_signed;
  const allGreen = prereqs.reasons.length === 0;
  const failingLabels = prereqs.reasons.map((r) => r.label);

  const gateApproved = handoverGate?.status === "approved";
  const gateInReview = handoverGate?.status === "in_review";
  const canAdvance = permissions.canExecute && allGreen && !gateApproved && !gateInReview;

  return (
    <>
      {gateApproved ? (
        <Card className="border-success/30 bg-success/10 p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className="text-success" aria-hidden />
            <div className="flex-1">
              <p className="font-medium text-foreground">Project transferred to Operations</p>
              <p className="text-sm text-muted-foreground">
                Handover approved{" "}
                {handoverGate?.approved_at
                  ? new Date(handoverGate.approved_at).toLocaleString()
                  : ""}
                . O&amp;M and SCADA modules are now available.
              </p>
            </div>
          </div>
        </Card>
      ) : !codPassed ? (
        <Card className="border-border bg-card p-6 text-center">
          <Handshake size={28} aria-hidden className="mx-auto text-muted-foreground" />
          <p className="mt-2 font-medium text-foreground">
            Handover not started — complete COD first
          </p>
          <p className="text-sm text-muted-foreground">
            The Commercial Operation Date certificate has to be signed before the Care, Custody
            &amp; Control transfer becomes available.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/projects/$projectId/commissioning/certificates" params={{ projectId }}>
              Go to certificates
            </Link>
          </Button>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Prereq gauntlet */}
        <Card className="flex flex-col gap-3 border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} aria-hidden className="text-primary" />
            <h3 className="font-display text-base font-semibold text-foreground">Prerequisites</h3>
          </div>
          <ul className="flex flex-col gap-2">
            {HANDOVER_PREREQ_KEYS.map((k) => (
              <PrereqRow key={k} ok={prereqs.passes[k]} label={HANDOVER_REASON_LABELS[k]} />
            ))}
          </ul>

          {/* CCC certificate status card */}
          <div className="mt-2 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">CCC certificate</p>
            {cccCertificate ? (
              <div className="mt-1 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {cccCertificate.certificate_number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Effective {cccCertificate.effective_date ?? "—"} ·{" "}
                    {cccCertificate.signatures.length} signature
                    {cccCertificate.signatures.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    cccCertificate.status === "signed"
                      ? "border-success/30 bg-success/10 text-success"
                      : "bg-muted text-foreground",
                  )}
                >
                  {cccCertificate.status === "signed" ? "Signed" : "Pending signatures"}
                </Badge>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Not issued yet.</p>
                {codPassed ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/projects/$projectId/commissioning/certificates"
                      params={{ projectId }}
                    >
                      Issue CCC
                      <ArrowRight size={12} aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </Card>

        {/* Handover gate + advance */}
        <Card className="flex flex-col gap-3 border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Handshake size={16} aria-hidden className="text-primary" />
            <h3 className="font-display text-base font-semibold text-foreground">
              Handover phase gate
            </h3>
          </div>

          {handoverGate ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={cn(
                    handoverGate.status === "approved"
                      ? "border-success/30 bg-success/10 text-success"
                      : handoverGate.status === "in_review"
                        ? "border-warning/30 bg-warning/10 text-warning"
                        : handoverGate.status === "rejected"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "bg-muted text-foreground",
                  )}
                >
                  {handoverGate.status.replace(/_/g, " ")}
                </Badge>
              </div>

              <ul className="flex flex-col gap-1">
                {handoverGate.checklist.map((item: any) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      {item.done ? (
                        <CheckCircle2 size={12} className="text-success" aria-hidden />
                      ) : (
                        <AlertTriangle size={12} className="text-muted-foreground" aria-hidden />
                      )}
                      <span className="text-foreground">{item.label}</span>
                    </span>
                    <span className="text-muted-foreground">{item.done ? "Done" : "Pending"}</span>
                  </li>
                ))}
              </ul>

              {gateInReview && approvers ? (
                <p className="text-xs text-muted-foreground">
                  Approvers pending: {approvers.pending} of {approvers.total}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No handover gate is configured for this project.
            </p>
          )}

          <div className="mt-2">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-block">
                    <Button size="sm" disabled={!canAdvance || advancing} onClick={onAdvance}>
                      {advancing ? (
                        <Loader2 size={14} aria-hidden className="animate-spin" />
                      ) : (
                        <ArrowRight size={14} aria-hidden />
                      )}
                      Advance to Handover
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canAdvance ? (
                  <TooltipContent className="max-w-sm">
                    {gateApproved
                      ? "Handover already approved."
                      : gateInReview
                        ? "Handover already pending approval."
                        : !permissions.canExecute
                          ? "You need the construction, project, or company admin role to advance handover."
                          : failingLabels.length > 0
                            ? `Blocked by: ${failingLabels.join(" · ")}`
                            : "Not ready."}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </Card>
      </div>

      {/* Immutable audit timeline */}
      <Card className="border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <History size={16} aria-hidden className="text-primary" />
          <h3 className="font-display text-base font-semibold text-foreground">Gate history</h3>
          <Badge variant="outline" className="bg-muted text-muted-foreground">
            Append-only
          </Badge>
        </div>
        {board.history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No handover events yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {board.history.map((h) => (
              <li
                key={h.id}
                className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs", actionTone(h.action))}>
                      {ACTION_LABELS[h.action] ?? h.action}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {h.actor_name ?? h.actor_email ?? "System"}
                    {h.metadata?.phase ? ` · phase ${h.metadata.phase}` : ""}
                    {h.metadata?.from && h.metadata?.to
                      ? ` · ${h.metadata.from} → ${h.metadata.to}`
                      : ""}
                    {h.metadata?.parties &&
                    Array.isArray(h.metadata.parties) &&
                    h.metadata.parties.length > 0
                      ? ` · parties: ${h.metadata.parties.join(", ")}`
                      : ""}
                  </p>
                </div>
                <FileText size={14} aria-hidden className="mt-1 text-muted-foreground" />
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
