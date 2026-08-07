// GC-12 — EVM appendix blocks embedded in the project close pack and the
// portfolio management pack. Read-only evidence: basis, approvals, measures,
// data-quality gaps, reconciliation and the frozen-snapshot watermark.
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
import type {
  EvmAppendix,
  EvmMeasures,
  PortfolioEvmRow,
  PortfolioEvmTotals,
} from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function MeasureRow({ measures, currency }: { measures: EvmMeasures; currency: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Field label={t(`${K}.kpi.pv`)} value={money(measures.pv, currency)} />
      <Field label={t(`${K}.kpi.ev`)} value={money(measures.ev, currency)} />
      <Field label={t(`${K}.kpi.ac`)} value={money(measures.ac, currency)} />
      <Field label={t(`${K}.kpi.cpi`)} value={ratio(measures.cpi)} />
      <Field label={t(`${K}.kpi.spi`)} value={ratio(measures.spi)} />
      <Field label={t(`${K}.kpi.eac`)} value={money(measures.eac, currency)} />
    </div>
  );
}

export function EvmAppendixCard({ appendix }: { appendix: EvmAppendix }) {
  const { t } = useI18n();
  const frozen = appendix.status === "approved" || appendix.status === "submitted";
  const currency = appendix.fx.reporting_currency;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.appendix.description`)}</p>
        </div>
        <StatusBadge
          status={frozen ? "approved" : "draft"}
          label={
            frozen ? t(`${K}.appendix.watermarkFrozen`) : t(`${K}.appendix.watermarkWorking`)
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label={t(`${K}.appendix.period`)} value={appendix.period_month.slice(0, 7)} />
        <Field label={t(`${K}.appendix.dataDate`)} value={appendix.data_date} />
        <Field
          label={t(`${K}.appendix.status`)}
          value={t(`${K}.status.${appendix.status}`, { defaultValue: appendix.status })}
        />
        <Field label={t(`${K}.appendix.costBasis`)} value={appendix.basis.cost_basis} />
        <Field
          label={t(`${K}.appendix.acBasis`)}
          value={t(`${K}.acBasis.${appendix.basis.ac_basis}`, {
            defaultValue: appendix.basis.ac_basis,
          })}
        />
        <Field
          label={t(`${K}.appendix.eacMethod`)}
          value={t(`${K}.method.${appendix.basis.eac_method}`, {
            defaultValue: appendix.basis.eac_method,
          })}
        />
        <Field
          label={t(`${K}.appendix.baseline`)}
          value={appendix.basis.schedule_baseline ?? "—"}
        />
        <Field
          label={t(`${K}.appendix.fx`)}
          value={t(`${K}.appendix.fxLine`, {
            from: appendix.fx.project_currency,
            to: appendix.fx.reporting_currency,
            rate: appendix.fx.rate === null ? "—" : String(appendix.fx.rate),
            source: appendix.fx.source ?? "—",
            asOf: appendix.fx.as_of ?? "—",
          })}
        />
        <Field
          label={t(`${K}.appendix.preparedBy`)}
          value={appendix.approvals.prepared_by ?? "—"}
        />
        <Field
          label={t(`${K}.appendix.submittedBy`)}
          value={appendix.approvals.submitted_by ?? "—"}
        />
        <Field
          label={t(`${K}.appendix.approvedBy`)}
          value={appendix.approvals.approved_by ?? "—"}
        />
        <Field
          label={t(`${K}.appendix.approvedAt`)}
          value={appendix.approvals.approved_at?.slice(0, 10) ?? "—"}
        />
      </div>

      <MeasureRow measures={appendix.measures} currency={currency} />

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`${K}.appendix.gaps`)}
        </h3>
        {appendix.quality_gaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.appendix.noGaps`)}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {appendix.quality_gaps.map((g) => (
              <li key={g.code} className="flex items-center gap-2">
                <StatusBadge
                  status={g.severity === "blocker" ? "blocked" : g.severity}
                  label={t(`${K}.severity.${g.severity}`)}
                />
                <span className="text-foreground">
                  {t(`${K}.exception.${g.code}`, { defaultValue: g.title })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t(`${K}.appendix.reconciliation`)}
        </span>
        <span className="text-sm text-foreground">
          {appendix.reconciliation.ok
            ? t(`${K}.appendix.reconOk`)
            : t(`${K}.appendix.reconOff`, {
                amount: money(appendix.reconciliation.difference, currency),
              })}
        </span>
      </div>
    </Card>
  );
}

export interface PortfolioAppendixData {
  period: string;
  reporting_currency: string;
  totals: PortfolioEvmTotals;
  rows: PortfolioEvmRow[];
  mapping_completeness_pct: number | null;
}

export function PortfolioEvmAppendixCard({ data }: { data: PortfolioAppendixData }) {
  const { t } = useI18n();
  const currency = data.reporting_currency;
  const totals = data.totals;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          {t(`${K}.appendix.portfolioTitle`)}
        </h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.appendix.description`)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t(`${K}.appendix.period`)} value={data.period.slice(0, 7)} />
        <Field label={t(`${K}.appendix.fx`)} value={currency} />
        <Field
          label={t(`${K}.appendix.mappingCompleteness`)}
          value={percent(data.mapping_completeness_pct)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Field label={t(`${K}.kpi.pv`)} value={money(totals.pv, currency)} />
        <Field label={t(`${K}.kpi.ev`)} value={money(totals.ev, currency)} />
        <Field label={t(`${K}.kpi.ac`)} value={money(totals.ac, currency)} />
        <Field label={t(`${K}.kpi.cpi`)} value={ratio(totals.cpi)} />
        <Field label={t(`${K}.kpi.spi`)} value={ratio(totals.spi)} />
        <Field label={t(`${K}.kpi.eac`)} value={money(totals.eac, currency)} />
      </div>

      <Table>
        <caption className="sr-only">{t(`${K}.appendix.portfolioTitle`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.appendix.project`)}</TableHead>
            <TableHead scope="col">{t(`${K}.appendix.status`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ev`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ac`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.cpi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.spi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.eac`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => {
            const m = r.reporting ?? r.project;
            return (
              <TableRow key={r.project_id}>
                <TableCell className="text-foreground">
                  {r.code} {r.name}
                </TableCell>
                <TableCell>
                  <StatusBadge
                    status={r.status === "approved" ? "approved" : "draft"}
                    label={t(`${K}.status.${r.status}`, { defaultValue: r.status })}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(m.ev, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(m.ac, currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(m.cpi)}</TableCell>
                <TableCell className="text-right tabular-nums">{ratio(m.spi)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(m.eac, currency)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
