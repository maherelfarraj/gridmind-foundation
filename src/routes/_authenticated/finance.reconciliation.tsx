// P-198 — Bank reconciliation lite: month view, match actions and bulk marking.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, CheckCircle2, Landmark, Link2 } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { MoneyCell } from "@/components/ui/num";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { invoiceErrorMessage } from "@/lib/invoices.query";
import { paymentMethodLabel } from "@/lib/payments.rules";
import type { PaymentRow } from "@/lib/payments.server";
import { bulkReconcilePayments, reconcilePayment } from "@/lib/reconciliation.functions";
import {
  reconciliationAccessQueryOptions,
  reconciliationQueryOptions,
} from "@/lib/reconciliation.query";
import {
  RECON_FILTERS,
  RECON_FORMULAS,
  currentMonth,
  matchedPctStatus,
  monthLabel,
  reconStatusLabel,
  reconStatusTone,
  type ListReconciliationInput,
  type ReconFilter,
  type ReconStatus,
} from "@/lib/reconciliation.rules";

export const Route = createFileRoute("/_authenticated/finance/reconciliation")({
  head: () => ({
    meta: [
      { title: "Bank reconciliation — GridMind EPC" },
      {
        name: "description",
        content:
          "Match recorded payments to bank statement lines, mark partials and exclusions, and track the monthly reconciled percentage.",
      },
      { property: "og:title", content: "Bank reconciliation — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Monthly payment matching with statement references, bulk actions and audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReconciliationPage,
});

function money(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
}

function ReconciliationPage() {
  const { t } = useI18n();
  const FILTER_LABEL: Record<ReconFilter, string> = {
    unmatched: t("financeMod.reconciliation.unmatched"),
    matched: t("financeMod.reconciliation.matched"),
    partial: t("financeMod.reconciliation.filterPartial"),
    excluded: t("financeMod.reconciliation.exclude"),
    all: t("financeMod.reconciliation.filterAll"),
  };
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState<ReconFilter>("unmatched");
  const [direction, setDirection] = useState<"all" | "receivable" | "payable">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPrefix, setBulkPrefix] = useState("");
  const [bulkNote, setBulkNote] = useState("");

  const filters: ListReconciliationInput = useMemo(
    () => ({ month, status, direction }),
    [month, status, direction],
  );

  const accessQ = useQuery(reconciliationAccessQueryOptions());
  const dataQ = useQuery(reconciliationQueryOptions(filters));
  const canWrite = accessQ.data?.canWrite ?? false;
  const payableOnly = accessQ.data?.canPayableOnly ?? false;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["reconciliation"] });
    void qc.invalidateQueries({ queryKey: ["payments"] });
  };

  const reconcileFn = useServerFn(reconcilePayment);
  const bulkFn = useServerFn(bulkReconcilePayments);

  const single = useMutation({
    mutationFn: reconcileFn,
    onSuccess: (res) => {
      toast.success(
        t("financeMod.reconciliation.reconciled", {
          status: reconStatusLabel(res.status).toLowerCase(),
        }),
      );
      invalidate();
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), invoiceErrorMessage(e))),
  });

  const bulk = useMutation({
    mutationFn: bulkFn,
    onSuccess: (res) => {
      toast.success(
        t("financeMod.reconciliation.bulkUpdated", {
          count: res.updated,
          status: reconStatusLabel(res.status).toLowerCase(),
        }),
      );
      setSelected([]);
      setBulkPrefix("");
      setBulkNote("");
      invalidate();
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), invoiceErrorMessage(e))),
  });

  const rows = dataQ.data?.rows ?? [];
  const summary = dataQ.data?.summary;
  const pct = summary?.matched_pct ?? null;

  const selectableIds = rows
    .filter(
      (r) =>
        r.record_status === "recorded" &&
        (r.reconciliation_status === "unmatched" || r.reconciliation_status === "partial") &&
        (!payableOnly || r.direction === "payable"),
    )
    .map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selected.length === selectableIds.length;

  function canRowAct(r: PaymentRow) {
    if (!canWrite || r.record_status === "voided") return false;
    return !payableOnly || r.direction === "payable";
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("financeMod.reconciliation.title")}
        description={t("financeMod.reconciliation.subtitle") + ` — ${monthLabel(month)}.`}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="recon-month">{t("financeMod.reconciliation.month")}</Label>
          <Input
            id="recon-month"
            type="month"
            className="w-44"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value || currentMonth());
              setSelected([]);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recon-direction">{t("financeMod.reconciliation.direction")}</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
            <SelectTrigger id="recon-direction" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("financeMod.reconciliation.allDirections")}</SelectItem>
              <SelectItem value="receivable">{t("financeMod.invoices.receivable")}</SelectItem>
              <SelectItem value="payable">{t("financeMod.invoices.payable")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto w-64">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <KpiTile
                  label={t("financeMod.reconciliation.reconciled", { status: "" }).replace(
                    /\s+$/,
                    "",
                  )}
                  icon={Landmark}
                  isLoading={dataQ.isLoading}
                  value={pct === null ? "n/a" : `${(pct * 100).toFixed(0)}%`}
                  status={matchedPctStatus(pct)}
                  hint={
                    summary
                      ? `${summary.matched} of ${summary.denominator} in scope · ${summary.excluded} excluded`
                      : undefined
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {RECON_FORMULAS.matchedPct} {RECON_FORMULAS.excluded}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RECON_FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={status === f ? "default" : "outline"}
            onClick={() => {
              setStatus(f);
              setSelected([]);
            }}
          >
            {FILTER_LABEL[f]}
          </Button>
        ))}
      </div>

      {canWrite && selected.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/40 p-3">
          <span className="text-sm font-medium text-foreground">
            {t("financeMod.reconciliation.selected", { count: selected.length })}
          </span>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-prefix">{t("financeMod.reconciliation.statementRefPrefix")}</Label>
            <Input
              id="bulk-prefix"
              className="w-56"
              placeholder="STMT-2026-07"
              value={bulkPrefix}
              onChange={(e) => setBulkPrefix(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-note">{t("financeMod.reconciliation.note")}</Label>
            <Input
              id="bulk-note"
              className="w-72"
              placeholder="personal card, not company funds"
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={bulk.isPending}
            onClick={() =>
              bulk.mutate({
                data: {
                  payment_ids: selected,
                  status: "matched",
                  bank_reference_prefix: bulkPrefix || null,
                },
              })
            }
          >
            {t("financeMod.reconciliation.markMatched")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={bulk.isPending}
            onClick={() => {
              if (!bulkNote.trim()) {
                toast.error(t("financeMod.reconciliation.noteRequired"));
                return;
              }
              bulk.mutate({
                data: { payment_ids: selected, status: "excluded", note: bulkNote.trim() },
              });
            }}
          >
            {t("financeMod.reconciliation.markExcluded")}
          </Button>
        </div>
      ) : null}

      {dataQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : dataQ.isError ? (
        <EmptyState
          icon={AlertCircle}
          title={t("financeMod.reconciliation.couldNotLoad")}
          description={translateError(
            t,
            errorCodeOf(dataQ.error),
            invoiceErrorMessage(dataQ.error),
          )}
          action={<Button onClick={() => void dataQ.refetch()}>{t("common.retry")}</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={t("financeMod.reconciliation.allReconciled")}
          description={t("financeMod.reconciliation.noneToReview", {
            status: status === "all" ? "" : FILTER_LABEL[status].toLowerCase(),
            month: monthLabel(month),
          })}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t("financeMod.reconciliation.selectAll")}
                    checked={allSelected}
                    disabled={!canWrite || selectableIds.length === 0}
                    onCheckedChange={(v) => setSelected(v ? selectableIds : [])}
                  />
                </TableHead>
                <TableHead>{t("financeMod.reconciliation.paymentHeader")}</TableHead>
                <TableHead>{t("financeMod.reconciliation.invoiceHeader")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("financeMod.reconciliation.methodHeader")}</TableHead>
                <TableHead className="text-end">{t("common.amount")}</TableHead>
                <TableHead>{t("financeMod.reconciliation.bankRefHeader")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-end">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${r.payment_number}`}
                      checked={selected.includes(r.id)}
                      disabled={!selectableIds.includes(r.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) =>
                          v ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{r.payment_number}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{r.invoice_number ?? "—"}</span>
                      <StatusBadge
                        status={r.direction}
                        label={
                          r.direction === "payable"
                            ? t("financeMod.invoices.payable")
                            : t("financeMod.invoices.receivable")
                        }
                        tone={r.direction === "payable" ? "attention" : "active"}
                      />
                    </div>
                  </TableCell>
                  <TableCell>{r.payment_date}</TableCell>
                  <TableCell>{paymentMethodLabel(r.method)}</TableCell>
                  <TableCell className="text-end">
                    <MoneyCell>{money(r.amount, r.currency_code)}</MoneyCell>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.bank_reference ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge
                      status={r.reconciliation_status}
                      label={reconStatusLabel(r.reconciliation_status as ReconStatus)}
                      tone={reconStatusTone(r.reconciliation_status as ReconStatus)}
                    />
                  </TableCell>
                  <TableCell className="text-end">
                    {canRowAct(r) ? (
                      <RowActions
                        row={r}
                        pending={single.isPending}
                        onSubmit={(input) => single.mutate({ data: input })}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {r.record_status === "voided" ? t("financeMod.reconciliation.voided") : "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RowActions({
  row,
  pending,
  onSubmit,
}: {
  row: PaymentRow;
  pending: boolean;
  onSubmit: (input: {
    payment_id: string;
    status: "matched" | "partial" | "excluded";
    bank_reference?: string | null;
    note?: string | null;
  }) => void;
}) {
  const { t } = useI18n();
  const [ref, setRef] = useState(row.bank_reference ?? "");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);

  return (
    <div className="flex items-center justify-end gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            <Link2 className="size-3.5" aria-hidden />
            {t("financeMod.reconciliation.match")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`ref-${row.id}`}>
              {t("financeMod.reconciliation.statementLineRef")}
            </Label>
            <Input
              id={`ref-${row.id}`}
              value={ref}
              placeholder="STMT-2026-07-014"
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={pending || !ref.trim()}
            onClick={() => {
              onSubmit({
                payment_id: row.id,
                status: "matched",
                bank_reference: ref.trim(),
              });
              setOpen(false);
            }}
          >
            {t("financeMod.reconciliation.matchToStatementLine")}
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          onSubmit({
            payment_id: row.id,
            status: "partial",
            bank_reference: row.bank_reference,
          })
        }
      >
        {t("financeMod.reconciliation.partial")}
      </Button>

      <Popover open={excludeOpen} onOpenChange={setExcludeOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" disabled={pending}>
            {t("financeMod.reconciliation.exclude")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`note-${row.id}`}>{t("financeMod.reconciliation.whyExcluded")}</Label>
            <Textarea
              id={`note-${row.id}`}
              value={note}
              placeholder="personal card, not company funds"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={pending || !note.trim()}
            onClick={() => {
              onSubmit({ payment_id: row.id, status: "excluded", note: note.trim() });
              setExcludeOpen(false);
            }}
          >
            {t("financeMod.reconciliation.markExcluded")}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
