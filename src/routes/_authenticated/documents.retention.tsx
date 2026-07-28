// P-267 — Retention report: class distribution + disposal-eligible queue.
// Read-only by design: disposal only ever happens through the audited
// retention job, never from this screen.
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import {
  classDistribution,
  daysToExpiry,
  distributionTotals,
  isRetentionClass,
  partitionQueue,
  type DisposalQueueRow,
} from "@/lib/document-retention.rules";
import { getDisposalQueue, getRetentionSummary } from "@/lib/turnover-dossier.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

const WITHIN_DAYS = 90;

export const Route = createFileRoute("/_authenticated/documents/retention")({
  head: () => ({
    meta: [
      { title: "Document retention — GridMind" },
      {
        name: "description",
        content:
          "Retention class distribution across the controlled document register plus the disposal-eligible queue and legal holds.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RetentionPage,
});

function RetentionPage() {
  const { t } = useI18n();
  const summaryFn = useServerFn(getRetentionSummary);
  const queueFn = useServerFn(getDisposalQueue);

  const summary = useQuery({
    queryKey: ["retention-summary"],
    queryFn: () => summaryFn({ data: {} }),
  });
  const queue = useQuery({
    queryKey: ["retention-queue", WITHIN_DAYS],
    queryFn: () => queueFn({ data: { withinDays: WITHIN_DAYS } }),
  });

  const distribution = useMemo(() => classDistribution(summary.data ?? []), [summary.data]);
  const totals = useMemo(() => distributionTotals(distribution), [distribution]);
  const parts = useMemo(() => partitionQueue(queue.data ?? []), [queue.data]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("engMod.retention.title")}
        description={t("engMod.retention.subtitle")}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("engMod.retention.documents")} value={totals.total} />
        <Stat label={t("engMod.retention.expiringSoon")} value={totals.expiring90d} />
        <Stat label={t("engMod.retention.eligible")} value={parts.eligible.length} tone="danger" />
        <Stat label={t("engMod.retention.onHold")} value={totals.onHold} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("engMod.retention.classDistribution")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {distribution.map((row) => {
            return (
              <div key={row.retentionClass} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {t(`engMod.retention.classLabel.${row.retentionClass}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {row.total} · {Math.round(row.share * 100)}%
                  </span>
                </div>
                <Progress value={Math.round(row.share * 100)} />
                <p className="text-xs text-muted-foreground">
                  {t(`engMod.retention.classDesc.${row.retentionClass}`)} ·{" "}
                  {t("engMod.retention.expiringSoon")}: {row.expiring90d} ·{" "}
                  {t("engMod.retention.eligible")}: {row.disposalEligible} ·{" "}
                  {t("engMod.retention.onHold")}: {row.onHold}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("engMod.retention.queueTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("engMod.retention.queueSubtitle")} ·{" "}
            {t("engMod.retention.withinDays", { days: WITHIN_DAYS })}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {(queue.data ?? []).length === 0 ? (
            <EmptyState
              icon={Archive}
              title={t("engMod.retention.empty")}
              description={t("engMod.retention.queueSubtitle")}
            />
          ) : (
            [...parts.eligible, ...parts.maturing, ...parts.held].map((row) => (
              <QueueRow key={row.id} row={row} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QueueRow({ row }: { row: DisposalQueueRow }) {
  const { t } = useI18n();
  const days = daysToExpiry(row);
  const overdue = days !== null && days <= 0 && !row.legal_hold;
  const cls = isRetentionClass(row.retention_class)
    ? t(`engMod.retention.classLabel.${row.retention_class}`)
    : row.retention_class;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 ${
        overdue ? "border-destructive/60 bg-destructive/5" : "border-border"
      }`}
    >
      <div className="space-y-1">
        <Link
          to="/documents/$documentId"
          params={{ documentId: row.id }}
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          {row.doc_number ?? "—"} · {row.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {cls} · {row.project_name ?? "—"} ·{" "}
          {row.retention_expires_at ? row.retention_expires_at.slice(0, 10) : "—"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{row.status}</Badge>
        {row.legal_hold ? (
          <Badge variant="outline">{t("engMod.retention.legalHold")}</Badge>
        ) : overdue ? (
          <Badge variant="destructive">{t("engMod.retention.overdue")}</Badge>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-2xl font-semibold ${tone === "danger" && value > 0 ? "text-destructive" : ""}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
