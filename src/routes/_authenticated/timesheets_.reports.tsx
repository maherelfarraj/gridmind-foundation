// P-231 — Timesheet reports: KPIs, per-person / per-project / per-discipline
// views, payroll-grade CSV. All filtering and aggregation happens server-side.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BarChart3, Clock, Download, Inbox, Palmtree } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCsv } from "@/lib/csv";
import {
  exportPayrollCsv,
  exportTimesheetReportCsv,
  getTimesheetReport,
} from "@/lib/labor.functions";
import { activityLabel, currentMonthRange } from "@/lib/timesheets/reports";

export const Route = createFileRoute("/_authenticated/timesheets_/reports")({
  head: () => ({
    meta: [
      { title: "Labor reports & payroll export — GridMind EPC" },
      {
        name: "description",
        content:
          "Approved crew hours by person, project and discipline with labor cost rollups, overtime tracking and payroll-grade CSV export.",
      },
      { property: "og:title", content: "Labor reports & payroll export — GridMind EPC" },
      {
        property: "og:description",
        content: "Hours, overtime and labor cost from approved timesheets — one source of truth.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

const ALL = "__all__";
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

type Tab = "person" | "project" | "discipline";

function ReportsPage() {
  const defaults = useMemo(() => currentMonthRange(new Date()), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [projectId, setProjectId] = useState<string>(ALL);
  const [userId, setUserId] = useState<string>(ALL);
  const [tab, setTab] = useState<Tab>("person");

  const filters = {
    from,
    to,
    project_id: projectId === ALL ? null : projectId,
    user_id: userId === ALL ? null : userId,
  };

  const reportFn = useServerFn(getTimesheetReport);
  const report = useQuery({
    queryKey: ["timesheets", "report", filters],
    queryFn: () => reportFn({ data: filters }),
  });

  const reportCsvFn = useServerFn(exportTimesheetReportCsv);
  const payrollCsvFn = useServerFn(exportPayrollCsv);

  const onExported = (res: { filename: string; csv: string; rows: number }) => {
    if (res.rows === 0) {
      toast.info("Nothing to export for this period");
      return;
    }
    downloadCsv(res.filename, res.csv);
    toast.success(`${numFmt.format(res.rows)} rows exported`);
  };
  const onExportError = (e: unknown) => {
    const msg = (e as Error)?.message ?? "Export failed";
    toast.error(msg.includes("Export blocked") ? "Export blocked: approval pending" : msg);
  };

  const reportCsv = useMutation({
    mutationFn: () => reportCsvFn({ data: { ...filters, tab } }),
    onSuccess: onExported,
    onError: onExportError,
  });
  const payrollCsv = useMutation({
    mutationFn: () => payrollCsvFn({ data: filters }),
    onSuccess: onExported,
    onError: onExportError,
  });

  const data = report.data;
  const personName = (id: string) => data?.people[id] ?? "Team member";
  const projectName = (id: string | null) => (id ? (data?.projects[id] ?? id) : "Unassigned");
  const activities = useMemo(() => {
    const set = new Set<string>();
    for (const row of data?.per_person ?? []) {
      for (const key of Object.keys(row.hours_by_activity)) set.add(key);
    }
    return [...set].sort();
  }, [data]);

  const hasRows = (data?.kpis.total_hours ?? 0) > 0;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Labor reports"
        description="Approved hours, overtime and labor cost — the same data payroll and finance use."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/timesheets">Timesheets</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={reportCsv.isPending || !hasRows}
              onClick={() => reportCsv.mutate()}
            >
              <Download className="mr-1.5 size-4" />
              Report CSV
            </Button>
            <Button
              size="sm"
              disabled={payrollCsv.isPending || !data?.can_export}
              onClick={() => payrollCsv.mutate()}
            >
              <Download className="mr-1.5 size-4" />
              Payroll CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {(data?.project_options ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Person</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Everyone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                {(data?.people_options ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {report.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : report.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load reports"
          description={(report.error as Error)?.message ?? "Something went wrong."}
          action={
            <Button variant="outline" onClick={() => void report.refetch()}>
              Retry
            </Button>
          }
        />
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Total hours"
              value={numFmt.format(data.kpis.total_hours)}
              hint={data.formulas.totalHours}
              icon={Clock}
            />
            <KpiTile
              label="Overtime"
              value={pctFmt.format(data.kpis.overtime_pct / 100)}
              hint={data.formulas.overtimePct}
              icon={BarChart3}
              status={data.kpis.overtime_pct > 20 ? "warning" : "good"}
            />
            <KpiTile
              label="Approval backlog"
              value={numFmt.format(data.kpis.backlog_count)}
              hint={data.formulas.backlog}
              icon={Inbox}
              href="/approvals?entity=timesheet"
            />
            <KpiTile
              label="Leave days YTD"
              value={numFmt.format(data.kpis.leave_days_ytd)}
              hint={data.formulas.leaveYtd}
              icon={Palmtree}
            />
          </div>

          {data.missing_rate_rows > 0 ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
              <AlertTriangle className="size-4 text-warning" />
              {numFmt.format(data.missing_rate_rows)} rows have no hourly rate — excluded from
              labor cost.
            </div>
          ) : null}

          {!hasRows ? (
            <EmptyState
              icon={Clock}
              title="No approved timesheets in this period"
              description="Adjust the date range or approve pending weeks in the inbox."
            />
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
              <TabsList>
                <TabsTrigger value="person">Per person</TabsTrigger>
                <TabsTrigger value="project">Per project</TabsTrigger>
                <TabsTrigger value="discipline">Per discipline</TabsTrigger>
              </TabsList>

              <TabsContent value="person">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Hours by activity</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Employee</th>
                          {activities.map((a) => (
                            <th key={a} className="py-2 pr-3 text-right font-medium">
                              {activityLabel(a)}
                            </th>
                          ))}
                          <th className="py-2 pr-3 text-right font-medium">Overtime</th>
                          <th className="py-2 pr-3 text-right font-medium">Total</th>
                          <th className="py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.per_person.map((r) => (
                          <tr key={r.user_id} className="border-b border-border/60">
                            <td className="py-2 pr-3 text-foreground">{personName(r.user_id)}</td>
                            {activities.map((a) => (
                              <td key={a} className="py-2 pr-3 text-right tabular-nums">
                                {numFmt.format(r.hours_by_activity[a] ?? 0)}
                              </td>
                            ))}
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {numFmt.format(r.overtime_hours)}
                            </td>
                            <td className="py-2 pr-3 text-right font-medium tabular-nums">
                              {numFmt.format(r.total_hours)}
                            </td>
                            <td className="py-2">
                              <div className="flex flex-wrap gap-1">
                                {r.statuses.map((s) => (
                                  <StatusBadge key={s} status={s} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="project">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Hours &amp; labor cost by person and discipline
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Project</th>
                          <th className="py-2 pr-3 font-medium">Employee</th>
                          <th className="py-2 pr-3 font-medium">Discipline</th>
                          <th className="py-2 pr-3 text-right font-medium">Hours</th>
                          <th className="py-2 pr-3 text-right font-medium">Labor cost</th>
                          <th className="py-2 text-right font-medium">Missing rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.per_project.map((r, i) => (
                          <tr
                            key={`${r.project_id}-${r.user_id}-${r.discipline}-${i}`}
                            className="border-b border-border/60"
                          >
                            <td className="py-2 pr-3 text-foreground">
                              {projectName(r.project_id)}
                            </td>
                            <td className="py-2 pr-3">{personName(r.user_id)}</td>
                            <td className="py-2 pr-3 capitalize">{r.discipline}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {numFmt.format(r.hours)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {moneyFmt.format(r.labor_cost)}
                            </td>
                            <td className="py-2 text-right tabular-nums">
                              {r.missing_rate_rows > 0 ? numFmt.format(r.missing_rate_rows) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="discipline">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Discipline × project hours</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Discipline</th>
                          {data.discipline_matrix.projects.map((p) => (
                            <th key={p ?? "-"} className="py-2 pr-3 text-right font-medium">
                              {projectName(p)}
                            </th>
                          ))}
                          <th className="py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.discipline_matrix.disciplines.map((d) => (
                          <tr key={d} className="border-b border-border/60">
                            <td className="py-2 pr-3 capitalize text-foreground">{d}</td>
                            {data.discipline_matrix.projects.map((p) => (
                              <td key={p ?? "-"} className="py-2 pr-3 text-right tabular-nums">
                                {numFmt.format(
                                  data.discipline_matrix.cells[`${d}|${p ?? "-"}`] ?? 0,
                                )}
                              </td>
                            ))}
                            <td className="py-2 text-right font-medium tabular-nums">
                              {numFmt.format(data.discipline_matrix.disciplineTotals[d] ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </>
      ) : null}
    </div>
  );
}
