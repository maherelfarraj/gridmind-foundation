// GC-17 — Risk & contingency appendix cards for close and management packs.
import { money } from "@/components/cashflow/cash-format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { RiskContingencyAppendix } from "@/lib/risk-appendix.server";
import type { PortfolioRiskSummary } from "@/lib/risk-contingency.server";

const K = "financeMod.costing.riskContingency";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm text-foreground break-all">{value}</dd>
    </div>
  );
}

export function RiskContingencyAppendixCard({ appendix }: { appendix: RiskContingencyAppendix }) {
  const { t } = useI18n();
  const cur = appendix.reporting_currency;
  const p = appendix.provenance;
  const rec = appendix.contingency.reconciliation;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.title`)}</h2>
        <Badge variant={appendix.basis === "approved" ? "default" : "outline"}>
          {appendix.watermark ?? t(`${K}.appendix.approvedBasis`)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{appendix.disclaimer}</p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t(`${K}.appendix.checksum`)} value={p.input_checksum ?? "—"} />
        <Field
          label={t(`${K}.appendix.engine`)}
          value={p.engine ? `${p.engine} ${p.engine_version ?? ""}`.trim() : "—"}
        />
        <Field label={t(`${K}.appendix.seed`)} value={p.seed !== null ? String(p.seed) : "—"} />
        <Field
          label={t(`${K}.appendix.iterations`)}
          value={p.iterations !== null ? String(p.iterations) : "—"}
        />
        <Field label={t(`${K}.appendix.fxDate`)} value={p.fx_rate_date ?? "—"} />
        <Field label={t(`${K}.appendix.approvedAt`)} value={p.approved_at?.slice(0, 16) ?? "—"} />
        <Field label={t(`${K}.appendix.assumptions`)} value={p.assumptions ?? "—"} />
        <Field label={t(`${K}.appendix.exclusions`)} value={p.exclusions ?? "—"} />
      </dl>

      <Table>
        <caption className="sr-only">{t(`${K}.appendix.rangesCaption`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.ranges.metric`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.p50`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.p80`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.p90`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>{t(`${K}.ranges.cost`)}</TableCell>
            <TableCell className="text-right">
              {appendix.ranges.cost ? money(appendix.ranges.cost.p50, cur) : "—"}
            </TableCell>
            <TableCell className="text-right">
              {appendix.ranges.cost ? money(appendix.ranges.cost.p80, cur) : "—"}
            </TableCell>
            <TableCell className="text-right">
              {appendix.ranges.cost ? money(appendix.ranges.cost.p90, cur) : "—"}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{t(`${K}.ranges.schedule`)}</TableCell>
            <TableCell className="text-right">
              {appendix.ranges.schedule_days ? appendix.ranges.schedule_days.p50.toFixed(1) : "—"}
            </TableCell>
            <TableCell className="text-right">
              {appendix.ranges.schedule_days ? appendix.ranges.schedule_days.p80.toFixed(1) : "—"}
            </TableCell>
            <TableCell className="text-right">
              {appendix.ranges.schedule_days ? appendix.ranges.schedule_days.p90.toFixed(1) : "—"}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t(`${K}.reconciliation.opening`)} value={money(rec.opening, cur)} />
        <Field label={t(`${K}.reconciliation.drawdowns`)} value={money(rec.drawdowns, cur)} />
        <Field label={t(`${K}.reconciliation.closing`)} value={money(rec.closing, cur)} />
        <Field
          label={t(`${K}.appendix.coverP80`)}
          value={
            appendix.adequacy.cover_p80 !== null
              ? `${(appendix.adequacy.cover_p80 * 100).toFixed(0)}%`
              : "—"
          }
        />
      </dl>

      <div>
        <h3 className="mb-1 text-xs font-semibold text-foreground">
          {t(`${K}.appendix.openAlerts`)}
        </h3>
        {appendix.open_alerts.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(`${K}.alerts.empty`)}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {appendix.open_alerts.map((a) => (
              <li key={`${a.family}-${a.title}`} className="flex flex-wrap gap-2">
                <Badge variant="outline">{a.severity}</Badge>
                <span className="text-foreground">{a.title}</span>
                <span className="text-xs text-muted-foreground">{a.due_date ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function PortfolioRiskAppendixCard({ data }: { data: PortfolioRiskSummary }) {
  const { t } = useI18n();
  const cur = data.rows[0]?.reporting_currency ?? "USD";
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-foreground">{t(`${K}.appendix.portfolioTitle`)}</h2>
      <p className="text-xs text-muted-foreground">{RISK_APPENDIX_NOTE}</p>
      <Table>
        <caption className="sr-only">{t(`${K}.appendix.portfolioTitle`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.table.project`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.table.exposure`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.table.available`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.table.shortfall`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.table.alerts`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.project_id}>
              <TableCell>{r.project_name}</TableCell>
              <TableCell className="text-right">{money(r.p80, r.reporting_currency)}</TableCell>
              <TableCell className="text-right">
                {money(r.available, r.reporting_currency)}
              </TableCell>
              <TableCell className="text-right">
                {money(r.shortfall, r.reporting_currency)}
              </TableCell>
              <TableCell className="text-right">{r.open_alerts}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-semibold">{t(`${K}.appendix.total`)}</TableCell>
            <TableCell className="text-right font-semibold">
              {money(data.totals.p80, cur)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {money(data.totals.available, cur)}
            </TableCell>
            <TableCell className="text-right font-semibold">
              {money(data.totals.shortfall, cur)}
            </TableCell>
            <TableCell className="text-right font-semibold">{data.alerts.length}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

const RISK_APPENDIX_NOTE =
  "Derived, non-posting consolidation of approved simulation runs and governed contingency ledgers.";
