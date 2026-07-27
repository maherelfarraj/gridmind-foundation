// P-190 — Read-only reviewer routing stepper mirroring the live P-111 chain.
import { formatDistanceToNow } from "date-fns";
import { Clock } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import type { ChangeDetail } from "@/lib/moc.server";
import { cn } from "@/lib/utils";

function slaBadge(due: string | null) {
  if (!due) return null;
  const dueDate = new Date(due);
  const diffMs = dueDate.getTime() - Date.now();
  const overdue = diffMs < 0;
  const within24 = !overdue && diffMs < 24 * 60 * 60 * 1000;
  return (
    <StatusBadge
      status={overdue ? "overdue" : within24 ? "due_soon" : "scheduled"}
      label={
        overdue ? `+${formatDistanceToNow(dueDate)} overdue` : `${formatDistanceToNow(dueDate)} left`
      }
      icon={Clock}
    />
  );
}

export function ReviewerStepper({
  steps,
  currentStep,
}: {
  steps: ChangeDetail["steps"];
  currentStep: number | null;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reviewer chain yet — routing is resolved when the change is submitted.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {steps.map((step) => {
        const isCurrent = currentStep === step.step_order;
        return (
          <li
            key={step.step_order}
            className={cn(
              "rounded-md border border-border bg-card p-3",
              isCurrent && "border-primary/50 bg-primary/5",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                Step {step.step_order}
                {step.role ? (
                  <span className="ml-2 text-muted-foreground">{step.role.replaceAll("_", " ")}</span>
                ) : null}
              </p>
              {isCurrent ? <StatusBadge status="in_progress" label="Current step" /> : null}
            </div>
            {step.approvers.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Awaiting approver assignment.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {step.approvers.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-foreground">
                      {a.approver_name ?? "Unnamed approver"}
                      {a.is_me ? <span className="ml-1 text-muted-foreground">(you)</span> : null}
                    </span>
                    <StatusBadge status={a.status} />
                    {a.status === "pending" ? slaBadge(a.due_at) : null}
                    {a.decided_at ? (
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(a.decided_at)}
                      </span>
                    ) : null}
                    {a.comment ? (
                      <span className="w-full text-xs text-muted-foreground">“{a.comment}”</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
