// GC-08 — Consolidated project cost table (reporting currency).
// Presentation only. Every figure arrives pre-translated from the server; this
// component never converts, sums across currencies, or re-derives a measure.
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { PortfolioConsolidation, PortfolioProjectRow } from "@/lib/portfolio-costing.rules";

const K = "portfolioMod.costing";

export function CostingConsolidationTable({
  rows,
  consolidation,
}: {
  rows: PortfolioProjectRow[];
  consolidation: PortfolioConsolidation;
}) {
  const { t, locale } = useI18n();
  const cur = consolidation.currency;
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatCurrency(v, locale, cur);
  const pct = (v: number | null) =>
    v === null ? "—" : formatNumber(v * 100, locale, { maximumFractionDigits: 1 }) + "%";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${K}.table.project`)}</TableHead>
          <TableHead>{t(`${K}.table.basis`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.budgetCurrent`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.committed`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.actual`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.accruals`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.etc`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.eac`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.vac`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.available`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.paid`)}</TableHead>
          <TableHead className="text-end">{t(`${K}.table.consumed`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const m = r.reporting;
          return (
            <TableRow key={r.project_id}>
              <TableCell>
                <Link
                  to="/projects/$projectId/costing/close"
                  params={{ projectId: r.project_id }}
                  className="font-medium hover:underline"
                >
                  {r.code}
                </Link>
                <div className="text-muted-foreground text-xs">{r.name}</div>
                <div className="text-muted-foreground text-xs">
                  {r.currency}
                  {r.currency !== cur && r.rate.rate !== null
                    ? ` @ ${formatNumber(r.rate.rate, locale, { maximumFractionDigits: 6 })} (${r.rate.as_of ?? "—"})`
                    : ""}
                </div>
              </TableCell>
              <TableCell className="space-y-1">
                <StatusBadge
                  status={
                    r.basis === "approved"
                      ? "approved"
                      : r.basis === "indicative"
                        ? "draft"
                        : "not_started"
                  }
                  label={t(`${K}.basis.${r.basis}`)}
                />
                {r.version ? (
                  <div className="text-muted-foreground text-xs">v{r.version.version_no}</div>
                ) : null}
                {r.rate.missing ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-destructive inline-flex items-center gap-1 text-xs">
                        <AlertTriangle className="size-3" /> {t(`${K}.flags.rateMissing`)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t(`${K}.flags.rateMissingHint`, { from: r.currency, to: cur })}
                    </TooltipContent>
                  </Tooltip>
                ) : r.rate.stale ? (
                  <span className="text-warning-foreground text-xs">{t(`${K}.flags.stale`)}</span>
                ) : null}
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.budget_current)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.committed)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.actual)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.accruals)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.etc)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.eac)}</TableCell>
              <TableCell
                className={`text-end tabular-nums ${(m?.vac ?? 0) < 0 ? "text-destructive" : ""}`}
              >
                {money(m?.vac)}
              </TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.available)}</TableCell>
              <TableCell className="text-end tabular-nums">{money(m?.paid ?? null)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {pct(m?.percent_consumed ?? null)}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow className="bg-muted/40 font-medium">
          <TableCell>{t(`${K}.table.total`)}</TableCell>
          <TableCell className="text-muted-foreground text-xs">
            {t(`${K}.table.includedProjects`, { count: consolidation.included })}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.budget_current)}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.committed)}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.actual)}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.accruals)}
          </TableCell>
          <TableCell className="text-end tabular-nums">{money(consolidation.totals.etc)}</TableCell>
          <TableCell className="text-end tabular-nums">{money(consolidation.totals.eac)}</TableCell>
          <TableCell className="text-end tabular-nums">{money(consolidation.totals.vac)}</TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.available)}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {money(consolidation.totals.paid)}
          </TableCell>
          <TableCell className="text-end tabular-nums">
            {pct(consolidation.totals.percent_consumed)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
