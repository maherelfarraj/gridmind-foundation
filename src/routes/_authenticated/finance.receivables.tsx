// P-195 — AR aging & collections: KPI tiles, aging table with drill-down,
// expected-cash forecast and dunning actions.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Inbox, Wallet } from "lucide-react";
import { toast } from "sonner";

import { SendReminderDialog } from "@/components/finance/reminder-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { exportArAgingCsv } from "@/lib/ar-aging.functions";
import { arAccessQueryOptions, arAgingQueryOptions } from "@/lib/ar-aging.query";
import { FORMULAS, type AgingGroup, type AgingInvoiceRow } from "@/lib/ar-aging.rules";
import { downloadCsv } from "@/lib/csv";
import { AGING_BUCKETS, AGING_BUCKET_LABELS, AGING_WEIGHTS } from "@/lib/finance/aging-weights";
import { formatDate, formatMoney } from "@/lib/format";
import { invoiceErrorMessage } from "@/lib/invoices.query";

export const Route = createFileRoute("/_authenticated/finance/receivables")({
  head: () => ({
    meta: [
      { title: "AR aging & collections — GridMind EPC" },
      {
        name: "description",
        content:
          "Receivables aged into 1-30, 31-60, 61-90 and 90+ buckets with probability-weighted expected cash and dunning history.",
      },
      { property: "og:title", content: "AR aging & collections — GridMind EPC" },
      {
        property: "og:description",
        content: "Aged receivables, expected-cash forecast and collection reminders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceivablesPage,
});

function ReceivablesPage() {
  const [groupBy, setGroupBy] = useState<"client" | "project">("client");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading } = useQuery(arAgingQueryOptions());
  const { data: access } = useQuery(arAccessQueryOptions());
  const exportCsv = useServerFn(exportArAgingCsv);

  const base = data?.base_currency ?? "USD";
  const groups: AgingGroup[] =
    groupBy === "client" ? (data?.by_client ?? []) : (data?.by_project ?? []);
  const invoicesById = useMemo(() => {
    const m = new Map<string, AgingInvoiceRow>();
    for (const r of data?.invoices ?? []) m.set(r.id, r);
    return m;
  }, [data]);

  const overduePct =
    data && data.total_ar > 0 ? Math.round((data.overdue_ar / data.total_ar) * 100) : 0;

  async function handleExport() {
    try {
      const res = await exportCsv({ data: {} });
      downloadCsv(res.filename, res.csv);
      toast.success("AR aging exported");
    } catch (e) {
      toast.error(invoiceErrorMessage(e));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AR aging & collections"
        description={`Open receivables aged by due date, converted to ${base} and weighted by collection probability.`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void handleExport()}>
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      {data && data.fx_missing_currencies.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            No FX rate to {base} for {data.fx_missing_currencies.join(", ")}. Those balances are
            shown at face value and are excluded from conversion accuracy.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiTile
          label="Total AR"
          value={formatMoney(data?.total_ar ?? 0, base)}
          hint={FORMULAS.totalAr}
          icon={Wallet}
          isLoading={isLoading}
        />
        <KpiTile
          label="Overdue AR"
          value={formatMoney(data?.overdue_ar ?? 0, base)}
          delta={`${overduePct}% of AR`}
          status={overduePct > 40 ? "bad" : overduePct > 15 ? "warning" : "good"}
          hint={FORMULAS.overdueAr}
          icon={AlertTriangle}
          isLoading={isLoading}
        />
        <KpiTile
          label="Expected cash"
          value={formatMoney(data?.expected_cash ?? 0, base)}
          hint={FORMULAS.expectedCash}
          icon={Wallet}
          isLoading={isLoading}
        />
      </div>

      <Card className="space-y-3 p-4">
        <SectionHeader
          title="Aging profile"
          description="Balance per bucket against probability-weighted expected cash."
        />
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (data?.total_ar ?? 0) === 0 ? (
          <EmptyState title="No open receivables" compact />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.bars ?? []} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" className="fill-muted-foreground" tick={{ fontSize: 11 }} />
                <YAxis className="fill-muted-foreground" tick={{ fontSize: 11 }} />
                <ChartTooltip
                  cursor={{ className: "fill-muted/40" }}
                  formatter={(v: number) => formatMoney(v, base)}
                />
                <Bar
                  dataKey="balance"
                  name="Balance"
                  className="fill-primary"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expected"
                  name="Expected"
                  className="fill-accent"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <SectionHeader
          title="Expected-cash forecast"
          description="Next 90 days — overdue balances are projected into the current month."
        />
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : (data?.forecast.length ?? 0) === 0 ? (
          <EmptyState title="Nothing expected in the next 90 days" compact />
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.forecast ?? []} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="fill-muted-foreground" tick={{ fontSize: 11 }} />
                <YAxis className="fill-muted-foreground" tick={{ fontSize: 11 }} />
                <ChartTooltip formatter={(v: number) => formatMoney(v, base)} />
                <Line
                  type="monotone"
                  dataKey="expected"
                  name="Expected cash"
                  className="stroke-accent"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  name="Gross balance"
                  className="stroke-primary"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <SectionHeader
          title="Aging table"
          description="Expand a row to drill into its open invoices and send reminders."
          actions={
            <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as "client" | "project")}>
              <TabsList>
                <TabsTrigger value="client">By client</TabsTrigger>
                <TabsTrigger value="project">By project</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No open receivables"
            description="Approved, sent or partially paid receivable invoices appear here once issued."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{groupBy === "client" ? "Client" : "Project"}</TableHead>
                {AGING_BUCKETS.map((b) => (
                  <TableHead key={b} className="text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{AGING_BUCKET_LABELS[b]}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Collection probability {Math.round(AGING_WEIGHTS[b] * 100)}%
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Expected</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => {
                const isOpen = expanded === g.key;
                return [
                  <TableRow
                    key={g.key}
                    className="cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : g.key)}
                  >
                    <TableCell className="font-medium text-foreground">
                      <span className="flex items-center gap-1.5">
                        {isOpen ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        {g.label}
                      </span>
                    </TableCell>
                    {AGING_BUCKETS.map((b) => (
                      <TableCell key={b} className="text-right tabular-nums">
                        {g.buckets[b] ? formatMoney(g.buckets[b], base) : "—"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(g.total, base)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-accent">
                      {formatMoney(g.expected_cash, base)}
                    </TableCell>
                  </TableRow>,
                  isOpen ? (
                    <TableRow key={`${g.key}-detail`}>
                      <TableCell colSpan={AGING_BUCKETS.length + 3} className="bg-muted/30 p-0">
                        <div className="space-y-2 p-3">
                          {g.invoice_ids.map((id) => {
                            const inv = invoicesById.get(id);
                            if (!inv) return null;
                            return (
                              <div
                                key={id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-2.5"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-sm font-medium text-foreground">
                                    {inv.invoice_number}
                                    {inv.project_name ? (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        {inv.project_name}
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Due {formatDate(inv.due_date)} ·{" "}
                                    {inv.days_past_due > 0
                                      ? `${inv.days_past_due}d past due`
                                      : "not yet due"}{" "}
                                    · {inv.reminder_count} reminder(s)
                                  </p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Badge variant="outline">{AGING_BUCKET_LABELS[inv.bucket]}</Badge>
                                  <span className="text-sm tabular-nums text-foreground">
                                    {formatMoney(inv.balance, inv.currency_code, {
                                      maximumFractionDigits: 2,
                                    })}
                                  </span>
                                  <SendReminderDialog
                                    invoiceId={inv.id}
                                    invoiceNumber={inv.invoice_number}
                                    clientName={inv.client_name}
                                    daysPastDue={inv.days_past_due}
                                    disabled={!access?.canRemind}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          {FORMULAS.buckets} · {FORMULAS.balance}
        </p>
      </Card>
    </div>
  );
}
