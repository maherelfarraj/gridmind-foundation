// GC-10 — Portfolio finance alerts table.
// Accessibility: captioned table, scoped headers, severity and SLA state carried
// by text as well as tone, and row actions with explicit accessible names.
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { PortfolioAlertRow } from "@/lib/portfolio-alerts.server";
import type { AlertSeverity, AlertStatus } from "@/lib/portfolio-alerts.rules";

const K = "portfolioMod.costing.alerts";

const SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  critical: "critical",
  high: "critical",
  medium: "attention",
  low: "neutral",
};

const STATUS_TONE: Record<AlertStatus, StatusTone> = {
  open: "attention",
  acknowledged: "active",
  snoozed: "neutral",
  resolved: "positive",
};

export function AlertsTable({
  alerts,
  busyId,
  onAcknowledge,
  onSnooze,
  caption,
}: {
  alerts: PortfolioAlertRow[];
  busyId?: string | null;
  onAcknowledge?: (id: string) => void;
  onSnooze?: (id: string) => void;
  caption?: string;
}) {
  const { t, locale } = useI18n();
  const actionable = Boolean(onAcknowledge || onSnooze);

  return (
    <Table>
      <TableCaption className="sr-only">{caption ?? t(`${K}.tableCaption`)}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.col.severity`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.rule`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.scope`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.value`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.status`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.age`)}</TableHead>
          {actionable ? <TableHead scope="col">{t(`${K}.col.actions`)}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <StatusBadge
                status={a.severity}
                tone={SEVERITY_TONE[a.severity]}
                label={t(`${K}.severity.${a.severity}`)}
              />
            </TableCell>
            <TableCell>
              <span className="font-medium">
                {t(`${K}.rule.${a.rule_type}`, { defaultValue: a.rule_type })}
              </span>
              <span className="text-muted-foreground block text-xs">{a.title}</span>
            </TableCell>
            <TableCell className="text-xs">
              {a.project_code ? (
                a.deep_link ? (
                  <Link to={a.deep_link} className="underline underline-offset-2">
                    {a.project_code}
                  </Link>
                ) : (
                  a.project_code
                )
              ) : (
                t(`${K}.companyScope`)
              )}
              {a.period_month ? (
                <span className="text-muted-foreground block">
                  {formatDate(a.period_month, locale)}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              {a.current_value === null
                ? "—"
                : `${a.current_value}${a.value_unit === "percent" ? "%" : ""}`}
              {a.threshold_value === null ? null : (
                <span className="text-muted-foreground block">
                  {t(`${K}.threshold`, { value: a.threshold_value })}
                </span>
              )}
            </TableCell>
            <TableCell className="text-xs">
              <StatusBadge
                status={a.effective_status}
                tone={STATUS_TONE[a.effective_status]}
                label={t(`${K}.status.${a.effective_status}`)}
              />
              {a.ack_overdue ? (
                <span className="text-destructive block">{t(`${K}.ackOverdue`)}</span>
              ) : null}
              {a.escalation_tier > 0 ? (
                <span className="text-muted-foreground block">
                  {t(`${K}.tier`, { tier: a.escalation_tier })}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              {t(`${K}.ageDays`, { days: a.age_days })}
              {a.occurrence_count > 1 ? (
                <span className="text-muted-foreground block">
                  {t(`${K}.occurrences`, { count: a.occurrence_count })}
                </span>
              ) : null}
            </TableCell>
            {actionable ? (
              <TableCell className="whitespace-nowrap">
                <div className="flex gap-2">
                  {onAcknowledge && a.effective_status === "open" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === a.id}
                      onClick={() => onAcknowledge(a.id)}
                      aria-label={t(`${K}.acknowledgeOne`, { title: a.title })}
                    >
                      {t(`${K}.acknowledge`)}
                    </Button>
                  ) : null}
                  {onSnooze && a.effective_status !== "resolved" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === a.id}
                      onClick={() => onSnooze(a.id)}
                      aria-label={t(`${K}.snoozeOne`, { title: a.title })}
                    >
                      {t(`${K}.snooze`)}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
