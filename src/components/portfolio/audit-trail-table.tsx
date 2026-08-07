// GC-09 — Portfolio audit trail table: immutable events, redacted metadata.
import { Link } from "@tanstack/react-router";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { AuditEvent, AuditSeverity } from "@/lib/portfolio-audit.rules";

const K = "portfolioMod.costing.audit";

const SEVERITY_STATUS: Record<AuditSeverity, string> = {
  critical: "blocked",
  warning: "pending",
  info: "completed",
};

export function AuditTrailTable({ events, period }: { events: AuditEvent[]; period?: string }) {
  const { t, locale } = useI18n();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${K}.col.when`)}</TableHead>
          <TableHead>{t(`${K}.col.actor`)}</TableHead>
          <TableHead>{t(`${K}.col.action`)}</TableHead>
          <TableHead>{t(`${K}.col.severity`)}</TableHead>
          <TableHead>{t(`${K}.col.scope`)}</TableHead>
          <TableHead>{t(`${K}.col.change`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-nowrap text-xs">
              {formatDate(e.created_at, locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {e.correlation_id ? (
                <div className="text-muted-foreground">{e.correlation_id}</div>
              ) : null}
            </TableCell>
            <TableCell className="text-xs">{e.actor_name ?? t(`${K}.unattributed`)}</TableCell>
            <TableCell className="text-xs">
              <div className="font-medium">
                {t(`${K}.action.${e.action.replaceAll(".", "_")}`, { defaultValue: e.action })}
              </div>
              <div className="text-muted-foreground">
                {t(`${K}.group.${e.group}`)} · {e.entity}
              </div>
            </TableCell>
            <TableCell>
              <StatusBadge
                status={SEVERITY_STATUS[e.severity]!}
                label={t(`${K}.severity.${e.severity}`)}
              />
            </TableCell>
            <TableCell className="text-xs">
              {e.project_id && e.project_code ? (
                <Link
                  to="/projects/$projectId/costing/close"
                  params={{ projectId: e.project_id }}
                  search={{ period: e.period ?? period ?? undefined }}
                  className="hover:underline"
                >
                  {e.project_code}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t(`${K}.companyScope`)}</span>
              )}
              <div className="text-muted-foreground">{e.period?.slice(0, 7) ?? "—"}</div>
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
              {e.gap ? <div className="text-destructive">{t(`${K}.gap.${e.gap}`)}</div> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
