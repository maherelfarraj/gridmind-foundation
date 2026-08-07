// GC-08 — Company close matrix: one row per project for the focus period.
import { Link } from "@tanstack/react-router";

import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { PortfolioProjectRow } from "@/lib/portfolio-costing.rules";

const K = "portfolioMod.costing";

export function CostingCloseMatrix({
  rows,
  period,
}: {
  rows: PortfolioProjectRow[];
  period: string;
}) {
  const { t, locale } = useI18n();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${K}.table.project`)}</TableHead>
          <TableHead>{t(`${K}.close.state`)}</TableHead>
          <TableHead>{t(`${K}.close.checklist`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.close.overdue`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.close.blockers`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.close.warnings`)}</TableHead>
          <TableHead>{t(`${K}.close.gate`)}</TableHead>
          <TableHead>{t(`${K}.close.lastAction`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.project_id}>
            <TableCell>
              <Link
                to="/projects/$projectId/costing/close"
                params={{ projectId: r.project_id }}
                search={{ period }}
                className="font-medium hover:underline"
              >
                {r.code}
              </Link>
              <div className="text-muted-foreground text-xs">{r.name}</div>
            </TableCell>
            <TableCell>
              <StatusBadge
                status={r.close.state}
                tone={
                  r.close.state === "hard_closed"
                    ? "inactive"
                    : r.close.state === "soft_locked"
                      ? "attention"
                      : "active"
                }
                label={t(`financeMod.costing.close.state.${r.close.state}`)}
              />
            </TableCell>
            <TableCell className="min-w-40">
              {r.close.checklist_total === 0 ? (
                <span className="text-muted-foreground text-xs">{t(`${K}.close.noChecklist`)}</span>
              ) : (
                <div className="space-y-1">
                  <Progress value={r.close.checklist_pct ?? 0} />
                  <div className="text-muted-foreground text-xs">
                    {t(`${K}.close.progress`, {
                      done: r.close.checklist_done,
                      total: r.close.checklist_total,
                    })}
                  </div>
                </div>
              )}
            </TableCell>
            <TableCell
              className={`text-end tabular-nums ${r.close.checklist_overdue > 0 ? "text-destructive" : ""}`}
            >
              {formatNumber(r.close.checklist_overdue, locale)}
            </TableCell>
            <TableCell
              className={`text-end tabular-nums ${r.close.exceptions_blockers > 0 ? "text-destructive" : ""}`}
            >
              {formatNumber(r.close.exceptions_blockers, locale)}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatNumber(r.close.exceptions_warnings, locale)}
            </TableCell>
            <TableCell>
              <StatusBadge
                status={r.close.ready ? "approved" : "blocked"}
                label={r.close.ready ? t(`${K}.close.ready`) : t(`${K}.close.blocked`)}
              />
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {r.close.last_action_at ? formatDate(r.close.last_action_at, locale) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
