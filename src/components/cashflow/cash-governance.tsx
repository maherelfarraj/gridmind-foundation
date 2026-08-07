// GC-13 — Cash-flow basis, provenance and snapshot lifecycle governance.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, percent } from "@/components/cashflow/cash-format";
import type { CashflowStatus } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export interface CashBasis {
  period_month: string;
  data_date: string;
  granularity: "month" | "week";
  horizon_buckets: number;
  project_currency: string;
  reporting_currency: string;
  status: CashflowStatus | "working";
  version_no: number | null;
  frozen: boolean;
  period_state: string;
  forecast_version_id: string | null;
  fx: { currency_code: string; rate: number; as_of: string; source: string }[];
  fx_missing: string[];
  opening_cash: number;
  min_liquidity: number;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function CashBasisCard({ basis }: { basis: CashBasis }) {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.basis.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.basis.description`)}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Row label={t(`${K}.basis.period`)} value={basis.period_month.slice(0, 7)} />
        <Row label={t(`${K}.basis.dataDate`)} value={basis.data_date.slice(0, 10)} />
        <Row
          label={t(`${K}.basis.granularity`)}
          value={t(`${K}.granularity.${basis.granularity}`)}
        />
        <Row label={t(`${K}.basis.horizon`)} value={String(basis.horizon_buckets)} />
        <Row label={t(`${K}.basis.status`)} value={t(`${K}.status.${basis.status}`)} />
        <Row
          label={t(`${K}.basis.version`)}
          value={basis.version_no === null ? "—" : String(basis.version_no)}
        />
        <Row label={t(`${K}.basis.periodState`)} value={basis.period_state} />
        <Row label={t(`${K}.basis.projectCurrency`)} value={basis.project_currency} />
        <Row label={t(`${K}.basis.reportingCurrency`)} value={basis.reporting_currency} />
        <Row
          label={t(`${K}.basis.openingCash`)}
          value={money(basis.opening_cash, basis.reporting_currency)}
        />
        <Row
          label={t(`${K}.basis.minLiquidity`)}
          value={money(basis.min_liquidity, basis.reporting_currency)}
        />
        <Row
          label={t(`${K}.basis.forecastVersion`)}
          value={basis.forecast_version_id ? basis.forecast_version_id.slice(0, 8) : "—"}
        />
      </dl>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground">{t(`${K}.basis.fx`)}</span>
        {basis.fx.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t(`${K}.basis.fxNone`)}</span>
        ) : (
          <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {basis.fx.map((f) => (
              <li key={`${f.currency_code}-${f.as_of}`} className="tabular-nums">
                {f.currency_code} → {basis.reporting_currency} {f.rate.toFixed(6)} ({f.source}{" "}
                {f.as_of.slice(0, 10)})
              </li>
            ))}
          </ul>
        )}
        {basis.fx_missing.length > 0 ? (
          <span className="text-xs text-destructive">
            {t(`${K}.basis.fxMissing`, { currencies: basis.fx_missing.join(", ") })}
          </span>
        ) : null}
      </div>

      {basis.frozen ? (
        <p className="text-xs text-muted-foreground">{t(`${K}.basis.frozenNote`)}</p>
      ) : null}
    </Card>
  );
}

export function CashLifecycleCard({
  status,
  canWrite,
  blockers,
  busy,
  onSubmit,
  onApprove,
  onReturn,
  onSupersede,
}: {
  status: CashflowStatus | null;
  canWrite: boolean;
  blockers: number;
  busy: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onReturn: (reason: string) => void;
  onSupersede: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const disabled = busy || !canWrite || status === null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.lifecycle.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.lifecycle.description`)}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="cash-lifecycle-reason" className="text-xs">
          {t(`${K}.lifecycle.reason`)}
        </Label>
        <Textarea
          id="cash-lifecycle-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t(`${K}.lifecycle.reasonPlaceholder`)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || status !== "working" || blockers > 0}
          onClick={onSubmit}
        >
          {t(`${K}.lifecycle.submit`)}
        </Button>
        <Button
          size="sm"
          disabled={disabled || status !== "submitted" || blockers > 0}
          onClick={onApprove}
        >
          {t(`${K}.lifecycle.approve`)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || status !== "submitted" || reason.trim().length === 0}
          onClick={() => onReturn(reason.trim())}
        >
          {t(`${K}.lifecycle.return`)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || status !== "approved" || reason.trim().length === 0}
          onClick={() => onSupersede(reason.trim())}
        >
          {t(`${K}.lifecycle.supersede`)}
        </Button>
      </div>

      {blockers > 0 ? (
        <p className="text-xs text-destructive">
          {t(`${K}.lifecycle.blocked`, { blockers, pct: percent(null) })
            .replace(" —", "")
            .trim()}
        </p>
      ) : null}
    </Card>
  );
}
