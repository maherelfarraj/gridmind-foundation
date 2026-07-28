// P-190 — Change impact dashboard.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CircleDollarSign, GitPullRequestArrow, Timer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { AGE_BUCKETS, changeTypeMeta, heatClass, OPEN_STATUSES } from "@/lib/moc.rules";
import { getMocDashboard } from "@/lib/moc.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/changes/dashboard")({
  head: () => ({
    meta: [
      { title: "Change impact dashboard — GridMind EPC" },
      {
        name: "description",
        content: "Open change requests by status, type, age and cost or schedule exposure.",
      },
    ],
  }),
  component: MocDashboardPage,
});

function MocDashboardPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const fetchDashboard = useServerFn(getMocDashboard);
  const query = useQuery({
    queryKey: ["moc", "dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const goto = (search: { status?: string; type?: string; project?: string }) =>
    void navigate({
      to: "/changes",
      search: { status: search.status, type: search.type, project: search.project },
    });

  if (query.isPending) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("adminMod.changes.register.dashboardLoadError")}
          description={t("adminMod.changes.register.dashboardLoadErrorDesc")}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              {t("adminMod.approvals.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const data = query.data;
  const chartData = data.byType.map((t) => ({
    name: changeTypeMeta(t.change_type).label,
    type: t.change_type,
    count: t.count,
  }));
  const maxAging = Math.max(
    1,
    ...data.aging.flatMap((row) => AGE_BUCKETS.map((b) => row.buckets[b])),
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adminMod.changes.register.dashboardTitle")}
        description="Where change is concentrated, how old it is, and what it costs."
        actions={
          <Button variant="outline" onClick={() => goto({})}>
            {t("adminMod.changes.register.openRegister")}
          </Button>
        }
      />

      <KpiGrid>
        <KpiTile
          label={t("adminMod.changes.register.openChangeRequests")}
          value={data.openCount}
          icon={GitPullRequestArrow}
          hint={OPEN_STATUSES.map((s) => `${s}: ${data.byStatus[s] ?? 0}`).join(" · ")}
        />
        <KpiTile
          label={t("adminMod.changes.register.avgDaysToClose")}
          value={data.avgDaysToClose == null ? "—" : data.avgDaysToClose.toFixed(1)}
          icon={Timer}
        />
        <KpiTile
          label={t("adminMod.changes.register.costImpactOpen")}
          value={formatMoney(data.openCostImpact, "USD")}
          icon={CircleDollarSign}
          status={data.openCostImpact > 0 ? "warning" : "neutral"}
        />
        <KpiTile
          label={t("adminMod.changes.register.scheduleDaysAtRisk")}
          value={data.openScheduleDays}
          icon={CalendarClock}
          status={data.openScheduleDays > 0 ? "warning" : "neutral"}
        />
      </KpiGrid>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium text-foreground">
          {t("adminMod.changes.register.openChangesByType")}
        </h2>
        {chartData.length === 0 ? (
          <EmptyState title={t("adminMod.changes.register.noOpen")} compact />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: 8, right: 8, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="name"
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                />
                <YAxis allowDecimals={false} className="fill-muted-foreground" />
                <Tooltip cursor={{ className: "fill-muted/40" }} />
                <Bar
                  dataKey="count"
                  className="fill-primary"
                  radius={[4, 4, 0, 0]}
                  onClick={(bar: { payload?: { type?: string } }) =>
                    bar.payload?.type ? goto({ type: bar.payload.type }) : undefined
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="space-y-3 overflow-x-auto p-4">
        <h2 className="text-sm font-medium text-foreground">
          {t("adminMod.changes.register.agingOfOpenChanges")}
        </h2>
        {data.aging.length === 0 ? (
          <EmptyState title={t("adminMod.changes.register.nothingAging")} compact />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminMod.changes.register.typeCol")}</TableHead>
                {AGE_BUCKETS.map((b) => (
                  <TableHead key={b} className="text-center">
                    {b} {t("adminMod.changes.register.daysUnit")}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.aging.map((row) => (
                <TableRow key={row.change_type}>
                  <TableCell>{changeTypeMeta(row.change_type).label}</TableCell>
                  {AGE_BUCKETS.map((b) => (
                    <TableCell key={b} className="p-1 text-center">
                      <button
                        type="button"
                        className={`w-full rounded-md px-2 py-2 text-sm ${heatClass(row.buckets[b], maxAging)}`}
                        onClick={() => goto({ type: row.change_type })}
                      >
                        {row.buckets[b]}
                      </button>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="space-y-3 overflow-x-auto p-4">
        <h2 className="text-sm font-medium text-foreground">
          {t("adminMod.changes.register.costScheduleByProject")}
        </h2>
        {data.byProject.length === 0 ? (
          <EmptyState title={t("adminMod.changes.register.noneYet")} compact />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminMod.changes.register.projectCol")}</TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.openCol")}
                </TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.openCostCol")}
                </TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.openDaysCol")}
                </TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.closedCol")}
                </TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.closedCostCol")}
                </TableHead>
                <TableHead className="text-right">
                  {t("adminMod.changes.register.closedDaysCol")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byProject.map((row) => (
                <TableRow
                  key={row.project_id ?? "none"}
                  className="cursor-pointer"
                  onClick={() => goto(row.project_id ? { project: row.project_id } : {})}
                >
                  <TableCell>{row.project_name}</TableCell>
                  <TableCell className="text-right">{row.openCount}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.openCost, "USD")}</TableCell>
                  <TableCell className="text-right">{row.openDays}</TableCell>
                  <TableCell className="text-right">{row.closedCount}</TableCell>
                  <TableCell className="text-right">{formatMoney(row.closedCost, "USD")}</TableCell>
                  <TableCell className="text-right">{row.closedDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
