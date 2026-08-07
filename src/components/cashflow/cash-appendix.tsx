// GC-13 — Cash-flow & liquidity appendices embedded in the project close pack
// and the portfolio management pack. Read-only evidence: basis, provenance,
// reconciliation, exceptions, approvals and the frozen/scenario watermark.
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
import { money, percent } from "@/components/cashflow/cash-format";
import type { CashflowAppendix } from "@/lib/cashflow.server";
import type { PortfolioCashRow, PortfolioCashTotals } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function CashAppendixCard({ appendix }: { appendix: CashflowAppendix }) {
  const { t } = useI18n();
  const currency = appendix.reporting_currency;
  const frozen = appendix.status === "approved" || appendix.status === "submitted";
  const blockers = appendix.exceptions.filter((e) => e.severity === "blocker");
  const warnings = appendix.exceptions.filter((e) => e.severity === "warning");

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.appendix.description`)}</p>
        </div>
        <StatusBadge
          status={frozen ? "approved" : "draft"}
          label={frozen ? t(`${K}.appendix.watermarkFrozen`) : t(`${K}.appendix.watermarkWorking`)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field
          label={t(`${K}.appendix.project`)}
          value={`${appendix.project_code} ${appendix.project_name}`}
        />
        <Field label={t(`${K}.basis.period`)} value={appendix.period.slice(0, 7)} />
        <Field
          label={t(`${K}.basis.status`)}
          value={
            appendix.status
              ? t(`${K}.status.${appendix.status}`, { defaultValue: appendix.status })
              : "—"
          }
        />
        <Field label={t(`${K}.basis.reportingCurrency`)} value={currency} />
        <Field
          label={t(`${K}.kpi.openingCash`)}
          value={money(appendix.measures.opening_cash, currency)}
        />
        <Field
          label={t(`${K}.kpi.closingCash`)}
          value={money(appendix.measures.closing_cash, currency)}
        />
        <Field
          label={t(`${K}.kpi.peakFunding`)}
          value={money(appendix.measures.peak_funding_need, currency)}
        />
        <Field
          label={t(`${K}.kpi.unfunded`)}
          value={money(appendix.funding.unfunded_requirement, currency)}
        />
        <Field
          label={t(`${K}.kpi.minLiquidity`)}
          value={money(appendix.measures.minimum_liquidity, currency)}
        />
        <Field
          label={t(`${K}.facilities.headroom`)}
          value={money(appendix.funding.headroom, currency)}
        />
        <Field
          label={t(`${K}.facilities.utilization`)}
          value={percent(appendix.funding.utilization_pct)}
        />
        <Field
          label={t(`${K}.basis.fx`)}
          value={
            appendix.fx.length === 0
              ? t(`${K}.basis.fxNone`)
              : appendix.fx
                  .map((f) => `${f.currency_code} ${f.rate ?? "—"} (${f.source ?? "—"})`)
                  .join(", ")
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`${K}.gates.dataTitle`)}
        </h3>
        {appendix.exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${K}.gates.clear`)}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t(`${K}.gates.summary`, { blockers: blockers.length, warnings: warnings.length })}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {appendix.exceptions.map((e) => (
                <li key={`${e.code}-${e.message}`} className="flex items-center gap-2">
                  <StatusBadge
                    status={e.severity === "blocker" ? "blocked" : e.severity}
                    label={t(`${K}.severity.${e.severity}`)}
                  />
                  <span className="text-foreground">{e.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t(`${K}.reconciliation.title`)}
        </span>
        <span className="text-sm text-foreground">
          {appendix.reconciled
            ? t(`${K}.reconciliation.balanced`)
            : t(`${K}.reconciliation.unbalanced`)}
        </span>
      </div>

      {appendix.covenants.length > 0 && (
        <Table>
          <caption className="sr-only">{t(`${K}.covenants.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.covenants.code`)}</TableHead>
              <TableHead scope="col">{t(`${K}.covenants.metric`)}</TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.covenants.threshold`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.covenants.value`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.covenants.state`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appendix.covenants.map((c) => (
              <TableRow key={`${c.facility_id}-${c.code}`}>
                <TableCell className="text-foreground">{c.code}</TableCell>
                <TableCell className="text-foreground">{c.metric}</TableCell>
                <TableCell className="text-end tabular-nums">{c.threshold}</TableCell>
                <TableCell className="text-end tabular-nums">{c.value ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={c.breached ? "blocked" : c.near_breach ? "warning" : "approved"}
                    label={
                      c.breached
                        ? t(`${K}.covenants.breached`)
                        : c.near_breach
                          ? t(`${K}.covenants.near`)
                          : t(`${K}.covenants.ok`)
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export interface PortfolioCashAppendixData {
  period: string;
  reporting_currency: string;
  totals: PortfolioCashTotals;
  rows: PortfolioCashRow[];
}

export function PortfolioCashAppendixCard({ data }: { data: PortfolioCashAppendixData }) {
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

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field label={t(`${K}.basis.period`)} value={data.period.slice(0, 7)} />
        <Field label={t(`${K}.basis.reportingCurrency`)} value={currency} />
        <Field
          label={t(`${K}.kpi.peakFunding`)}
          value={money(totals.peak_funding_need, currency)}
        />
        <Field
          label={t(`${K}.kpi.unfunded`)}
          value={money(totals.unfunded_requirement, currency)}
        />
        <Field label={t(`${K}.facilities.headroom`)} value={money(totals.headroom, currency)} />
      </div>

      <Table>
        <caption className="sr-only">{t(`${K}.appendix.portfolioTitle`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.appendix.project`)}</TableHead>
            <TableHead scope="col">{t(`${K}.basis.status`)}</TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.closingCash`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.peakFunding`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.unfunded`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.project_id}>
              <TableCell className="text-foreground">
                {r.project_code} {r.project_name}
              </TableCell>
              <TableCell>
                <StatusBadge
                  status={r.status === "approved" ? "approved" : "draft"}
                  label={
                    r.status ? t(`${K}.status.${r.status}`, { defaultValue: r.status }) : "—"
                  }
                />
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {r.fx_missing ? "—" : money(r.measures.closing_cash, currency)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {r.fx_missing ? "—" : money(r.measures.peak_funding_need, currency)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {r.fx_missing ? "—" : money(r.funding.unfunded_requirement, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
