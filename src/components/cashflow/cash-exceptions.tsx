// GC-13 — Cash-flow quality gates, exceptions and reconciliation.
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/components/cashflow/cash-format";
import type { CashflowException, ReconciliationResult } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export function CashGateSummary({
  exceptions,
  ready,
}: {
  exceptions: CashflowException[];
  ready: boolean;
}) {
  const { t } = useI18n();
  const blockers = exceptions.filter((e) => e.severity === "blocker").length;
  const warnings = exceptions.filter((e) => e.severity === "warning").length;

  return (
    <Card className="flex flex-wrap items-center gap-4 p-4">
      {ready ? (
        <CheckCircle2 className="size-5 text-accent" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-5 text-warning" aria-hidden="true" />
      )}
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-foreground">
          {ready ? t(`${K}.gates.ready`) : t(`${K}.gates.notReady`)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t(`${K}.gates.summary`, { blockers, warnings })}
        </span>
      </div>
    </Card>
  );
}

export function CashExceptionTable({
  exceptions,
  title,
  description,
}: {
  exceptions: CashflowException[];
  title: string;
  description: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {exceptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.gates.clear`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{title}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.gates.issue`)}</TableHead>
              <TableHead scope="col">{t(`${K}.gates.severity`)}</TableHead>
              <TableHead scope="col">{t(`${K}.gates.detail`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exceptions.map((e, i) => (
              <TableRow key={`${e.code}-${i}`}>
                <TableCell className="font-medium">
                  {t(`${K}.exception.${e.code}`, { defaultValue: e.code })}
                </TableCell>
                <TableCell
                  className={
                    e.severity === "blocker"
                      ? "text-destructive"
                      : e.severity === "warning"
                        ? "text-warning"
                        : "text-muted-foreground"
                  }
                >
                  {t(`${K}.severity.${e.severity}`)}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function CashReconciliation({
  reconciliation,
  currency,
}: {
  reconciliation: ReconciliationResult;
  currency: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t(`${K}.reconciliation.title`)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.reconciliation.description`)}</p>
        </div>
        <span
          className={
            reconciliation.balanced
              ? "text-xs font-medium text-accent"
              : "text-xs font-medium text-destructive"
          }
        >
          {reconciliation.balanced
            ? t(`${K}.reconciliation.balanced`)
            : t(`${K}.reconciliation.unbalanced`)}
        </span>
      </div>
      <Table>
        <caption className="sr-only">{t(`${K}.reconciliation.title`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.reconciliation.dimension`)}</TableHead>
            <TableHead scope="col">{t(`${K}.reconciliation.key`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.inflow`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.outflow`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.net`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reconciliation.rows.map((r) => (
            <TableRow key={`${r.dimension}-${r.key}`}>
              <TableCell className="text-muted-foreground">
                {t(`${K}.reconciliation.dim.${r.dimension}`, { defaultValue: r.dimension })}
              </TableCell>
              <TableCell className="font-medium">{r.key}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.inflow, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {money(r.outflow, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(r.net, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
