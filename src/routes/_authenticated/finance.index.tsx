// P-196 — Finance cockpit: KPI tiles, aging mini-chart, 6-month cash trend, audit feed.
import { useEffect, useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Coins,
  FileBarChart,
  GitCompare,
  Info,
  Inbox,
  RefreshCw,
  ShieldAlert,
  Stamp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile, type KpiStatus } from "@/components/ui/kpi-tile";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { arAgingQueryOptions } from "@/lib/ar-aging.query";
import {
  budgetStatus,
  cashPositionStatus,
  coExposureStatus,
  COCKPIT_FORMULAS,
} from "@/lib/finance-cockpit.rules";
import { financeAccessQueryOptions, financeCockpitQueryOptions } from "@/lib/finance-cockpit.query";
import { formatMoney, formatNumber, formatRelative } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/finance/")({
  head: () => ({
    meta: [
      { title: "Finance cockpit — GridMind EPC" },
      {
        name: "description",
        content:
          "Cash position, receivables, commitments, approvals, change-order exposure and SLA credits in one traceable finance home.",
      },
      { property: "og:title", content: "Finance cockpit — GridMind EPC" },
      {
        property: "og:description",
        content: "One page where finance sees cash, AR, commitments, approvals and exposure.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinanceCockpitPage,
});

const BUCKET_TONES = ["bg-chart-2", "bg-chart-5", "bg-chart-1", "bg-chart-3", "bg-destructive"];

function FormulaInfo({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Formula and source tables"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

function TileShell({ to, children }: { to?: string; children: React.ReactNode }) {
  if (!to) return <>{children}</>;
  return (
    <Link to={to} className="block focus-visible:outline-none">
      {children}
    </Link>
  );
}

const NA = <span className="text-muted-foreground">n/a</span>;

function FinanceCockpitPage() {
  const navigate = useNavigate();
  const access = useQuery(financeAccessQueryOptions());
  const level = access.data?.level;

  useEffect(() => {
    if (level === "none") {
      toast.error("Finance cockpit is restricted to finance and project administrators.");
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [level, navigate]);

  const enabled = level === "full" || level === "read";
  const cockpit = useQuery({ ...financeCockpitQueryOptions(), enabled });
  const aging = useQuery({ ...arAgingQueryOptions(), enabled });

  const data = cockpit.data;
  const currency = data?.base_currency ?? aging.data?.base_currency ?? "USD";
  const money = (v: number | null | undefined) => formatMoney(v ?? 0, currency);

  const bars = aging.data?.bars ?? [];
  const agingTotal = bars.reduce((a, b) => a + b.balance, 0);

  const trend = data?.cash_trend.value ?? [];
  const hasForecast = trend.some((p) => p.forecast_net !== null);

  const isLoading = access.isLoading || (enabled && (cockpit.isLoading || aging.isLoading));
  const error = cockpit.error ?? aging.error;

  const isEmpty = useMemo(() => {
    if (!data) return false;
    return (
      (data.cash_position.value?.net ?? 0) === 0 &&
      (data.open_pay_apps.value?.count ?? 0) === 0 &&
      (data.budget_vs_actual.value?.budget ?? 0) === 0 &&
      (data.pending_approvals.value?.count ?? 0) === 0 &&
      (data.co_exposure.value?.contract_value ?? 0) === 0 &&
      agingTotal === 0 &&
      (data.activity.value?.length ?? 0) === 0
    );
  }, [data, agingTotal]);

  if (level === "none") return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance cockpit"
        description="Cash, receivables, commitments, approvals and exposure — every number traceable to its formula and source tables."
        actions={
          <div className="flex items-center gap-2">
            {level === "read" ? <Badge variant="outline">Read-only</Badge> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void cockpit.refetch();
                void aging.refetch();
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="flex flex-col items-start gap-3 border-destructive/40 p-5">
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">Could not load finance data</p>
            <p className="text-sm text-muted-foreground">
              {(error as Error).message || "Unexpected error."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void cockpit.refetch();
              void aging.refetch();
            }}
          >
            Retry
          </Button>
        </Card>
      ) : null}

      {isEmpty && !isLoading ? (
        <EmptyState
          icon={Coins}
          title="No finance data yet"
          description="No finance data yet — import budgets and record your first invoice."
          action={
            <Button asChild size="sm">
              <Link to="/finance/invoices">Go to invoices</Link>
            </Button>
          }
        />
      ) : null}

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TileShell to="/finance/payments">
          <KpiTile
            isLoading={isLoading}
            icon={Wallet}
            label="Cash position (this month)"
            value={data?.cash_position.available ? money(data.cash_position.value!.net) : NA}
            status={
              data?.cash_position.available
                ? cashPositionStatus(data.cash_position.value!.net)
                : ("neutral" as KpiStatus)
            }
            hint={
              <span className="flex items-center gap-1.5">
                {data?.cash_position.available
                  ? `In ${money(data.cash_position.value!.inflow)} · Out ${money(data.cash_position.value!.outflow)}`
                  : "Payments table unavailable"}
                <FormulaInfo text={COCKPIT_FORMULAS.cash_position} />
              </span>
            }
          />
        </TileShell>

        <TileShell to="/finance/receivables">
          <KpiTile
            isLoading={isLoading}
            icon={Coins}
            label="Receivables"
            value={aging.data ? money(aging.data.total_ar) : NA}
            hint={
              <span className="flex items-center gap-1.5">
                <span className={aging.data?.overdue_ar ? "text-destructive" : undefined}>
                  Overdue {aging.data ? money(aging.data.overdue_ar) : "n/a"}
                </span>
                <FormulaInfo text={COCKPIT_FORMULAS.ar_total} />
              </span>
            }
            status={aging.data && aging.data.overdue_ar > 0 ? "warning" : "neutral"}
          />
        </TileShell>

        <TileShell to="/finance/invoices">
          <KpiTile
            isLoading={isLoading}
            icon={FileBarChart}
            label="Open pay applications"
            value={data?.open_pay_apps.available ? money(data.open_pay_apps.value!.total) : NA}
            hint={
              <span className="flex items-center gap-1.5">
                {data?.open_pay_apps.available
                  ? `${formatNumber(data.open_pay_apps.value!.count)} submitted / certified`
                  : "Pay applications table unavailable"}
                <FormulaInfo text={COCKPIT_FORMULAS.open_pay_apps} />
              </span>
            }
          />
        </TileShell>

        <KpiTile
          isLoading={isLoading}
          icon={Coins}
          label="Budget vs actual"
          value={
            data?.budget_vs_actual.available ? (
              <span className="flex flex-wrap items-baseline gap-2">
                <span>{money(data.budget_vs_actual.value!.actual)}</span>
                <span className="text-sm text-muted-foreground">
                  of {money(data.budget_vs_actual.value!.budget)}
                </span>
              </span>
            ) : (
              NA
            )
          }
          status={
            data?.budget_vs_actual.available
              ? budgetStatus(data.budget_vs_actual.value!.consumed_pct)
              : "neutral"
          }
          hint={
            <span className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5">
                {data?.budget_vs_actual.value?.consumed_pct != null
                  ? `${data.budget_vs_actual.value.consumed_pct.toFixed(1)}% consumed`
                  : "No budgets"}
                <FormulaInfo text={COCKPIT_FORMULAS.budget_vs_actual} />
              </span>
              {data?.budget_vs_actual.value?.consumed_pct != null ? (
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <span
                    className={
                      data.budget_vs_actual.value.consumed_pct > 100
                        ? "block h-full bg-destructive"
                        : data.budget_vs_actual.value.consumed_pct > 85
                          ? "block h-full bg-warning"
                          : "block h-full bg-accent"
                    }
                    style={{
                      width: `${Math.min(100, Math.max(0, data.budget_vs_actual.value.consumed_pct))}%`,
                    }}
                  />
                </span>
              ) : null}
            </span>
          }
        />

        <TileShell to="/approvals">
          <KpiTile
            isLoading={isLoading}
            icon={Stamp}
            label="Pending finance approvals"
            value={
              data?.pending_approvals.available
                ? formatNumber(data.pending_approvals.value!.count)
                : NA
            }
            status={
              data?.pending_approvals.value?.count
                ? ("warning" as KpiStatus)
                : ("neutral" as KpiStatus)
            }
            hint={
              <span className="flex items-center gap-1.5">
                Pay applications · change orders · invoices
                <FormulaInfo text={COCKPIT_FORMULAS.pending_approvals} />
              </span>
            }
          />
        </TileShell>

        <KpiTile
          isLoading={isLoading}
          icon={GitCompare}
          label="Change-order exposure"
          value={
            data?.co_exposure.value?.pct != null
              ? `${data.co_exposure.value.pct.toFixed(1)}%`
              : data?.co_exposure.available
                ? "0.0%"
                : NA
          }
          status={
            data?.co_exposure.available
              ? coExposureStatus(data.co_exposure.value!.pct)
              : ("neutral" as KpiStatus)
          }
          hint={
            <span className="flex items-center gap-1.5">
              {data?.co_exposure.available
                ? `${money(data.co_exposure.value!.co_amount)} of ${money(data.co_exposure.value!.contract_value)}`
                : "Change orders or contracts unavailable"}
              <FormulaInfo text={COCKPIT_FORMULAS.co_exposure} />
            </span>
          }
        />

        <KpiTile
          isLoading={isLoading}
          icon={ShieldAlert}
          label="SLA credits at risk"
          value={data?.sla_credits.available ? money(data.sla_credits.value!.total) : NA}
          status={
            data?.sla_credits.value?.total ? ("warning" as KpiStatus) : ("neutral" as KpiStatus)
          }
          hint={
            <span className="flex items-center gap-1.5">
              {data?.sla_credits.available
                ? `${formatNumber(data.sla_credits.value!.count)} open SLA records`
                : "O&M module not installed"}
              <FormulaInfo text={COCKPIT_FORMULAS.sla_credits} />
            </span>
          }
        />

        <Link to="/finance/bonds" search={{ expiring: 30 }} className="block">
          <KpiTile
            isLoading={isLoading}
            icon={ShieldAlert}
            label="Bonds expiring ≤ 30 d"
            value={
              data?.bonds_expiring_30.available
                ? formatNumber(data.bonds_expiring_30.value!.count)
                : NA
            }
            status={
              data?.bonds_expiring_30.value?.count
                ? ("destructive" as KpiStatus)
                : ("neutral" as KpiStatus)
            }
            hint={
              <span className="flex items-center gap-1.5">
                {data?.bonds_expiring_30.available
                  ? data.bonds_expiring_30.value!.per_currency.length > 0
                    ? data.bonds_expiring_30
                        .value!.per_currency.map((c) =>
                          new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: c.currency_code,
                          }).format(c.amount),
                        )
                        .join(" · ")
                    : "No instruments expiring"
                  : "Bonds module not installed"}
                <FormulaInfo text={COCKPIT_FORMULAS.bonds_expiring_30} />
              </span>
            }
          />
        </Link>
      </div>


      {/* Aging mini-chart */}
      <Card className="space-y-4 p-5">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              AR aging
              <FormulaInfo text={COCKPIT_FORMULAS.aging_chart} />
            </span>
          }
          description="Open receivables by age bucket, in base currency."
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/finance/receivables">Open receivables</Link>
            </Button>
          }
        />
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : agingTotal === 0 ? (
          <EmptyState compact icon={Inbox} title="No open receivables" />
        ) : (
          <Link to="/finance/receivables" className="block space-y-3">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
              {bars.map((b, i) => (
                <span
                  key={b.bucket}
                  className={BUCKET_TONES[i]}
                  style={{ width: `${(b.balance / agingTotal) * 100}%` }}
                  aria-label={`${b.label}: ${money(b.balance)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {bars.map((b, i) => (
                <span key={b.bucket} className="flex items-center gap-2 text-xs">
                  <span className={`size-2.5 rounded-full ${BUCKET_TONES[i]}`} aria-hidden />
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="font-medium text-foreground">{money(b.balance)}</span>
                </span>
              ))}
            </div>
          </Link>
        )}
      </Card>

      {/* Cash trend */}
      <Card className="space-y-4 p-5">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              Cash flow — last 6 months
              <FormulaInfo text={COCKPIT_FORMULAS.cash_trend} />
            </span>
          }
          description={
            hasForecast
              ? "Actual inflow, outflow and net, with forecast net dashed."
              : "Actual inflow, outflow and net."
          }
        />
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !data?.cash_trend.available ? (
          <EmptyState compact icon={AlertTriangle} title="Cash flow data unavailable (n/a)" />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={80} />
                <ChartTooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.5rem",
                    color: "var(--color-popover-foreground)",
                  }}
                  formatter={(value: number, name: string) => [money(value), name]}
                />
                <Area
                  type="monotone"
                  dataKey="inflow"
                  name="Inflow"
                  stroke="var(--color-chart-2)"
                  fill="var(--color-chart-2)"
                  fillOpacity={0.2}
                />
                <Area
                  type="monotone"
                  dataKey="outflow"
                  name="Outflow"
                  stroke="var(--color-chart-3)"
                  fill="var(--color-chart-3)"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="var(--color-chart-1)"
                  fill="var(--color-chart-1)"
                  fillOpacity={0.1}
                />
                {hasForecast ? (
                  <Area
                    type="monotone"
                    dataKey="forecast_net"
                    name="Forecast net"
                    stroke="var(--color-chart-5)"
                    strokeDasharray="5 4"
                    fill="none"
                  />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Activity feed */}
      <Card className="space-y-4 p-5">
        <SectionHeader
          title={
            <span className="flex items-center gap-2">
              Recent finance activity
              <FormulaInfo text={COCKPIT_FORMULAS.activity} />
            </span>
          }
          description="Newest finance audit events first."
        />
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data?.activity.available ? (
          <EmptyState compact icon={AlertTriangle} title="Audit log unavailable (n/a)" />
        ) : data.activity.value!.length === 0 ? (
          <EmptyState compact icon={Inbox} title="No finance activity yet" />
        ) : (
          <ul className="divide-y divide-border">
            {data.activity.value!.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Badge variant="outline" className="font-mono text-xs">
                  {row.action}
                </Badge>
                <span className="text-muted-foreground">{row.entity}</span>
                <span className="text-foreground">{row.actor_name ?? "System"}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatRelative(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
