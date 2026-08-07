// GC-10 — Portfolio finance alerts & escalations.
// Finance-authorised view over the alerts produced by the scheduled evaluator.
// No financial maths happens here: every number is read from the authoritative
// portfolio aggregation via the evaluator's persisted alert rows.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, BellRing, Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AlertsTable } from "@/components/portfolio/alerts-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
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
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  acknowledgePortfolioAlert,
  evaluatePortfolioAlertsNow,
  getPortfolioAlertsCsv,
  snoozePortfolioAlert,
} from "@/lib/portfolio-alerts.functions";
import { portfolioAlertsQueryOptions } from "@/lib/portfolio-alerts.query";
import {
  ALERT_RULE_TYPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
} from "@/lib/portfolio-alerts.rules";

const K = "portfolioMod.costing.alerts";
const ALL = "__all__";

const searchSchema = z.object({
  status: z.enum(ALERT_STATUSES).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  rule_type: z.enum(ALERT_RULE_TYPES).optional(),
  project_id: z.string().uuid().optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  owner_id: z.string().uuid().optional(),
  overdue_only: z.boolean().optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/alerts")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio finance alerts | GridMind EPC" },
      {
        name: "description",
        content:
          "Proactive finance alerts and escalations across FX gaps, stale forecasts, EAC deterioration, budget breaches and close readiness.",
      },
      { property: "og:title", content: "Portfolio finance alerts | GridMind EPC" },
      {
        property: "og:description",
        content: "Deduplicated, owned and SLA-tracked finance exceptions across the portfolio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: () => (
    <div className="page-shell">
      <Skeleton className="h-64 w-full" />
    </div>
  ),
  errorComponent: AlertsError,
  notFoundComponent: AlertsEmpty,
  component: AlertsPage,
});

function AlertsError() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={AlertTriangle}
        title={t(`${K}.error.title`)}
        description={t(`${K}.error.description`)}
      />
    </div>
  );
}

function AlertsEmpty() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={BellRing}
        title={t(`${K}.empty.title`)}
        description={t(`${K}.empty.description`)}
      />
    </div>
  );
}

function AlertsPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const filter = { ...search, page: search.page ?? 1, page_size: 50 as const };
  const { data } = useSuspenseQuery(portfolioAlertsQueryOptions(filter));

  const downloadCsv = useServerFn(getPortfolioAlertsCsv);
  const acknowledge = useServerFn(acknowledgePortfolioAlert);
  const snooze = useServerFn(snoozePortfolioAlert);
  const evaluate = useServerFn(evaluatePortfolioAlertsNow);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, page: 1, ...patch }) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["portfolio", "alerts"] });

  async function onAcknowledge(id: string) {
    setBusyId(id);
    try {
      await acknowledge({ data: { alert_id: id } });
      await refresh();
      toast.success(t(`${K}.acknowledged`));
    } catch {
      toast.error(t(`${K}.actionFailed`));
    } finally {
      setBusyId(null);
    }
  }

  async function onSnooze(id: string) {
    setBusyId(id);
    try {
      // Default snooze horizon: 7 days, matching the escalation cadence.
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await snooze({ data: { alert_id: id, until } });
      await refresh();
      toast.success(t(`${K}.snoozed`));
    } catch {
      toast.error(t(`${K}.actionFailed`));
    } finally {
      setBusyId(null);
    }
  }

  async function onEvaluate() {
    setWorking(true);
    try {
      const res = await evaluate({ data: search.period ? { period: search.period } : {} });
      await refresh();
      toast.success(t(`${K}.evaluated`, { created: res.created, resolved: res.resolved }));
    } catch {
      toast.error(t(`${K}.actionFailed`));
    } finally {
      setWorking(false);
    }
  }

  async function onExport() {
    setWorking(true);
    try {
      const res = await downloadCsv({ data: filter });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t(`${K}.exportFailed`));
    } finally {
      setWorking(false);
    }
  }

  const s = data.summary;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <div className="page-shell">
      <PageHeader
        title={t(`${K}.title`)}
        description={t(`${K}.subtitle`)}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/portfolio/costing">
                <ArrowLeft className="size-4" /> {t(`${K}.back`)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onEvaluate} disabled={working}>
              <RefreshCw className="size-4" /> {t(`${K}.evaluateNow`)}
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} disabled={working}>
              <Download className="size-4" /> {t(`${K}.exportCsv`)}
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <fieldset className="flex flex-wrap items-end gap-4">
          <legend className="sr-only">{t(`${K}.filters.legend`)}</legend>
          <div className="space-y-1">
            <Label htmlFor="status">{t(`${K}.filters.status`)}</Label>
            <Select
              value={search.status ?? ALL}
              onValueChange={(v) =>
                setSearch({
                  status: v === ALL ? undefined : (v as (typeof ALERT_STATUSES)[number]),
                })
              }
            >
              <SelectTrigger id="status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {ALERT_STATUSES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`${K}.status.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="severity">{t(`${K}.filters.severity`)}</Label>
            <Select
              value={search.severity ?? ALL}
              onValueChange={(v) =>
                setSearch({
                  severity: v === ALL ? undefined : (v as (typeof ALERT_SEVERITIES)[number]),
                })
              }
            >
              <SelectTrigger id="severity" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {ALERT_SEVERITIES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`${K}.severity.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule">{t(`${K}.filters.rule`)}</Label>
            <Select
              value={search.rule_type ?? ALL}
              onValueChange={(v) =>
                setSearch({
                  rule_type: v === ALL ? undefined : (v as (typeof ALERT_RULE_TYPES)[number]),
                })
              }
            >
              <SelectTrigger id="rule" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {ALERT_RULE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`${K}.rule.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="project">{t(`${K}.filters.project`)}</Label>
            <Select
              value={search.project_id ?? ALL}
              onValueChange={(v) => setSearch({ project_id: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="project" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {data.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="owner">{t(`${K}.filters.owner`)}</Label>
            <Select
              value={search.owner_id ?? ALL}
              onValueChange={(v) => setSearch({ owner_id: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="owner" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {data.owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="overdue">{t(`${K}.filters.overdue`)}</Label>
            <Select
              value={search.overdue_only ? "yes" : ALL}
              onValueChange={(v) => setSearch({ overdue_only: v === "yes" ? true : undefined })}
            >
              <SelectTrigger id="overdue" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                <SelectItem value="yes">{t(`${K}.filters.overdueOnly`)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </fieldset>
      </Card>

      <p className="sr-only" role="status" aria-live="polite">
        {t(`${K}.pagination.announce`, {
          count: data.total,
          shown: data.alerts.length,
          page: filter.page,
          pages,
        })}
      </p>

      <KpiGrid columns={4} label={t(`${K}.title`)}>
        <KpiTile
          label={t(`${K}.kpi.open`)}
          value={String(s.open)}
          icon={BellRing}
          status={s.open > 0 ? "warning" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.critical`)}
          value={String(s.by_severity.critical + s.by_severity.high)}
          status={s.by_severity.critical > 0 ? "critical" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.ackOverdue`)}
          value={String(s.ack_overdue)}
          status={s.ack_overdue > 0 ? "critical" : "good"}
        />
        <KpiTile
          label={t(`${K}.kpi.projects`)}
          value={String(s.projects_affected)}
          hint={t(`${K}.kpi.oldest`, { days: s.oldest_age_days })}
        />
      </KpiGrid>

      {data.alerts.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={t(`${K}.empty.title`)}
          description={t(`${K}.empty.description`)}
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <AlertsTable
            alerts={data.alerts}
            busyId={busyId}
            onAcknowledge={onAcknowledge}
            onSnooze={onSnooze}
          />
        </Card>
      )}

      <nav aria-label={t(`${K}.pagination.label`)} className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {t(`${K}.pagination.status`, { page: filter.page, pages })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filter.page <= 1}
            onClick={() => void navigate({ search: (p) => ({ ...p, page: filter.page - 1 }) })}
          >
            {t(`${K}.pagination.prev`)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={filter.page >= pages}
            onClick={() => void navigate({ search: (p) => ({ ...p, page: filter.page + 1 }) })}
          >
            {t(`${K}.pagination.next`)}
          </Button>
        </div>
      </nav>
    </div>
  );
}
