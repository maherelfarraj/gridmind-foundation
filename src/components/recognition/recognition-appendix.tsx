// GC-15 — Recognition appendices embedded in the project close pack and the
// portfolio management pack. Read-only evidence: policy/basis/provenance,
// obligations and allocation, movements, reconciliation, adjustments,
// approvals, FX, exceptions and the frozen / non-posting watermark.
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
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RecognitionAppendix } from "@/lib/recognition.server";
import type { PortfolioRecognitionView } from "@/lib/recognition.server";

const K = "financeMod.costing.recognition";

function money(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function RecognitionAppendixCard({ appendix }: { appendix: RecognitionAppendix }) {
  const { t } = useI18n();
  const currency = appendix.reporting_currency;
  const totals = appendix.totals;
  const fx = appendix.fx_provenance as Record<string, unknown>;
  const critical = appendix.exceptions.filter((e) => e.severity === "critical");
  const failed = appendix.reconciliation.filter((r) => !r.ok);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.title`)}</h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.appendix.description`)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={appendix.basis === "approved" ? "approved" : "draft"}
            label={t(`${K}.appendix.basis.${appendix.basis}`)}
          />
          <StatusBadge
            status={appendix.frozen ? "approved" : "draft"}
            label={
              appendix.frozen
                ? t(`${K}.appendix.watermarkFrozen`)
                : t(`${K}.appendix.watermarkWorking`)
            }
          />
          {appendix.watermark ? (
            <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {appendix.watermark}
            </span>
          ) : null}
        </div>
      </div>

      <p className="rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        {appendix.disclaimer}
      </p>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label={t(`${K}.appendix.project`)} value={appendix.project_name ?? "—"} />
        <Field
          label={t(`${K}.basis.period`)}
          value={appendix.period_month ? appendix.period_month.slice(0, 7) : "—"}
        />
        <Field label={t(`${K}.basis.dataDate`)} value={appendix.data_date ?? "—"} />
        <Field label={t(`${K}.appendix.billingCutoff`)} value={appendix.billing_cutoff ?? "—"} />
        <Field
          label={t(`${K}.appendix.method`)}
          value={
            appendix.policy.method
              ? t(`${K}.method.${appendix.policy.method}`, {
                  defaultValue: appendix.policy.method,
                })
              : "—"
          }
        />
        <Field
          label={t(`${K}.appendix.policyVersion`)}
          value={appendix.policy.policy_version ?? "—"}
        />
        <Field
          label={t(`${K}.appendix.version`)}
          value={appendix.version_no != null ? `v${appendix.version_no}` : "—"}
        />
        <Field label={t(`${K}.appendix.currency`)} value={currency} />
        <Field
          label={t(`${K}.kpi.cumulativeRevenue`)}
          value={money(totals?.cumulative_revenue, currency)}
        />
        <Field
          label={t(`${K}.appendix.periodRevenue`)}
          value={money(totals?.period_revenue, currency)}
        />
        <Field label={t(`${K}.kpi.margin`)} value={pct(totals?.margin_pct)} />
        <Field label={t(`${K}.kpi.billed`)} value={money(totals?.billed_to_date, currency)} />
        <Field
          label={t(`${K}.kpi.contractAsset`)}
          value={money(totals?.contract_asset, currency)}
        />
        <Field
          label={t(`${K}.kpi.contractLiability`)}
          value={money(totals?.contract_liability, currency)}
        />
        <Field
          label={t(`${K}.kpi.lossProvision`)}
          value={money(totals?.loss_provision, currency)}
        />
        <Field
          label={t(`${K}.appendix.fxSource`)}
          value={String(fx["source"] ?? fx["provider"] ?? "—")}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(`${K}.obligations.title`)}
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.obligations.code`)}</TableHead>
              <TableHead scope="col">{t(`${K}.obligations.method`)}</TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.progress`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.revenue`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.billed`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.wip`)}
              </TableHead>
              <TableHead scope="col" className="text-end">
                {t(`${K}.obligations.deferred`)}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appendix.obligations.map((o) => (
              <TableRow key={o.code}>
                <TableCell>{o.label}</TableCell>
                <TableCell>{t(`${K}.method.${o.method}`, { defaultValue: o.method })}</TableCell>
                <TableCell className="text-end tabular-nums">{pct(o.progress_pct)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(o.cumulative_revenue, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(o.billed_to_date, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(o.contract_asset, currency)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {money(o.contract_liability, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`${K}.reconciliation.title`)}
          </h3>
          {failed.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(`${K}.reconciliation.ok`)}</p>
          ) : (
            <ul className="list-disc ps-4 text-xs text-destructive">
              {failed.map((r) => (
                <li key={r.code}>
                  {t(`${K}.reconciliation.${r.code}`, { defaultValue: r.check })}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`${K}.exceptions.title`)}
          </h3>
          {appendix.exceptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(`${K}.exceptions.none`)}</p>
          ) : (
            <ul className="list-disc ps-4 text-xs text-muted-foreground">
              {appendix.exceptions.map((e) => (
                <li key={e.code} className={critical.includes(e) ? "text-destructive" : undefined}>
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`${K}.appendix.adjustments`)}
          </h3>
          {appendix.adjustments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(`${K}.appendix.noAdjustments`)}</p>
          ) : (
            <ul className="list-disc ps-4 text-xs text-muted-foreground">
              {appendix.adjustments.map((a, i) => (
                <li key={`${a.kind}-${i}`}>
                  {a.kind} · {money(a.amount, currency)} · {a.status} — {a.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="grid gap-2 sm:grid-cols-3">
          <Field
            label={t(`${K}.appendix.preparedAt`)}
            value={appendix.approvals.prepared_at?.slice(0, 10) ?? "—"}
          />
          <Field
            label={t(`${K}.appendix.submittedAt`)}
            value={appendix.approvals.submitted_at?.slice(0, 10) ?? "—"}
          />
          <Field
            label={t(`${K}.appendix.approvedAt`)}
            value={appendix.approvals.approved_at?.slice(0, 10) ?? "—"}
          />
        </section>
      </div>
    </Card>
  );
}

export function PortfolioRecognitionAppendixCard({ data }: { data: PortfolioRecognitionView }) {
  const { t } = useI18n();
  const currency = data.reporting_currency;
  const totals = data.rollup.totals;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t(`${K}.appendix.portfolioTitle`)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(`${K}.appendix.portfolioDescription`)}
          </p>
        </div>
        <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {t(`${K}.appendix.nonPosting`)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field
          label={t(`${K}.kpi.cumulativeRevenue`)}
          value={money(totals.cumulative_revenue, currency)}
        />
        <Field
          label={t(`${K}.appendix.periodRevenue`)}
          value={money(totals.period_revenue, currency)}
        />
        <Field label={t(`${K}.kpi.margin`)} value={pct(totals.margin_pct)} />
        <Field label={t(`${K}.kpi.contractAsset`)} value={money(totals.contract_asset, currency)} />
        <Field
          label={t(`${K}.kpi.contractLiability`)}
          value={money(totals.contract_liability, currency)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.appendix.project`)}</TableHead>
            <TableHead scope="col">{t(`${K}.appendix.method`)}</TableHead>
            <TableHead scope="col">{t(`${K}.basis.period`)}</TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.obligations.revenue`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.margin`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.contractAsset`)}
            </TableHead>
            <TableHead scope="col" className="text-end">
              {t(`${K}.kpi.contractLiability`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.project_id}>
              <TableCell>{r.project_name}</TableCell>
              <TableCell>{t(`${K}.method.${r.method}`, { defaultValue: r.method })}</TableCell>
              <TableCell>{r.period_month.slice(0, 7)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {money(r.totals.cumulative_revenue, currency)}
              </TableCell>
              <TableCell className="text-end tabular-nums">{pct(r.totals.margin_pct)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {money(r.totals.contract_asset, currency)}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {money(r.totals.contract_liability, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
