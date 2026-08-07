// GC-12 — Quality gates, exceptions and corrective-action references.
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, percent, ratio } from "@/components/evm/evm-format";
import type { EvmException } from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

function formatValue(e: EvmException, currency: string): string {
  switch (e.value_unit) {
    case "currency":
      return money(e.current_value, currency);
    case "percent":
      return percent(e.current_value);
    case "ratio":
      return ratio(e.current_value);
    case "days":
    case "count":
      return e.current_value === null ? "—" : String(Math.round(e.current_value));
    default:
      return "—";
  }
}

export function EvmExceptionTable({
  exceptions,
  currency,
  title,
  description,
}: {
  exceptions: EvmException[];
  currency: string;
  title: string;
  description: string;
}) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        {exceptions.length === 0 ? (
          <CheckCircle2 className="mt-0.5 size-4 text-accent" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 text-warning" aria-hidden="true" />
        )}
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
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
              <TableHead scope="col" className="text-right">
                {t(`${K}.gates.current`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.gates.threshold`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.gates.action`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exceptions.map((e) => (
              <TableRow key={`${e.code}-${e.title}`}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-foreground">{t(`${K}.exception.${e.code}`, { defaultValue: e.title })}</span>
                    {e.detail ? (
                      <span className="text-xs text-muted-foreground">{e.detail}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={e.blocking ? "blocked" : e.severity}
                    label={t(`${K}.severity.${e.severity}`)}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatValue(e, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.threshold_value === null
                    ? "—"
                    : formatValue({ ...e, current_value: e.threshold_value }, currency)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t(`${K}.corrective.${e.code}`, { defaultValue: t(`${K}.corrective.default`) })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function EvmGateSummary({
  blockers,
  warnings,
  unmappedPct,
  ready,
}: {
  blockers: number;
  warnings: number;
  unmappedPct: number | null;
  ready: boolean;
}) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-wrap items-center gap-6 p-4 text-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{t(`${K}.gates.title`)}</span>
      </div>
      <Field label={t(`${K}.gates.blockers`)} value={String(blockers)} />
      <Field label={t(`${K}.gates.warnings`)} value={String(warnings)} />
      <Field label={t(`${K}.gates.unmapped`)} value={percent(unmappedPct)} />
      <StatusBadge
        status={ready ? "approved" : "blocked"}
        label={ready ? t(`${K}.gates.ready`) : t(`${K}.gates.notReady`)}
      />
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
