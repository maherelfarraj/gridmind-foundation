// P-040 — Gates tab: checklists, approval-gated transitions, immutable history.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  ShieldCheck,
  User2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import {
  decideGateTransition,
  requestGateTransition,
  toggleGateChecklistItem,
  updateGateChecklistItemMeta,
} from "@/lib/gates.functions";
import { gateHistoryQueryOptions } from "@/lib/gates-query";
import { projectDetailQueryOptions } from "@/lib/projects-detail-query";
import type { GateChecklistItem, ProjectDetail, ProjectDetailGate } from "@/lib/projects.functions";

const GATE_STATUS_STYLES: Record<string, string> = {
  approved: "bg-primary text-primary-foreground",
  in_review: "bg-accent text-accent-foreground",
  open: "border border-primary text-primary bg-background",
  locked: "bg-muted text-muted-foreground",
  rejected: "bg-destructive text-destructive-foreground",
};

const ACTION_ICON: Record<string, typeof CheckCircle2> = {
  "gate.transition_approved": CheckCircle2,
  "gate.transition_rejected": XCircle,
  "gate.transition_requested": Clock,
  "gate.checklist_toggled": ListChecks,
  "project.phase_change": ShieldCheck,
};

const ACTION_LABEL: Record<string, string> = {
  "gate.transition_approved": "Transition approved",
  "gate.transition_rejected": "Transition rejected",
  "gate.transition_requested": "Transition requested",
  "gate.checklist_toggled": "Checklist updated",
  "project.phase_change": "Project phase advanced",
  "project_gate.approved": "Gate marked approved",
  "project_gate.open": "Gate opened",
  "project_gate.in_review": "Gate entered review",
  "project_gate.locked": "Gate locked",
};

export const Route = createFileRoute("/_authenticated/projects/$projectId/gates")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(projectDetailQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(gateHistoryQueryOptions(params.projectId)),
    ]),
  component: GatesTab,
  errorComponent: ({ error, reset }) => (
    <Alert variant="destructive">
      <AlertTitle>Failed to load gates</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{(error as Error)?.message ?? "Unknown error"}</span>
        <Button size="sm" variant="outline" onClick={() => reset()}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  ),
});

function canEditChecklist(project: ProjectDetail) {
  return project.caller_roles.some((r) => r === "company_admin" || r === "project_admin");
}

function GatesTab() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(projectId));
  const { data: history } = useSuspenseQuery(gateHistoryQueryOptions(projectId));

  if (!project) return null;

  const canEdit = canEditChecklist(project);
  const gates = [...project.gates].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        {gates.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No gates configured.</Card>
        ) : (
          gates.map((g) => (
            <GateCard
              key={g.id}
              gate={g}
              projectId={projectId}
              canEdit={canEdit}
              members={project.members}
            />
          ))
        )}
      </div>

      <Card className="p-5 lg:sticky lg:top-4 lg:h-fit">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Gate history
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gate activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((entry) => {
              const Icon = ACTION_ICON[entry.action] ?? ListChecks;
              const label = ACTION_LABEL[entry.action] ?? entry.action;
              const meta = entry.metadata ?? {};
              const detail = summarizeMetadata(entry.action, meta);
              return (
                <li key={entry.id} className="flex gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    {detail ? (
                      <p className="truncate text-xs text-muted-foreground">{detail}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {entry.actor_name ?? entry.actor_email ?? "system"} ·{" "}
                      {formatDistanceToNow(new Date(entry.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function summarizeMetadata(action: string, meta: Record<string, any>): string | null {
  if (action === "gate.checklist_toggled") {
    return `${meta.key} · ${meta.done ? "done" : "undone"}`;
  }
  if (action === "gate.transition_approved") {
    return meta.next_phase ? `→ ${meta.next_phase}` : "final phase";
  }
  if (action === "gate.transition_rejected") {
    return meta.comment ? `“${String(meta.comment).slice(0, 80)}”` : "rejected";
  }
  if (action === "project.phase_change") {
    return `${meta.from} → ${meta.to}`;
  }
  if (action?.startsWith("project_gate.")) {
    return `${meta.phase} · ${meta.from ?? "?"} → ${meta.to ?? "?"}`;
  }
  return null;
}

function GateCard({
  gate,
  projectId,
  canEdit,
  members,
}: {
  gate: ProjectDetailGate;
  projectId: string;
  canEdit: boolean;
  members: ProjectDetail["members"];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["project-detail", projectId] });
    qc.invalidateQueries({ queryKey: ["gate-history", projectId] });
    router.invalidate();
  };

  const toggle = useMutation({
    mutationFn: (vars: { key: string; done: boolean }) =>
      toggleGateChecklistItem({
        data: { gate_id: gate.id, key: vars.key, done: vars.done },
      }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["project-detail", projectId] });
      const prev = qc.getQueryData<ProjectDetail | null>(["project-detail", projectId]);
      if (prev) {
        qc.setQueryData<ProjectDetail>(["project-detail", projectId], {
          ...prev,
          gates: prev.gates.map((g) =>
            g.id !== gate.id
              ? g
              : {
                  ...g,
                  checklist: g.checklist.map((it) =>
                    it.key === vars.key ? { ...it, done: vars.done } : it,
                  ),
                },
          ),
        });
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["project-detail", projectId], ctx.prev);
      toast.error((err as Error).message || "Toggle failed");
    },
    onSuccess: () => {
      invalidateAll();
    },
  });

  const request = useMutation({
    mutationFn: () => requestGateTransition({ data: { gate_id: gate.id } }),
    onSuccess: () => {
      toast.success("Transition requested");
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message || "Request failed"),
  });

  const decide = useMutation({
    mutationFn: (vars: { decision: "approve" | "reject"; comment?: string }) =>
      decideGateTransition({
        data: {
          approval_id: gate.approval!.my_approval_id!,
          decision: vars.decision,
          comment: vars.comment,
        },
      }),
    onSuccess: (_d, vars) => {
      toast.success(vars.decision === "approve" ? "Approved" : "Rejected");
      setRejectOpen(false);
      setRejectComment("");
      invalidateAll();
    },
    onError: (err) => toast.error((err as Error).message || "Decision failed"),
  });

  const requiredDone = gate.checklist.filter((i) => i.required).every((i) => i.done);
  const doneCount = gate.checklist.filter((i) => i.done).length;
  const readinessPct =
    gate.checklist.length === 0 ? 0 : Math.round((doneCount / gate.checklist.length) * 100);
  const canRequest = canEdit && gate.status === "open" && requiredDone && gate.checklist.length > 0;
  const canDecide =
    gate.status === "in_review" &&
    gate.approval?.my_approval_id &&
    gate.approval?.my_approval_status === "pending";

  const itemsDisabled = !canEdit || (gate.status !== "open" && gate.status !== "in_review");

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">{gate.name}</h3>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {gate.phase}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {gate.checklist.length > 0 ? (
            <span className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-xs font-medium text-foreground">
              {readinessPct}% ready · {doneCount}/{gate.checklist.length}
            </span>
          ) : null}
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${
              GATE_STATUS_STYLES[gate.status] ?? "bg-muted text-muted-foreground"
            }`}
          >
            {gate.status.replace("_", " ")}
          </span>
        </div>
      </div>

      {gate.checklist.length > 0 ? (
        <div
          className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={readinessPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${gate.name} readiness`}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${readinessPct}%` }} />
        </div>
      ) : null}

      {gate.checklist.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items.</p>
      ) : (
        <TooltipProvider delayDuration={200}>
          <ul className="flex flex-col gap-2">
            {gate.checklist.map((it) => (
              <ChecklistRow
                key={it.key}
                item={it}
                gateId={gate.id}
                projectId={projectId}
                members={members}
                canEdit={canEdit && gate.status !== "approved"}
                disabled={itemsDisabled || toggle.isPending}
                onToggle={(v) => toggle.mutate({ key: it.key, done: v })}
                lockReason={
                  !canEdit
                    ? "Only company or project admins can toggle checklist items."
                    : gate.status === "locked"
                      ? "Gate is locked. Complete the previous gate first."
                      : gate.status === "approved"
                        ? "Gate already approved."
                        : null
                }
              />
            ))}
          </ul>
        </TooltipProvider>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {gate.status === "open" ? (
          <Button
            size="sm"
            disabled={!canRequest || request.isPending}
            onClick={() => request.mutate()}
          >
            {request.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Request transition
          </Button>
        ) : null}

        {canDecide ? (
          <>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: "approve" })}
            >
              {decide.isPending && decide.variables?.decision === "approve" ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
          </>
        ) : null}

        {gate.status === "in_review" && !canDecide ? (
          <span className="text-xs text-muted-foreground">Awaiting approver decision.</span>
        ) : null}

        {gate.status === "approved" ? (
          <span className="text-xs text-muted-foreground">
            Approved
            {gate.approved_at
              ? ` ${formatDistanceToNow(new Date(gate.approved_at), { addSuffix: true })}`
              : null}
          </span>
        ) : null}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject transition</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-foreground">Comment (required)</label>
            <Textarea
              rows={4}
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Explain why this gate is being rejected."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={rejectComment.trim().length === 0 || decide.isPending}
              onClick={() => decide.mutate({ decision: "reject", comment: rejectComment.trim() })}
            >
              {decide.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ChecklistRow({
  item,
  disabled,
  onToggle,
  lockReason,
  gateId,
  projectId,
  members,
  canEdit,
}: {
  item: GateChecklistItem;
  disabled: boolean;
  onToggle: (v: boolean) => void;
  lockReason: string | null;
  gateId: string;
  projectId: string;
  members: ProjectDetail["members"];
  canEdit: boolean;
}) {
  const [metaOpen, setMetaOpen] = useState(false);
  const overdue =
    !item.done && !!item.due_date && new Date(`${item.due_date}T23:59:59`).getTime() < Date.now();

  const row = (
    <li className="flex items-start gap-3 rounded-md py-1">
      <Checkbox
        checked={item.done}
        disabled={disabled}
        onCheckedChange={(v) => onToggle(v === true)}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-foreground">
            {item.label}
            {item.required ? <span className="ml-1 text-xs text-muted-foreground">*</span> : null}
          </p>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setMetaOpen(true)}
            >
              <Pencil size={12} aria-hidden />
              Details
            </Button>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <User2 size={11} aria-hidden />
            {item.owner_name ?? "Unassigned"}
          </span>
          <span
            className={
              overdue
                ? "inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
                : "inline-flex items-center gap-1"
            }
          >
            <CalendarDays size={11} aria-hidden />
            {item.due_date ? `Due ${item.due_date}` : "No due date"}
          </span>
          {item.evidence_url ? (
            item.evidence_url.startsWith("http") ? (
              <a
                href={item.evidence_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Paperclip size={11} aria-hidden />
                {item.evidence_label || "Evidence"}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Paperclip size={11} aria-hidden />
                {item.evidence_label || item.evidence_url}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 italic">
              <Paperclip size={11} aria-hidden />
              Evidence slot empty
            </span>
          )}
        </div>
        {item.done && item.done_at ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {item.done_by_name ?? "member"} ·{" "}
            {formatDistanceToNow(new Date(item.done_at), { addSuffix: true })}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <ChecklistMetaDialog
          open={metaOpen}
          onOpenChange={setMetaOpen}
          item={item}
          gateId={gateId}
          projectId={projectId}
          members={members}
        />
      ) : null}
    </li>
  );
  if (lockReason && disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{row}</div>
        </TooltipTrigger>
        <TooltipContent>{lockReason}</TooltipContent>
      </Tooltip>
    );
  }
  return row;
}

function ChecklistMetaDialog({
  open,
  onOpenChange,
  item,
  gateId,
  projectId,
  members,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: GateChecklistItem;
  gateId: string;
  projectId: string;
  members: ProjectDetail["members"];
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const [ownerId, setOwnerId] = useState(item.owner_id ?? "");
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [label, setLabel] = useState(item.evidence_label ?? "");
  const [url, setUrl] = useState(item.evidence_url ?? "");

  const save = useMutation({
    mutationFn: () =>
      updateGateChecklistItemMeta({
        data: {
          gate_id: gateId,
          key: item.key,
          owner_id: ownerId ? ownerId : null,
          due_date: dueDate ? dueDate : null,
          evidence_label: label.trim() || null,
          evidence_url: url.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Checklist item updated");
      qc.invalidateQueries({ queryKey: ["project-detail", projectId] });
      qc.invalidateQueries({ queryKey: ["gate-history", projectId] });
      router.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message || "Update failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.label}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`owner-${item.key}`}>Owner</Label>
            <select
              id={`owner-${item.key}`}
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email ?? m.user_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`due-${item.key}`}>Due date</Label>
            <Input
              id={`due-${item.key}`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`evlabel-${item.key}`}>Evidence label</Label>
            <Input
              id={`evlabel-${item.key}`}
              value={label}
              placeholder="e.g. NEPCO application ref 2026-0142"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`evurl-${item.key}`}>Evidence link or storage path</Label>
            <Input
              id={`evurl-${item.key}`}
              value={url}
              placeholder="https://… or documents/…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
