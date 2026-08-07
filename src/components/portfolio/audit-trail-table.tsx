// GC-09 — Portfolio audit trail table: immutable events, redacted metadata.
// Accessibility: captioned table, scoped column headers, severity conveyed by
// text as well as tone, and per-row scope links that name their destination.
import { Link } from "@tanstack/react-router";

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
import type { AuditEvent, AuditSeverity } from "@/lib/portfolio-audit.rules";

const K = "portfolioMod.costing.audit";

const SEVERITY_TONE: Record<AuditSeverity, StatusTone> = {
  critical: "critical",
  warning: "attention",
  info: "neutral",
};

export function AuditTrailTable({
  events,
  period,
  caption,
}: {
  events: AuditEvent[];
  period?: string;
  caption?: string;
}) {
  const { t, locale } = useI18n();

  return (
    <Table>
      <TableCaption className="sr-only">{caption ?? t(`${K}.tableCaption`)}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.col.when`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.actor`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.action`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.severity`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.scope`)}</TableHead>
          <TableHead scope="col">{t(`${K}.col.change`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => {
          const actionLabel = t(`${K}.action.${e.action.replaceAll(".", "_")}`, {
            defaultValue: e.action,
          });
          return (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap text-xs">
                <time dateTime={e.created_at}>
                  {formatDate(e.created_at, locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
                {e.correlation_id ? (
                  <div className="text-muted-foreground">{e.correlation_id}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">{e.actor_name ?? t(`${K}.unattributed`)}</TableCell>
              <TableCell className="text-xs">
                <div className="font-medium">{actionLabel}</div>
                <div className="text-muted-foreground">
                  {t(`${K}.group.${e.group}`)} · {e.entity}
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={e.severity}
                  tone={SEVERITY_TONE[e.severity]}
                  label={t(`${K}.severity.${e.severity}`)}
                />
              </TableCell>
              <TableCell className="text-xs">
                {e.project_id && e.project_code ? (
                  <Link
                    to="/projects/$projectId/costing/close"
                    params={{ projectId: e.project_id }}
                    className="underline-offset-2 hover:underline focus-visible:underline"
                    aria-label={t(`${K}.scopeLink`, { code: e.project_code })}
                  >
                    {e.project_code}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{t(`${K}.companyScope`)}</span>
                )}
                <div className="text-muted-foreground">{(e.period ?? period)?.slice(0, 7) ?? "—"}</div>
              </TableCell>
              <TableCell className="text-xs">
                {e.diff.length > 0 ? (
                  <ul className="space-y-0.5">
                    {e.diff.map((d) => (
                      <li key={d.field}>
                        <span className="text-muted-foreground">{d.field}: </span>
                        {String(d.before ?? "—")} → {String(d.after ?? "—")}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">{e.reason ?? "—"}</span>
                )}
                {e.gap ? (
                  <div className="text-destructive">
                    <span className="sr-only">{t(`${K}.gapPrefix`)} </span>
                    {t(`${K}.gap.${e.gap}`)}
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
