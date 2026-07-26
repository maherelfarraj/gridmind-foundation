// P-146 — Governance dock: status pill + transitions, approval strip, review rounds.
import { useState } from "react";
import { CheckCircle2, Clock, Info, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSldGovernance, useTransitionSldStatus } from "@/lib/sld-status-query";
import type { SldStatus } from "@/lib/sld/status-machine";

type Props = { drawingId: string; canEdit: boolean };

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function GovernancePanel({ drawingId, canEdit }: Props) {
  const governance = useSldGovernance(drawingId);
  const transition = useTransitionSldStatus(drawingId);
  const [comment, setComment] = useState("");
  const [replacement, setReplacement] = useState("");

  const data = governance.data as any;
  if (governance.isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading governance…</p>;
  }

  const guards = data.guards ?? {};
  const approval = data.approval;
  const transitions = (data.transitions ?? []) as Array<{
    target: SldStatus;
    allowed: boolean;
    reason: string | null;
  }>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={String(data.drawing.status)} />
        {data.drawing.locked ? <Badge variant="outline">Locked</Badge> : null}
        <span className="text-xs text-muted-foreground">
          Rev {data.revision?.code ?? "—"} · {guards.objectCount ?? 0} objects
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant={guards.hasValidation ? "secondary" : "outline"}>
          {guards.hasValidation
            ? `Validated ${formatDate(guards.validationRanAt)}`
            : "Not validated"}
        </Badge>
        <Badge variant={guards.errorCount > 0 ? "destructive" : "secondary"}>
          {guards.errorCount} errors
        </Badge>
        <Badge variant="outline">{guards.openSignoffs} open signoffs</Badge>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Transition comment</Label>
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Reason recorded in the audit log"
          disabled={!canEdit}
        />
        <Label className="text-xs">Replacement drawing id (supersede only)</Label>
        <Input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="uuid of the drawing that replaces this one"
          disabled={!canEdit}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => {
          const disabled = !canEdit || !t.allowed || transition.isPending;
          const btn = (
            <Button
              key={t.target}
              size="sm"
              variant={t.allowed ? "default" : "outline"}
              disabled={disabled}
              onClick={() =>
                transition.mutate({
                  target: t.target,
                  comment,
                  metadata: replacement ? { replacement_drawing_id: replacement } : {},
                })
              }
            >
              {t.target.replace("_", " ")}
            </Button>
          );
          if (t.allowed) return btn;
          return (
            <Tooltip key={t.target}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{btn}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <span className="flex items-start gap-2">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  {t.reason ?? "Not available."}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4" /> Approval progress
        </h4>
        {!approval ? (
          <p className="text-xs text-muted-foreground">
            No approval instance yet — request approval to start sld_drawing_approval.
          </p>
        ) : (
          <div className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center justify-between text-xs">
              <StatusBadge status={String(approval.status)} />
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3" /> SLA {formatDate(approval.sla_due_at)}
              </span>
            </div>
            {(approval.steps ?? []).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span>
                  Step {s.step_order} · {s.approver_name || s.approver_id.slice(0, 8)}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {s.status === "approved" ? <CheckCircle2 className="size-3" /> : null}
                  {s.status} · {formatDate(s.due_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">Review rounds</h4>
        {(data.rounds ?? []).length === 0 ? (
          <EmptyState
            title="No review rounds"
            description="Requesting review opens a round and notifies reviewers."
          />
        ) : (
          (data.rounds as any[]).map((r) => (
            <div key={r.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between text-xs">
                <span>Round {r.round_no}</span>
                <StatusBadge status={String(r.status)} />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(r.signoffs ?? []).length === 0 ? (
                  <span className="text-xs text-muted-foreground">No reviewers assigned</span>
                ) : (
                  (r.signoffs as any[]).map((s) => (
                    <Badge
                      key={s.id}
                      variant={
                        s.decision === "rejected"
                          ? "destructive"
                          : s.decision
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {s.reviewer_org} · {s.decision ?? "pending"}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
