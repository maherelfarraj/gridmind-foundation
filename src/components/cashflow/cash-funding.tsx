// GC-13 — Funding facilities, covenants and the maturity ladder.
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bucketLabel, count, money, percent } from "@/components/cashflow/cash-format";
import type { CovenantCheck, FacilityState, MaturityRung } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export function CashFacilityTable({
  facilities,
  currency,
}: {
  facilities: FacilityState[];
  currency: string;
}) {
  const { t } = useI18n();



  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.facilities.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.facilities.description`)}</p>
      </div>
      {facilities.length === 0 ? (
        <EmptyState
          title={t(`${K}.facilities.emptyTitle`)}
          description={t(`${K}.facilities.emptyBody`)}
        />
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.facilities.caption`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.facilities.name`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.facilities.allocated`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.facilities.outstanding`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.facilities.headroom`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.facilities.utilization`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.facilities.state`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facilities.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(f.allocated_reporting, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(f.outstanding_reporting, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(f.headroom_reporting, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {percent(f.utilization_pct)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {f.fx_missing
                    ? t(`${K}.facilities.fxMissing`)
                    : f.refinancing_window
                      ? t(`${K}.facilities.refinancing`, { days: count(f.expires_in_days) })
                      : f.available
                        ? t(`${K}.facilities.available`)
                        : t(`${K}.facilities.unavailable`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function CashCovenantTable({ covenants }: { covenants: CovenantCheck[] }) {
  const { t } = useI18n();
  const hasBreach = covenants.some((c) => c.breached);




  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        {hasBreach ? (
          <AlertTriangle className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 text-accent" aria-hidden="true" />
        )}
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.covenants.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.covenants.description`)}</p>
        </div>
      </div>
      {covenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.covenants.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.covenants.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.covenants.code`)}</TableHead>
              <TableHead scope="col">{t(`${K}.covenants.metric`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.covenants.threshold`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.covenants.value`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.covenants.state`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {covenants.map((c) => (
              <TableRow key={`${c.facility_id}-${c.code}`}>
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.metric} {c.operator}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.threshold.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.value === null ? "—" : c.value.toFixed(2)}
                </TableCell>
                <TableCell
                  className={
                    c.breached
                      ? "text-destructive"
                      : c.near_breach
                        ? "text-warning"
                        : "text-muted-foreground"
                  }
                >
                  {c.breached
                    ? t(`${K}.covenants.breached`)
                    : c.near_breach
                      ? t(`${K}.covenants.near`)
                      : t(`${K}.covenants.ok`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function CashMaturityLadder({
  rungs,
  currency,
}: {
  rungs: MaturityRung[];
  currency: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.maturity.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.maturity.description`)}</p>
      </div>
      {rungs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.maturity.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.maturity.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.maturity.bucket`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.maturity.amount`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.maturity.facilities`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rungs.map((r) => (
              <TableRow key={r.bucket}>
                <TableCell className="font-medium">{bucketLabel(r.bucket, "month")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(r.amount, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.facilities.length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
