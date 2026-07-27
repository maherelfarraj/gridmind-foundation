// P-200 — Finance period close: period register, close checklist and month-over-month comparison.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, CircleAlert, Download, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  closeFinancePeriod,
  reopenFinancePeriod,
  saveFinancePeriodChecklist,
} from "@/lib/periods.functions";
import { financePeriodsQueryOptions, periodComparisonQueryOptions } from "@/lib/periods.query";
import { monthLabel, periodStatusTone, type PeriodStatus } from "@/lib/periods.rules";
import type { PeriodListRow } from "@/lib/periods.server";

export const Route = createFileRoute("/_authenticated/finance/periods")({
  head: () => ({
    meta: [
      { title: "Period close — GridMind EPC" },
      {
        name: "description",
        content:
          "Close finance months with a hard checklist, lock postings and compare revenue, collections, WIP and aging month over month.",
      },
      { property: "og:title", content: "Period close — GridMind EPC" },
      {
        property: "og:description",
        content: "Finance period register, close checklist and month-over-month comparison report.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePeriodsPage,
});

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function FinancePeriodsPage() {
  const qc = useQueryClient();
  const periods = useQuery(financePeriodsQueryOptions());
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => periods.data?.periods ?? [], [periods.data]);
  const access = periods.data?.access ?? "none";
  const canWrite = access === "full" || access === "reopen";
  const canReopen = access === "reopen";

  useEffect(() => {
    if (!selected && rows.length > 0) setSelected(rows[0].period_month);
  }, [rows, selected]);

  const active = rows.find((r) => r.period_month === selected) ?? null;
  const comparison = useQuery(periodComparisonQueryOptions(selected));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["finance-periods"] });

  const closeFn = useServerFn(closeFinancePeriod);
  const reopenFn = useServerFn(reopenFinancePeriod);
  const checklistFn = useServerFn(saveFinancePeriodChecklist);

  const closeMutation = useMutation({
    mutationFn: (period_month: string) => closeFn({ data: { period_month } }),
    onSuccess: () => {
      toast.success("Period closed. Postings in that month are now locked.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not close the period."),
  });

  const reopenMutation = useMutation({
    mutationFn: (period_month: string) => reopenFn({ data: { period_month } }),
    onSuccess: () => {
      toast.success("Period reopened.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not reopen the period."),
  });

  const checklistMutation = useMutation({
    mutationFn: (input: { period_month: string; unbilled_reviewed: boolean; note?: string }) =>
      checklistFn({ data: input }),
    onSuccess: () => {
      toast.success("Checklist saved.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the checklist."),
  });

  if (periods.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (access === "none") {
    return (
      <div className="p-6">
        <EmptyState
          icon={LockKeyhole}
          title="No access to finance periods"
          description="Ask a company admin for a finance role to view or manage the period close."
        />
      </div>
    );
  }

  const closedCount = rows.filter((r) => r.status === "closed").length;
  const blockers = active?.checklist.filter((c) => !c.pass).length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Period close"
        description="Lock a finance month once its checklist is clean, then compare it against the prior month."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile label="Months tracked" value={String(rows.length)} icon={CalendarClock} />
        <KpiTile label="Closed months" value={String(closedCount)} icon={LockKeyhole} />
        <KpiTile
          label="Open blockers"
          value={String(blockers)}
          icon={blockers === 0 ? CheckCircle2 : CircleAlert}
          status={blockers === 0 ? "good" : "warning"}
        />
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Register</TabsTrigger>
          <TabsTrigger value="checklist">Close checklist</TabsTrigger>
          <TabsTrigger value="comparison">Comparison report</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <PeriodRegister
            rows={rows}
            selected={selected}
            canWrite={canWrite}
            canReopen={canReopen}
            busy={closeMutation.isPending || reopenMutation.isPending}
            onSelect={setSelected}
            onClose={(m) => closeMutation.mutate(m)}
            onReopen={(m) => reopenMutation.mutate(m)}
          />
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          {active ? (
            <ChecklistPanel
              period={active}
              canWrite={canWrite}
              saving={checklistMutation.isPending}
              closing={closeMutation.isPending}
              onSave={(unbilled_reviewed, note) =>
                checklistMutation.mutate({
                  period_month: active.period_month,
                  unbilled_reviewed,
                  note,
                })
              }
              onClose={() => closeMutation.mutate(active.period_month)}
            />
          ) : (
            <EmptyState
              icon={CalendarClock}
              title="Select a period"
              description="Pick a month in the register to see its close checklist."
            />
          )}
        </TabsContent>

        <TabsContent value="comparison" className="mt-4">
          <ComparisonPanel
            month={selected}
            loading={comparison.isLoading}
            data={comparison.data ?? null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function statusLabel(status: PeriodStatus) {
  return status === "closed" ? "Closed" : status === "closing" ? "Closing" : "Open";
}

function PeriodRegister(props: {
  rows: PeriodListRow[];
  selected: string | null;
  canWrite: boolean;
  canReopen: boolean;
  busy: boolean;
  onSelect: (m: string) => void;
  onClose: (m: string) => void;
  onReopen: (m: string) => void;
}) {
  if (props.rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No finance periods yet"
        description="Periods appear here as soon as finance activity is recorded."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Blockers</TableHead>
          <TableHead>Closed by</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((r) => {
          const blockers = r.checklist.filter((c) => !c.pass).length;
          const isSelected = r.period_month === props.selected;
          return (
            <TableRow
              key={r.period_month}
              data-state={isSelected ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => props.onSelect(r.period_month)}
            >
              <TableCell className="font-medium">{monthLabel(r.period_month)}</TableCell>
              <TableCell>
                <StatusBadge
                  status={r.status}
                  tone={periodStatusTone(r.status)}
                  label={statusLabel(r.status)}
                />
              </TableCell>
              <TableCell>
                {r.status === "closed" ? "—" : blockers === 0 ? "Ready to close" : blockers}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.closed_by_name ? `${r.closed_by_name} · ${r.closed_at?.slice(0, 10)}` : "—"}
              </TableCell>
              <TableCell className="text-right">
                {r.status === "closed" ? (
                  props.canReopen ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onReopen(r.period_month);
                      }}
                    >
                      Reopen
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-sm">Locked</span>
                  )
                ) : (
                  <Button
                    size="sm"
                    disabled={!props.canWrite || !r.can_close || props.busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onClose(r.period_month);
                    }}
                  >
                    Close period
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ChecklistPanel(props: {
  period: PeriodListRow;
  canWrite: boolean;
  saving: boolean;
  closing: boolean;
  onSave: (unbilledReviewed: boolean, note?: string) => void;
  onClose: () => void;
}) {
  const { period } = props;
  const [reviewed, setReviewed] = useState(Boolean(period.close_checklist.unbilled_reviewed));
  const [note, setNote] = useState(period.close_checklist.note ?? "");

  useEffect(() => {
    setReviewed(Boolean(period.close_checklist.unbilled_reviewed));
    setNote(period.close_checklist.note ?? "");
  }, [period]);

  if (period.status === "closed") {
    return (
      <EmptyState
        icon={LockKeyhole}
        title={`${monthLabel(period.period_month)} is closed`}
        description="Postings dated in this month are rejected until a company admin reopens it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        {period.checklist.map((item) => (
          <div key={item.key} className="flex items-start gap-3 p-4">
            {item.pass ? (
              <CheckCircle2 className="text-success mt-0.5 size-5" />
            ) : (
              <CircleAlert className="text-warning mt-0.5 size-5" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">{item.label}</p>
                <StatusBadge
                  status={item.pass ? "clear" : "blocking"}
                  tone={item.pass ? "positive" : "attention"}
                  label={item.pass ? "Clear" : "Blocking"}
                />
              </div>
              <p className="text-muted-foreground text-sm">{item.hint}</p>
              <p className="mt-1 text-sm">{item.detail}</p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <a href={item.link}>Open</a>
            </Button>
          </div>
        ))}
      </div>

      <div className="border-border bg-card space-y-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="unbilled-reviewed"
            checked={reviewed}
            disabled={!props.canWrite}
            onCheckedChange={(v) => setReviewed(v === true)}
          />
          <Label htmlFor="unbilled-reviewed">
            I reviewed certified-but-unbilled work for this month
          </Label>
        </div>
        <Textarea
          value={note}
          disabled={!props.canWrite}
          placeholder="Close note (optional) — context for auditors and lenders."
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!props.canWrite || props.saving}
            onClick={() => props.onSave(reviewed, note || undefined)}
          >
            Save checklist
          </Button>
          <Button
            disabled={!props.canWrite || !period.can_close || props.closing}
            onClick={props.onClose}
          >
            Close {monthLabel(period.period_month)}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ComparisonData {
  current: { period_month: string };
  prior: { period_month: string };
  lines: { metric: string; current: number; prior: number; delta: number }[];
}

function ComparisonPanel(props: {
  month: string | null;
  loading: boolean;
  data: ComparisonData | null;
}) {
  if (!props.month) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Select a period"
        description="Pick a month in the register to compare it with the prior month."
      />
    );
  }
  if (props.loading || !props.data) return <Skeleton className="h-64 w-full" />;

  const { current, prior, lines } = props.data;

  const exportCsv = () => {
    const csv = toCsv(
      ["Metric", monthLabel(current.period_month), monthLabel(prior.period_month), "Delta"],
      lines.map((l) => [l.metric, l.current, l.prior, l.delta] as const),
    );
    downloadCsv(`period-comparison-${current.period_month}.csv`, csv);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-2 size-4" />
          Export CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">{monthLabel(current.period_month)}</TableHead>
            <TableHead className="text-right">{monthLabel(prior.period_month)}</TableHead>
            <TableHead className="text-right">Delta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.metric}>
              <TableCell className="font-medium">{l.metric}</TableCell>
              <TableCell className="text-right tabular-nums">{money(l.current)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(l.prior)}</TableCell>
              <TableCell
                className={`text-right tabular-nums ${l.delta < 0 ? "text-destructive" : "text-success"}`}
              >
                {money(l.delta)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
