// P-068 — Expediting workbench.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Download, MessageSquare, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpeditingStatusBadge } from "@/components/procurement/expediting-status-badge";
import {
  deleteExpediting,
  getExpeditingAccess,
  getLongLeadKpi,
  importFromPo,
  listExpediting,
  listOpenPosForExpediting,
  logVendorContact,
  updateExpediting,
  confirmEta,
  counterProposeEta,
  type ExpeditingRow,
} from "@/lib/expediting.functions";
import { daysUntilNeed, EXPEDITING_STATUSES, type ExpeditingStatus } from "@/lib/expediting-rules";
import { isCounterProposedNote, isVendorProposedNote } from "@/lib/vendor-portal.rules";
import {
  errorMessage,
  expeditingAccessQueryOptions,
  expeditingListQueryOptions,
  longLeadKpiQueryOptions,
  openPosForExpeditingQueryOptions,
} from "@/lib/expediting-query";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { MoneyCell, Num } from "@/components/ui/num";

export const Route = createFileRoute("/_authenticated/procurement/expediting")({
  head: () => ({
    meta: [
      { title: "Expediting — GridMind EPC" },
      {
        name: "description",
        content:
          "Chase deliveries against site-need dates. Track long-lead items, ETAs, and the Stage-3 procurement exit gate.",
      },
      { property: "og:title", content: "Expediting — GridMind EPC" },
      {
        property: "og:description",
        content: "Delivery expediting workbench for long-lead procurement items.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpeditingPage,
  errorComponent: ExpeditingError,
  pendingComponent: ExpeditingPending,
});

function ExpeditingError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">{t("procurementMod.expediting.loadError")}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {translateError(t, errorCodeOf(error), errorMessage(error))}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
        {t("procurementMod.expediting.retry")}
      </Button>
    </div>
  );
}

function ExpeditingPending() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function ExpeditingPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listExpediting);
  const kpiFn = useServerFn(getLongLeadKpi);
  const accessFn = useServerFn(getExpeditingAccess);
  const openPosFn = useServerFn(listOpenPosForExpediting);
  const updateFn = useServerFn(updateExpediting);
  const contactFn = useServerFn(logVendorContact);
  const importFn = useServerFn(importFromPo);
  const deleteFn = useServerFn(deleteExpediting);
  const confirmEtaFn = useServerFn(confirmEta);
  const counterEtaFn = useServerFn(counterProposeEta);

  const [statusFilter, setStatusFilter] = useState<ExpeditingStatus | "all">("all");
  const [longLeadOnly, setLongLeadOnly] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: access } = useSuspenseQuery(expeditingAccessQueryOptions(accessFn));
  const { data: rows } = useSuspenseQuery(
    expeditingListQueryOptions(listFn, {
      status: statusFilter === "all" ? null : statusFilter,
    }),
  );
  const { data: kpi } = useSuspenseQuery(longLeadKpiQueryOptions(kpiFn));

  const filteredRows = useMemo(
    () => (longLeadOnly ? rows.filter((r) => r.is_long_lead) : rows),
    [rows, longLeadOnly],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; items: ExpeditingRow[] }>();
    for (const r of filteredRows) {
      const key = r.project_id;
      if (!map.has(key)) map.set(key, { projectName: r.project_name ?? "—", items: [] });
      map.get(key)!.items.push(r);
    }
    return Array.from(map.entries());
  }, [filteredRows]);

  const openCount = rows.filter((r) => r.status !== "delivered").length;
  const delayedCount = rows.filter((r) => r.status === "delayed").length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expediting"] });
  };

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; patch: Record<string, unknown> }) =>
      updateFn({ data: vars as any }),
    onSuccess: () => {
      invalidate();
      toast.success(t("procurementMod.expediting.updated"));
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  const contactMutation = useMutation({
    mutationFn: (id: string) => contactFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("procurementMod.expediting.vendorContactLogged"));
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmEtaFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("procurementMod.expediting.etaConfirmedToast"));
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  const counterMutation = useMutation({
    mutationFn: (vars: { id: string; eta: string; comment: string }) =>
      counterEtaFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success(t("procurementMod.expediting.counterProposalSent"));
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success(t("procurementMod.expediting.itemRemoved"));
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  const importMutation = useMutation({
    mutationFn: (vars: { poId: string; longLeadLineNos: number[] }) => importFn({ data: vars }),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["expediting", "open-pos"] });
      toast.success(
        t(res.imported === 1 ? "procurementMod.expediting.importedToast_one" : "procurementMod.expediting.importedToast_other", {
          count: res.imported,
        }) + (res.skipped > 0 ? t("procurementMod.expediting.importedSkipped", { count: res.skipped }) : ""),
      );
      setImportOpen(false);
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
  });

  function exportCsv() {
    const headers = [
      "Project",
      "PO",
      "Item",
      "Long-lead",
      "Promised",
      "Window start",
      "Window end",
      "Site need",
      "ETA",
      "ETA confirmed",
      "Status",
      "Days until need",
      "Last vendor contact",
    ];
    const data = filteredRows.map((r) => [
      r.project_name ?? "",
      r.po_number ?? "",
      r.item_description,
      r.is_long_lead ? "yes" : "no",
      r.promised_delivery_date ?? "",
      r.delivery_window_start ?? "",
      r.delivery_window_end ?? "",
      r.site_need_date,
      r.current_eta ?? "",
      r.eta_confirmed ? "yes" : "no",
      r.status,
      daysUntilNeed(r.site_need_date) ?? "",
      r.last_vendor_contact_at ?? "",
    ]);
    downloadCsv(`expediting-${format(new Date(), "yyyyMMdd")}.csv`, toCsv(headers, data));
  }

  return (
    <div className="page-shell">
      <PageHeader
        title={t("procurementMod.expediting.title")}
        description={t("procurementMod.expediting.subtitle")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="me-2 h-4 w-4" />
              {t("procurementMod.common.export")}
            </Button>
            {access.canWrite ? (
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="me-2 h-4 w-4" />
                    {t("procurementMod.expediting.addFromPo")}
                  </Button>
                </DialogTrigger>
                <ImportFromPoDialog
                  openPosFn={openPosFn}
                  onImport={(poId, longLeadLineNos) =>
                    importMutation.mutate({ poId, longLeadLineNos })
                  }
                  submitting={importMutation.isPending}
                />
              </Dialog>
            ) : null}
          </>
        }
      />

      <TooltipProvider>
        <KpiGrid columns={3}>
          <KpiTile
            label={t("procurementMod.expediting.openItems")}
            value={String(openCount)}
            hint={t("procurementMod.expediting.openItemsHint")}
          />
          <KpiTile
            label={t("procurementMod.expediting.delayed")}
            value={String(delayedCount)}
            hint={t("procurementMod.expediting.delayedHint")}
            status={delayedCount > 0 ? "bad" : "neutral"}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <KpiTile
                  label={t("procurementMod.expediting.longLeadReady")}
                  value={
                    kpi.total === 0 ? "—" : `${kpi.ready}/${kpi.total} · ${kpi.pct.toFixed(0)}%`
                  }
                  hint={t("procurementMod.expediting.longLeadReadyHint")}
                  status={
                    kpi.total === 0
                      ? "neutral"
                      : kpi.band === "green"
                        ? "good"
                        : kpi.band === "amber"
                          ? "warning"
                          : "bad"
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>{t("procurementMod.expediting.exitGateTooltip")}</TooltipContent>
          </Tooltip>
        </KpiGrid>
      </TooltipProvider>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as ExpeditingStatus | "all")}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder={t("procurementMod.common.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("procurementMod.common.allStatuses")}</SelectItem>
            {EXPEDITING_STATUSES.map((es) => (
              <SelectItem key={es} value={es}>
                {t(`procurementMod.expediting.statuses.${es}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={longLeadOnly} onCheckedChange={(v) => setLongLeadOnly(!!v)} />
          {t("procurementMod.expediting.longLeadOnly")}
        </label>
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={t("procurementMod.expediting.emptyTitle")}
          description={t("procurementMod.expediting.emptyDescription")}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([projectId, group]) => (
            <section
              key={projectId}
              className="rounded-md border border-border"
              aria-label={t("procurementMod.expediting.projectLabel", { name: group.projectName })}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="font-medium">{group.projectName}</div>
                <div className="text-xs text-muted-foreground">
                  {t(group.items.length === 1 ? "procurementMod.expediting.itemsCount_one" : "procurementMod.expediting.itemsCount_other", { count: group.items.length })}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("procurementMod.expediting.colItem")}</TableHead>
                    <TableHead>{t("procurementMod.common.po")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.colPromised")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.colWindow")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.colSiteNeed")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.eta")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.colConfirmed")}</TableHead>
                    <TableHead>{t("procurementMod.common.status")}</TableHead>
                    <TableHead>{t("procurementMod.expediting.colCountdown")}</TableHead>
                    <TableHead className="text-end">{t("procurementMod.common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((r) => (
                    <ExpeditingRowUI
                      key={r.id}
                      row={r}
                      canWrite={access.canWrite}
                      onPatch={(patch) => updateMutation.mutate({ id: r.id, patch })}
                      onLogContact={() => contactMutation.mutate(r.id)}
                      onDelete={() => deleteMutation.mutate(r.id)}
                      onConfirmEta={() => confirmMutation.mutate(r.id)}
                      onCounterPropose={(eta, comment) =>
                        counterMutation.mutate({ id: r.id, eta, comment })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = "muted",
  progress = null,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "muted" | "green" | "amber" | "destructive";
  progress?: number | null;
}) {
  const barClass =
    tone === "green"
      ? "bg-primary"
      : tone === "amber"
        ? "bg-secondary"
        : tone === "destructive"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  const valueClass =
    tone === "green"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
      {progress != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${barClass}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function CountdownChip({ siteNeedDate }: { siteNeedDate: string }) {
  const { t } = useI18n();
  const days = daysUntilNeed(siteNeedDate);
  if (days == null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone =
    days < 0
      ? "text-destructive"
      : days <= 7
        ? "text-destructive"
        : days <= 21
          ? "text-secondary-foreground"
          : "text-muted-foreground";
  const label =
    days < 0
      ? t("procurementMod.expediting.overdueLabel", { count: Math.abs(days) })
      : days === 0
        ? t("procurementMod.expediting.todayLabel")
        : t("procurementMod.expediting.daysLabel", { count: days });
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

function ExpeditingRowUI({
  row,
  canWrite,
  onPatch,
  onLogContact,
  onDelete,
  onConfirmEta,
  onCounterPropose,
}: {
  row: ExpeditingRow;
  canWrite: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onLogContact: () => void;
  onDelete: () => void;
  onConfirmEta: () => void;
  onCounterPropose: (eta: string, comment: string) => void;
}) {
  const { t } = useI18n();
  const [eta, setEta] = useState(row.current_eta ?? "");
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterEta, setCounterEta] = useState(row.current_eta ?? "");
  const [counterComment, setCounterComment] = useState("");
  const vendorProposed = isVendorProposedNote(row.notes) && !row.eta_confirmed;

  const commitEta = () => {
    const next = eta.trim() === "" ? null : eta;
    if (next === row.current_eta) return;
    onPatch({ current_eta: next });
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{row.item_description}</div>
        <div className="flex items-center gap-2 pt-1">
          {row.is_long_lead ? (
            <Badge variant="secondary" className="text-[10px]">
              {t("procurementMod.expediting.longLead")}
            </Badge>
          ) : null}
          {row.last_vendor_contact_at ? (
            <span className="text-[10px] text-muted-foreground">
              {t("procurementMod.expediting.contactOn", {
                date: format(new Date(row.last_vendor_contact_at), "PP"),
              })}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {t("procurementMod.expediting.noContactYet")}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Link
          to="/procurement/pos/$poId"
          params={{ poId: row.po_id }}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {row.po_number ?? "PO"}
        </Link>
        {row.po_line_no ? (
          <div className="text-[10px] text-muted-foreground">
            {t("procurementMod.expediting.line", { no: row.po_line_no })}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.promised_delivery_date ? format(new Date(row.promised_delivery_date), "PP") : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.delivery_window_start && row.delivery_window_end
          ? `${format(new Date(row.delivery_window_start), "MMM d")} – ${format(
              new Date(row.delivery_window_end),
              "MMM d",
            )}`
          : "—"}
      </TableCell>
      <TableCell className="text-xs">{format(new Date(row.site_need_date), "PP")}</TableCell>
      <TableCell>
        <Input
          type="date"
          value={eta}
          disabled={!canWrite}
          onChange={(e) => setEta(e.target.value)}
          onBlur={commitEta}
          className="h-8 w-36"
          aria-label={t("procurementMod.expediting.currentEtaLabel")}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Switch
            checked={row.eta_confirmed}
            disabled={!canWrite}
            onCheckedChange={(v) => onPatch({ eta_confirmed: !!v })}
            aria-label={t("procurementMod.expediting.etaConfirmedLabel")}
          />
          {vendorProposed ? (
            <Badge className="bg-accent text-[10px] text-accent-foreground">
              {t("procurementMod.expediting.vendorProposedEta")}
            </Badge>
          ) : null}
          {isCounterProposedNote(row.notes) && !row.eta_confirmed ? (
            <span className="text-[10px] text-muted-foreground">
              {t("procurementMod.expediting.counterProposed")}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <ExpeditingStatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        <CountdownChip siteNeedDate={row.site_need_date} />
      </TableCell>
      <TableCell className="text-end">
        <div className="flex flex-wrap justify-end gap-1">
          {canWrite && vendorProposed ? (
            <>
              <Button variant="outline" size="sm" onClick={onConfirmEta}>
                {t("procurementMod.expediting.confirmEta")}
              </Button>
              <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {t("procurementMod.expediting.counter")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("procurementMod.expediting.counterDialogTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("procurementMod.expediting.counterDialogDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor={`counter-eta-${row.id}`}>
                        {t("procurementMod.expediting.proposedEtaLabel")}
                      </Label>
                      <Input
                        id={`counter-eta-${row.id}`}
                        type="date"
                        value={counterEta}
                        onChange={(e) => setCounterEta(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`counter-note-${row.id}`}>
                        {t("procurementMod.expediting.commentLabel")}
                      </Label>
                      <Input
                        id={`counter-note-${row.id}`}
                        value={counterComment}
                        onChange={(e) => setCounterComment(e.target.value)}
                        placeholder={t("procurementMod.expediting.commentPlaceholder")}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCounterOpen(false)}>
                      {t("procurementMod.expediting.cancel")}
                    </Button>
                    <Button
                      disabled={!counterEta || counterComment.trim() === ""}
                      onClick={() => {
                        onCounterPropose(counterEta, counterComment.trim());
                        setCounterOpen(false);
                        setCounterComment("");
                      }}
                    >
                      {t("procurementMod.expediting.sendCounterProposal")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!canWrite}
            onClick={onLogContact}
            title={t("procurementMod.expediting.logVendorContact")}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          {canWrite ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm(t("procurementMod.expediting.removeConfirm"))) onDelete();
              }}
              title={t("procurementMod.expediting.remove")}
            >
              <CheckCircle2 className="h-4 w-4 opacity-0" />
              <span className="text-xs text-muted-foreground">
                {t("procurementMod.expediting.remove")}
              </span>
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ImportFromPoDialog({
  openPosFn,
  onImport,
  submitting,
}: {
  openPosFn: ReturnType<typeof useServerFn<typeof listOpenPosForExpediting>>;
  onImport: (poId: string, longLeadLineNos: number[]) => void;
  submitting: boolean;
}) {
  const { t } = useI18n();
  const { data: pos } = useSuspenseQuery(openPosForExpeditingQueryOptions(openPosFn));
  const [poId, setPoId] = useState<string>("");
  const [longLead, setLongLead] = useState<Set<number>>(new Set());

  const selected = pos.find((p) => p.id === poId);

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("procurementMod.expediting.importDialogTitle")}</DialogTitle>
        <DialogDescription>
          {t("procurementMod.expediting.importDialogDescription")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wide">
            {t("procurementMod.expediting.purchaseOrderLabel")}
          </Label>
          <Select value={poId} onValueChange={setPoId}>
            <SelectTrigger>
              <SelectValue placeholder={t("procurementMod.expediting.pickPoPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {pos.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {t("procurementMod.expediting.noOpenPos")}
                </div>
              ) : (
                pos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.po_number} · {p.vendor_name ?? "—"} · {p.project_name ?? "—"}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {selected ? (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{t("procurementMod.expediting.colLongLead")}</TableHead>
                  <TableHead>{t("procurementMod.common.line")}</TableHead>
                  <TableHead>{t("procurementMod.common.description")}</TableHead>
                  <TableHead className="text-end">{t("procurementMod.common.qtyShort")}</TableHead>
                  <TableHead>{t("procurementMod.expediting.colSiteNeed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.lines.map((l) => (
                  <TableRow key={l.line_no}>
                    <TableCell>
                      <Checkbox
                        checked={longLead.has(l.line_no)}
                        onCheckedChange={(v) => {
                          setLongLead((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(l.line_no);
                            else next.delete(l.line_no);
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.line_no}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-end">
                      <Num>{l.qty}</Num> {l.uom}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.site_need_date ?? selected.required_by_date ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button disabled={!poId || submitting} onClick={() => onImport(poId, Array.from(longLead))}>
          {submitting ? t("procurementMod.expediting.importing") : t("procurementMod.expediting.importLines")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
