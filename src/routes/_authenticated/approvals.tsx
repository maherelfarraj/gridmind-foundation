// P-112 — Approval inbox: pending / decided / all tabs with SLA countdowns and decide drawer.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Inbox as InboxIcon, XCircle } from "lucide-react";

import {
  decideApproval,
  getApprovalInstance,
  listMyApprovals,
  type InboxRow,
} from "@/lib/approvals.inbox.functions";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, statusLabel } from "@/components/ui/status-badge";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { TimesheetApprovalCard } from "@/components/timesheets/approval-summary-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — GridMind EPC" },
      { name: "description", content: "Pending approvals inbox with SLA countdowns." },
    ],
  }),
  component: ApprovalsPage,
});

type Tab = "pending" | "decided" | "all";

function slaBadge(row: InboxRow) {
  const due = row.sla_due_at ?? row.step_due_at;
  if (!due) return null;
  const dueDate = new Date(due);
  const diffMs = dueDate.getTime() - Date.now();
  const overdue = diffMs < 0;
  const within24 = !overdue && diffMs < 24 * 60 * 60 * 1000;
  const label = overdue
    ? `+${formatDistanceToNow(dueDate)} overdue`
    : `${formatDistanceToNow(dueDate)} left`;
  return (
    <StatusBadge
      status={overdue ? "overdue" : within24 ? "due_soon" : "scheduled"}
      label={label}
      icon={Clock}
    />
  );
}

function formatAmount(row: InboxRow) {
  if (row.amount == null) return null;
  return formatMoney(row.amount, row.currency ?? "USD");
}

function entityLink(row: InboxRow): string | null {
  switch (row.entity_type) {
    case "purchase_order":
      return `/procurement/pos/${row.entity_id}`;
    case "proposal":
    case "proposal_pricing":
      return `/crm/proposals/${row.entity_id}`;
    case "contract":
      return `/procurement/contracts/${row.entity_id}`;
    case "change_order":
      return `/finance/change-orders/${row.entity_id}`;
    case "timesheet":
      return "/timesheets";
    case "project_phase_gate":
      return `/projects/${row.entity_id}`;
    default:
      return null;
  }
}

// POL-3 — approvals inbox is card-based at every width (one-hand usable at 390px).
function ApprovalRow({ row, onOpen }: { row: InboxRow; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const amount = formatAmount(row);
  return (
    <button
      type="button"
      onClick={() => onOpen(row.instance_id)}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="mutedOutline">{statusLabel(row.entity_type)}</Badge>
          {row.escalated_at && (
            <StatusBadge
              status="escalated"
              label={t("adminMod.approvals.escalated")}
              icon={AlertTriangle}
            />
          )}
          <span className="min-w-0 truncate font-medium text-foreground">{row.title}</span>
          {amount && <span className="text-sm text-muted-foreground tabular-nums">· {amount}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{slaBadge(row)}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Step {row.step_order}/{row.total_steps}
          {row.step_role ? ` · ${row.step_role}` : ""}
        </span>
        {row.requester_name && <span>Requested by {row.requester_name}</span>}
        <span title={formatDateTime(row.requested_at)}>{formatRelative(row.requested_at)}</span>
        {row.approval_status !== "pending" && (
          <span className="ml-auto">
            <StatusBadge status={row.approval_status} />
          </span>
        )}
      </div>
    </button>
  );
}

function ApprovalList({ tab, onOpen }: { tab: Tab; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const listFn = useServerFn(listMyApprovals);
  const query = useQuery({
    queryKey: ["approvals", "list", tab],
    queryFn: () => listFn({ data: { tab } }),
    staleTime: 15_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {t("adminMod.approvals.loadError")}{" "}
        <Button size="sm" variant="ghost" onClick={() => query.refetch()}>
          {t("adminMod.approvals.retry")}
        </Button>
      </div>
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        title={
          tab === "pending"
            ? t("adminMod.approvals.empty.pending")
            : tab === "decided"
              ? t("adminMod.approvals.empty.decided")
              : t("adminMod.approvals.empty.all")
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <ApprovalRow key={r.approval_id} row={r} onOpen={onOpen} />
      ))}
    </div>
  );
}

function DecideDialog({
  approvalId,
  decision,
  open,
  onOpenChange,
  onDone,
}: {
  approvalId: string | null;
  decision: "approved" | "rejected";
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const decideFn = useServerFn(decideApproval);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      decideFn({
        data: {
          approval_id: approvalId!,
          decision,
          comment: comment.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("adminMod.approvals.decisionRecorded"));
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["timesheets"] });
      setComment("");
      onOpenChange(false);
      onDone();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : t("adminMod.approvals.decisionFailed");
      toast.error(msg);
    },
  });

  const disabled =
    !approvalId || mutation.isPending || (decision === "rejected" && comment.trim().length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision === "approved"
              ? t("adminMod.approvals.approveApproval")
              : t("adminMod.approvals.rejectApproval")}
          </DialogTitle>
          <DialogDescription>
            {decision === "rejected"
              ? t("adminMod.approvals.rejectReasonRequired")
              : t("adminMod.approvals.optionalNote")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={
            decision === "rejected"
              ? t("adminMod.approvals.rejectPlaceholder")
              : t("adminMod.approvals.optionalCommentPlaceholder")
          }
          rows={4}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t("adminMod.approvals.cancel")}
          </Button>
          <Button
            variant={decision === "rejected" ? "destructive" : "default"}
            onClick={() => mutation.mutate()}
            disabled={disabled}
          >
            {decision === "approved"
              ? t("adminMod.approvals.approve")
              : t("adminMod.approvals.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalDetailDrawer({
  instanceId,
  onClose,
}: {
  instanceId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const getFn = useServerFn(getApprovalInstance);
  const query = useQuery({
    queryKey: ["approvals", "detail", instanceId],
    queryFn: () => getFn({ data: { instance_id: instanceId! } }),
    enabled: !!instanceId,
  });

  const [decideOpen, setDecideOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const detail = query.data;

  const myPending = useMemo(() => {
    if (!detail) return null;
    const current = detail.steps.find((s) => s.step_order === detail.current_step);
    return current?.approvals.find((a) => a.status === "pending") ?? null;
  }, [detail]);

  const link = detail
    ? entityLink({
        entity_type: detail.entity_type,
        entity_id: detail.entity_id,
      } as InboxRow)
    : null;

  return (
    <Sheet open={!!instanceId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{detail?.title ?? "Approval"}</SheetTitle>
          <SheetDescription>
            {detail ? `${detail.entity_type} · ${detail.status}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        {query.isLoading && (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {query.error && (
          <div className="mt-6 text-sm text-destructive">
            Failed to load.{" "}
            <Button size="sm" variant="ghost" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {detail && (
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <div className="flex flex-wrap gap-3">
                {detail.amount != null && (
                  <div>
                    <span className="text-muted-foreground">Amount: </span>
                    <span className="font-medium">
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: detail.currency ?? "USD",
                      }).format(detail.amount)}
                    </span>
                  </div>
                )}
                {detail.requester_name && (
                  <div>
                    <span className="text-muted-foreground">Requester: </span>
                    <span className="font-medium">{detail.requester_name}</span>
                  </div>
                )}
                {detail.rule_key && (
                  <div>
                    <span className="text-muted-foreground">Rule: </span>
                    <span className="font-mono text-xs">{detail.rule_key}</span>
                  </div>
                )}
              </div>
              {link && (
                <a href={link} className="mt-2 inline-block text-sm text-primary hover:underline">
                  Open {detail.entity_type} →
                </a>
              )}
            </div>

            {detail.entity_type === "timesheet" && (
              <TimesheetApprovalCard timesheetId={detail.entity_id} />
            )}

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminMod.approvals.approvalChain")}
              </h3>
              <ol className="space-y-3">
                {detail.steps.map((step) => {
                  const done = step.approvals.every((a) => a.status !== "pending");
                  const current = step.step_order === detail.current_step;
                  return (
                    <li
                      key={step.step_order}
                      className={`rounded-lg border p-3 ${
                        current
                          ? "border-primary bg-primary/5"
                          : done
                            ? "border-border bg-muted/20"
                            : "border-dashed border-border"
                      }`}
                    >
                      <div className="mb-2 text-sm font-medium">Step {step.step_order}</div>
                      <ul className="space-y-1 text-sm">
                        {step.approvals.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2">
                            {a.status === "approved" ? (
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                            ) : a.status === "rejected" ? (
                              <XCircle className="h-4 w-4 text-destructive" />
                            ) : a.status === "skipped" ? (
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Clock className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span>{a.approver_name ?? a.approver_id.slice(0, 8)}</span>
                            <Badge variant="outline" className="text-xs">
                              {a.status}
                            </Badge>
                            {a.decided_at && (
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(a.decided_at), {
                                  addSuffix: true,
                                })}
                              </span>
                            )}
                            {a.comment && (
                              <p className="w-full text-xs text-muted-foreground">“{a.comment}”</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </div>

            {myPending && (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => {
                    setDecision("approved");
                    setDecideOpen(true);
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {t("adminMod.approvals.approve")}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setDecision("rejected");
                    setDecideOpen(true);
                  }}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  {t("adminMod.approvals.reject")}
                </Button>
              </div>
            )}

            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminMod.approvals.auditTrail")}
              </h3>
              <ul className="space-y-2 text-xs">
                {detail.audit.length === 0 && (
                  <li className="text-muted-foreground">No audit entries.</li>
                )}
                {detail.audit.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/10 p-2"
                  >
                    <span className="font-mono">{a.action}</span>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                    {a.actor_name && (
                      <span className="text-muted-foreground">· {a.actor_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <DecideDialog
          approvalId={myPending?.id ?? null}
          decision={decision}
          open={decideOpen}
          onOpenChange={setDecideOpen}
          onDone={() => query.refetch()}
        />
      </SheetContent>
    </Sheet>
  );
}

function ApprovalsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("pending");
  const [openInstance, setOpenInstance] = useState<string | null>(null);

  return (
    <div className="page-shell max-w-5xl">
      <PageHeader
        title={t("adminMod.approvals.title")}
        description={t("adminMod.approvals.description")}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="pending">{t("adminMod.approvals.tabs.pending")}</TabsTrigger>
          <TabsTrigger value="decided">{t("adminMod.approvals.tabs.decided")}</TabsTrigger>
          <TabsTrigger value="all">{t("adminMod.approvals.tabs.all")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <ApprovalList tab="pending" onOpen={setOpenInstance} />
        </TabsContent>
        <TabsContent value="decided" className="mt-4">
          <ApprovalList tab="decided" onOpen={setOpenInstance} />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <ApprovalList tab="all" onOpen={setOpenInstance} />
        </TabsContent>
      </Tabs>

      <ApprovalDetailDrawer instanceId={openInstance} onClose={() => setOpenInstance(null)} />
    </div>
  );
}
