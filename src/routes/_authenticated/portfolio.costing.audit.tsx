// GC-09 — Portfolio Audit Trail: finance-authorized, immutable event register.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, Download, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AuditTrailTable } from "@/components/portfolio/audit-trail-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
import { getPortfolioAuditCsv } from "@/lib/portfolio-audit.functions";
import { AUDIT_GROUPS, AUDIT_SEVERITIES } from "@/lib/portfolio-audit.rules";
import { portfolioAuditQueryOptions } from "@/lib/portfolio-governance.query";

const K = "portfolioMod.costing.audit";
const ALL = "__all__";

const searchSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  actor: z.string().uuid().optional(),
  group: z.enum(AUDIT_GROUPS).optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  project_id: z.string().uuid().optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  correlation_id: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  page_size: z.coerce.number().int().min(10).max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/portfolio/costing/audit")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Portfolio audit trail | GridMind EPC" },
      {
        name: "description",
        content:
          "Immutable finance audit trail for forecast approvals, FX selection, period close, checklists, exceptions and exports.",
      },
      { property: "og:title", content: "Portfolio audit trail | GridMind EPC" },
      {
        property: "og:description",
        content: "Who changed what, when and why across the consolidated cost and close position.",
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
  errorComponent: AuditError,
  notFoundComponent: AuditEmpty,
  component: AuditPage,
});

function AuditError() {
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

function AuditEmpty() {
  const { t } = useI18n();
  return (
    <div className="page-shell">
      <EmptyState
        icon={ScrollText}
        title={t(`${K}.empty.title`)}
        description={t(`${K}.empty.description`)}
      />
    </div>
  );
}

function AuditPage() {
  const { t } = useI18n();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const filter = { ...search, page: search.page ?? 1, page_size: search.page_size ?? 50 };
  const { data } = useSuspenseQuery(portfolioAuditQueryOptions(filter));
  const downloadCsv = useServerFn(getPortfolioAuditCsv);
  const [downloading, setDownloading] = useState(false);

  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (prev) => ({ ...prev, page: 1, ...patch }) });

  async function onExport() {
    setDownloading(true);
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
      setDownloading(false);
    }
  }

  const rec = data.reconciliation;
  const pages = Math.max(1, Math.ceil(rec.total / filter.page_size));

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
            <Button variant="outline" size="sm" onClick={onExport} disabled={downloading}>
              <Download className="size-4" /> {t(`${K}.exportCsv`)}
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <fieldset className="flex flex-wrap items-end gap-4">
          <legend className="sr-only">{t(`${K}.filters.legend`)}</legend>
          <div className="space-y-1">
            <Label htmlFor="from">{t(`${K}.filters.from`)}</Label>
            <Input
              id="from"
              type="date"
              className="w-40"
              value={search.from ?? ""}
              onChange={(e) => setSearch({ from: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">{t(`${K}.filters.to`)}</Label>
            <Input
              id="to"
              type="date"
              className="w-40"
              value={search.to ?? ""}
              onChange={(e) => setSearch({ to: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="actor">{t(`${K}.filters.actor`)}</Label>
            <Select
              value={search.actor ?? ALL}
              onValueChange={(v) => setSearch({ actor: v === ALL ? undefined : v })}
            >
              <SelectTrigger id="actor" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {data.actors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="group">{t(`${K}.filters.group`)}</Label>
            <Select
              value={search.group ?? ALL}
              onValueChange={(v) =>
                setSearch({ group: v === ALL ? undefined : (v as (typeof AUDIT_GROUPS)[number]) })
              }
            >
              <SelectTrigger id="group" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {AUDIT_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {t(`${K}.group.${g}`)}
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
                  severity: v === ALL ? undefined : (v as (typeof AUDIT_SEVERITIES)[number]),
                })
              }
            >
              <SelectTrigger id="severity" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(`${K}.filters.any`)}</SelectItem>
                {AUDIT_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`${K}.severity.${s}`)}
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
            <Label htmlFor="correlation">{t(`${K}.filters.correlation`)}</Label>
            <Input
              id="correlation"
              className="w-52"
              value={search.correlation_id ?? ""}
              onChange={(e) => setSearch({ correlation_id: e.target.value || undefined })}
            />
          </div>
        </fieldset>
      </Card>

      <p className="sr-only" role="status" aria-live="polite">
        {t(`${K}.pagination.announce`, {
          count: rec.total,
          shown: rec.page_count,
          page: filter.page,
          pages,
        })}
      </p>

      <KpiGrid columns={4} label={t(`${K}.title`)}>
        <KpiTile label={t(`${K}.kpi.total`)} value={String(rec.total)} icon={ScrollText} />
        <KpiTile label={t(`${K}.kpi.onPage`)} value={String(rec.page_count)} />
        <KpiTile label={t(`${K}.kpi.actors`)} value={String(rec.actors)} />
        <KpiTile
          label={t(`${K}.kpi.gaps`)}
          value={String(rec.gaps)}
          status={rec.gaps > 0 ? "warning" : "good"}
          hint={rec.gap_kinds.map((g) => `${t(`${K}.gap.${g.kind}`)} ${g.count}`).join(" · ")}
        />
      </KpiGrid>

      {data.events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t(`${K}.empty.title`)}
          description={t(`${K}.empty.description`)}
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <AuditTrailTable events={data.events} period={search.period} />
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
