// GC-07 — Period Close Cockpit: checklist, exceptions, evidence and audit trail.
// Presentation only: every gate rendered here is re-evaluated server-side.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  ListChecks,
  Paperclip,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  CHECKLIST_STATUSES,
  EXCEPTION_STATUSES,
  buildChecklistCsv,
  buildExceptionsCsv,
  checklistProgress,
  criticalPath,
  filterChecklist,
  groupByCategory,
  isDone,
  isOverdue,
  type ChecklistItem,
  type ChecklistItemStatus,
  type CloseException,
  type ExceptionStatus,
} from "@/lib/costing.checklist";
import {
  setChecklistItem,
  setExceptionStatus,
  detachChecklistEvidence,
} from "@/lib/costing.checklist.functions";
import { closeCockpitQueryOptions } from "@/lib/costing.checklist.query";
import { costingErrorMessage } from "@/lib/costing.query";
import { downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cockpit";

export interface CloseCockpitProps {
  projectId: string;
  period?: string;
}

export function CloseCockpit({ projectId, period }: CloseCockpitProps) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(closeCockpitQueryOptions(projectId, period));

  const itemFn = useServerFn(setChecklistItem);
  const exceptionFn = useServerFn(setExceptionStatus);
  const unlinkFn = useServerFn(detachChecklistEvidence);

  const [status, setStatus] = useState<ChecklistItemStatus | "all" | "outstanding">("all");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const invalidate = () => qc.invalidateQueries({ queryKey: ["costing"] });
  const nameOf = useMemo(() => {
    const map = new Map(data.people.map((p) => [p.id, p.name]));
    return (id: string | null | undefined) => (id ? (map.get(id) ?? id) : "");
  }, [data.people]);

  const progress = checklistProgress(data.items, data.today);
  const critical = criticalPath(data.items).slice(0, 5);
  const visible = filterChecklist(data.items, { status, ownerId, category });
  const groups = groupByCategory(visible);
  const categories = [...new Set(data.items.map((i) => i.category))].sort();

  const updateItem = useMutation({
    mutationFn: (vars: {
      item: ChecklistItem;
      status?: ChecklistItemStatus;
      assigneeId?: string | null;
      reviewerId?: string | null;
      notes?: string | null;
      waiverReason?: string | null;
    }) =>
      itemFn({
        data: {
          itemId: vars.item.id,
          expectedVersion: vars.item.row_version,
          ...(vars.status ? { status: vars.status } : {}),
          ...(vars.assigneeId !== undefined ? { assigneeId: vars.assigneeId } : {}),
          ...(vars.reviewerId !== undefined ? { reviewerId: vars.reviewerId } : {}),
          ...(vars.notes !== undefined ? { notes: vars.notes } : {}),
          ...(vars.waiverReason !== undefined ? { waiverReason: vars.waiverReason } : {}),
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.itemUpdated`));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const updateException = useMutation({
    mutationFn: (vars: { row: CloseException; status: ExceptionStatus; note: string }) =>
      exceptionFn({
        data: {
          exceptionId: vars.row.id,
          expectedVersion: vars.row.row_version,
          status: vars.status,
          note: vars.note.trim() || null,
        },
      }),
    onSuccess: async () => {
      toast.success(t(`${K}.exceptionUpdated`));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const unlink = useMutation({
    mutationFn: (evidenceId: string) => unlinkFn({ data: { evidenceId } }),
    onSuccess: async () => {
      toast.success(t(`${K}.evidenceRemoved`));
      await invalidate();
    },
    onError: (e) => toast.error(costingErrorMessage(e)),
  });

  const monthLabel = data.close.focusPeriod.slice(0, 7);

  if (!data.run) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={ClipboardList}
          title={t(`${K}.emptyTitle`)}
          description={t(`${K}.emptyBody`)}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={t(`${K}.kpi.progress`)}
          value={progress.pct === null ? "—" : `${progress.pct}%`}
          hint={t(`${K}.kpi.progressHint`, { done: progress.done, total: progress.total })}
          icon={ListChecks}
          status={progress.pct === 100 ? "good" : "neutral"}
        />
        <KpiTile
          label={t(`${K}.kpi.requiredOutstanding`)}
          value={progress.requiredOutstanding}
          hint={t(`${K}.kpi.requiredOutstandingHint`)}
          icon={ClipboardList}
          status={progress.requiredOutstanding > 0 ? "warning" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.overdue`)}
          value={progress.overdue}
          hint={t(`${K}.kpi.overdueHint`)}
          icon={CalendarClock}
          status={progress.overdue > 0 ? "bad" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.blockers`)}
          value={data.blockers.reduce((a, b) => a + b.count, 0)}
          hint={t(`${K}.kpi.blockersHint`)}
          icon={ShieldAlert}
          status={data.gateReady ? "good" : "bad"}
        />
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t(`${K}.gateTitle`, { period: monthLabel })}
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `close-checklist-${monthLabel}.csv`,
                  buildChecklistCsv(data.items, nameOf),
                )
              }
            >
              <Download className="size-4" /> {t(`${K}.exportChecklist`)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `close-exceptions-${monthLabel}.csv`,
                  buildExceptionsCsv(data.exceptions, nameOf),
                )
              }
            >
              <Download className="size-4" /> {t(`${K}.exportExceptions`)}
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link
                to="/projects/$projectId/costing/close-pack"
                params={{ projectId }}
                search={{ period: data.close.focusPeriod }}
              >
                <FileText className="size-4" /> {t(`${K}.closePack`)}
              </Link>
            </Button>
          </div>
        </div>

        <Progress value={progress.pct ?? 0} />

        {data.gateReady ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertTitle>{t(`${K}.gateReadyTitle`)}</AlertTitle>
            <AlertDescription>{t(`${K}.gateReadyBody`)}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>{t(`${K}.gateBlockedTitle`)}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-4">
                {data.blockers.map((b) => (
                  <li key={b.key}>{t(`${K}.blockers.${b.key}`, { count: b.count })}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {critical.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t(`${K}.criticalPath`)}
            </span>
            <ul className="flex flex-col gap-1 text-sm">
              {critical.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  {isOverdue(i, data.today) ? (
                    <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                  ) : (
                    <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-foreground">{i.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {i.due_date ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <h3 className="me-auto text-sm font-semibold text-foreground">
            {t(`${K}.checklistTitle`)}{" "}
            <span className="font-normal text-muted-foreground">
              {data.run.template_name} · v{data.run.template_version}
            </span>
          </h3>
          <div className="flex w-44 flex-col gap-1.5">
            <Label htmlFor="cockpit-status">{t(`${K}.filters.status`)}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id="cockpit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(`${K}.filters.all`)}</SelectItem>
                <SelectItem value="outstanding">{t(`${K}.filters.outstanding`)}</SelectItem>
                {CHECKLIST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`${K}.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <Label htmlFor="cockpit-owner">{t(`${K}.filters.owner`)}</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="cockpit-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(`${K}.filters.all`)}</SelectItem>
                {data.people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <Label htmlFor="cockpit-category">{t(`${K}.filters.category`)}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="cockpit-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(`${K}.filters.all`)}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`${K}.category.${c}`, { defaultValue: c })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.noMatches`)}</p>
        ) : (
          groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`${K}.category.${group.category}`, { defaultValue: group.category })}
              </h4>
              <div className="flex flex-col gap-3">
                {group.items.map((item) => {
                  const evidence = data.evidence.filter((e) => e.item_id === item.id);
                  const draftKey = `${item.id}:note`;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-md border border-border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{item.title}</span>
                        <StatusBadge
                          status={item.status}
                          label={t(`${K}.status.${item.status}`)}
                        />
                        {item.is_required ? (
                          <StatusBadge
                            status="required"
                            tone="neutral"
                            label={t(`${K}.required`)}
                          />
                        ) : null}
                        {item.requires_evidence ? (
                          <StatusBadge
                            status="evidence"
                            tone="neutral"
                            label={t(`${K}.evidenceRequired`)}
                          />
                        ) : null}
                        {isOverdue(item, data.today) ? (
                          <StatusBadge status="overdue" label={t(`${K}.overdue`)} />
                        ) : null}
                        <span className="ms-auto font-mono text-xs text-muted-foreground">
                          {item.due_date ?? "—"}
                        </span>
                      </div>

                      {item.instructions ? (
                        <p className="text-sm text-muted-foreground">{item.instructions}</p>
                      ) : null}

                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex w-44 flex-col gap-1.5">
                          <Label htmlFor={`assignee-${item.id}`} className="text-xs">
                            {t(`${K}.assignee`)}
                          </Label>
                          <Select
                            value={item.assignee_id ?? "none"}
                            disabled={data.close.state === "hard_closed"}
                            onValueChange={(v) =>
                              updateItem.mutate({
                                item,
                                assigneeId: v === "none" ? null : v,
                              })
                            }
                          >
                            <SelectTrigger id={`assignee-${item.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t(`${K}.unassigned`)}</SelectItem>
                              {data.people.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex w-44 flex-col gap-1.5">
                          <Label htmlFor={`status-${item.id}`} className="text-xs">
                            {t(`${K}.filters.status`)}
                          </Label>
                          <Select
                            value={item.status}
                            disabled={data.close.state === "hard_closed"}
                            onValueChange={(v) => {
                              const next = v as ChecklistItemStatus;
                              if (next === "waived") {
                                const reason = drafts[draftKey]?.trim();
                                if (!reason) {
                                  toast.error(t(`${K}.waiverReasonRequired`));
                                  return;
                                }
                                updateItem.mutate({ item, status: next, waiverReason: reason });
                                return;
                              }
                              updateItem.mutate({ item, status: next });
                            }}
                          >
                            <SelectTrigger id={`status-${item.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CHECKLIST_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {t(`${K}.status.${s}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
                          <Label htmlFor={`note-${item.id}`} className="text-xs">
                            {t(`${K}.noteLabel`)}
                          </Label>
                          <Textarea
                            id={`note-${item.id}`}
                            rows={2}
                            disabled={data.close.state === "hard_closed"}
                            value={drafts[draftKey] ?? item.notes ?? ""}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))
                            }
                            placeholder={t(`${K}.notePlaceholder`)}
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            data.close.state === "hard_closed" || drafts[draftKey] === undefined
                          }
                          onClick={() =>
                            updateItem.mutate({ item, notes: drafts[draftKey] ?? null })
                          }
                        >
                          {t(`${K}.saveNote`)}
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Paperclip className="size-3.5" />
                        {evidence.length === 0 ? (
                          <span>{t(`${K}.noEvidence`)}</span>
                        ) : (
                          evidence.map((e) => (
                            <span
                              key={e.id}
                              className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5"
                            >
                              {e.document_title ?? e.file_name ?? e.document_id.slice(0, 8)}
                              {data.close.state === "hard_closed" ? null : (
                                <button
                                  type="button"
                                  aria-label={t(`${K}.removeEvidence`)}
                                  onClick={() => unlink.mutate(e.id)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </span>
                          ))
                        )}
                        <Button asChild size="sm" variant="ghost" className="h-6 px-2">
                          <Link to="/projects/$projectId/documents" params={{ projectId }}>
                            {t(`${K}.manageEvidence`)}
                          </Link>
                        </Button>
                      </div>

                      {item.status === "waived" && item.waiver_reason ? (
                        <p className="text-xs text-warning">
                          {t(`${K}.waivedBy`, {
                            who: nameOf(item.waived_by),
                            reason: item.waiver_reason,
                          })}
                        </p>
                      ) : null}
                      {isDone(item) && item.reviewed_by ? (
                        <p className="text-xs text-muted-foreground">
                          {t(`${K}.signedOff`, {
                            preparer: nameOf(item.completed_by),
                            reviewer: nameOf(item.reviewed_by),
                          })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">{t(`${K}.exceptionsTitle`)}</h3>
        {data.exceptions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> {t(`${K}.noExceptions`)}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`${K}.exception.title`)}</TableHead>
                <TableHead>{t(`${K}.exception.severity`)}</TableHead>
                <TableHead>{t(`${K}.exception.status`)}</TableHead>
                <TableHead>{t(`${K}.exception.reopened`)}</TableHead>
                <TableHead className="w-80">{t(`${K}.exception.resolution`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.exceptions.map((row) => {
                const key = `${row.id}:note`;
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="text-foreground">
                        {t(`financeMod.costing.close.checks.${row.exception_type}`, {
                          count: Number(row.detail.count ?? 0),
                          currencies: Array.isArray(row.detail.currencies)
                            ? (row.detail.currencies as string[]).join(", ")
                            : "",
                          defaultValue: row.title,
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={row.severity === "blocker" ? "blocked" : "warning"}
                        label={t(`${K}.severity.${row.severity}`)}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={row.status}
                        tone={row.status === "accepted_risk" ? "attention" : undefined}
                        label={t(`${K}.exceptionStatus.${row.status}`)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.reopen_count}</TableCell>
                    <TableCell>
                      {data.close.state === "hard_closed" ? (
                        <span className="text-xs text-muted-foreground">
                          {row.resolution_note ?? "—"}
                        </span>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <Textarea
                            rows={2}
                            aria-label={t(`${K}.exception.resolution`)}
                            value={drafts[key] ?? row.resolution_note ?? ""}
                            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                            placeholder={t(`${K}.exception.notePlaceholder`)}
                          />
                          <div className="flex flex-wrap gap-2">
                            {EXCEPTION_STATUSES.filter((s) => s !== row.status).map((s) => (
                              <Button
                                key={s}
                                size="sm"
                                variant={s === "accepted_risk" ? "destructive" : "outline"}
                                disabled={updateException.isPending}
                                onClick={() =>
                                  updateException.mutate({
                                    row,
                                    status: s,
                                    note: drafts[key] ?? row.resolution_note ?? "",
                                  })
                                }
                              >
                                {t(`${K}.exceptionStatus.${s}`)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">{t(`${K}.auditTitle`)}</h3>
        {data.audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.noAudit`)}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.audit.slice(0, 25).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {e.created_at.slice(0, 16).replace("T", " ")}
                </span>
                <span className="text-foreground">{e.action}</span>
                <span className="text-muted-foreground">{nameOf(e.actor_id)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
