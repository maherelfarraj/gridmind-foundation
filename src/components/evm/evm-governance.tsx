// GC-12 — Reporting basis, snapshot lifecycle and official EAC selection.
import { useState } from "react";
import { FileCheck2, History, RotateCcw, Send, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formulaRows, money } from "@/components/evm/evm-format";
import {
  EAC_METHODS,
  type EacMethod,
  type EvmMeasures,
  type ReportStatus,
} from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

export interface BasisFields {
  period_month: string;
  data_date: string;
  cost_basis: string;
  ac_basis: string;
  eac_method: EacMethod;
  schedule_baseline_id: string | null;
  project_currency: string;
  reporting_currency: string;
  fx: {
    rate: number | null;
    as_of: string | null;
    source: string | null;
    stale: boolean;
    missing: boolean;
  };
  status: ReportStatus | "working";
  version_no: number | null;
  frozen: boolean;
  period_state: string;
}

export function EvmBasisCard({ basis }: { basis: BasisFields }) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-wrap gap-6 p-4 text-sm">
      <Field label={t(`${K}.basis.period`)} value={basis.period_month.slice(0, 7)} />
      <Field label={t(`${K}.basis.dataDate`)} value={basis.data_date} />
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t(`${K}.basis.status`)}
        </span>
        <StatusBadge status={basis.status} label={t(`${K}.status.${basis.status}`)} />
      </div>
      <Field
        label={t(`${K}.basis.version`)}
        value={basis.version_no === null ? "—" : `v${basis.version_no}`}
      />
      <Field label={t(`${K}.basis.costBasis`)} value={basis.cost_basis} />
      <Field label={t(`${K}.basis.acBasis`)} value={t(`${K}.acBasis.${basis.ac_basis}`)} />
      <Field label={t(`${K}.basis.eacMethod`)} value={t(`${K}.method.${basis.eac_method}`)} />
      <Field
        label={t(`${K}.basis.baseline`)}
        value={basis.schedule_baseline_id ? basis.schedule_baseline_id.slice(0, 8) : "—"}
      />
      <Field
        label={t(`${K}.basis.currency`)}
        value={`${basis.project_currency} → ${basis.reporting_currency}`}
      />
      <Field
        label={t(`${K}.basis.fx`)}
        value={
          basis.fx.missing
            ? t(`${K}.basis.fxMissing`)
            : `${basis.fx.rate ?? "—"} · ${basis.fx.as_of ?? "—"} · ${basis.fx.source ?? "—"}${
                basis.fx.stale ? ` · ${t(`${K}.basis.fxStale`)}` : ""
              }`
        }
      />
      <Field
        label={t(`${K}.basis.source`)}
        value={basis.frozen ? t(`${K}.basis.frozen`) : t(`${K}.basis.live`)}
      />
      <Field
        label={t(`${K}.basis.periodState`)}
        value={t(`financeMod.costing.close.state.${basis.period_state}`, {
          defaultValue: basis.period_state,
        })}
      />
    </Card>
  );
}

export function EvmLifecycleCard({
  status,
  canWrite,
  blockers,
  busy,
  onSubmit,
  onApprove,
  onReturn,
  onSupersede,
}: {
  status: ReportStatus | null;
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
  const reasonValid = reason.trim().length >= 8;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="size-4" aria-hidden="true" /> {t(`${K}.lifecycle.title`)}
      </h2>
      <p className="text-xs text-muted-foreground">{t(`${K}.lifecycle.description`)}</p>

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.lifecycle.readOnly`)}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onSubmit}
              disabled={busy || status !== "working" || blockers > 0}
            >
              <Send className="size-4" /> {t(`${K}.lifecycle.submit`)}
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy || status !== "submitted"}>
              <FileCheck2 className="size-4" /> {t(`${K}.lifecycle.approve`)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReturn(reason)}
              disabled={busy || status !== "submitted" || !reasonValid}
            >
              <RotateCcw className="size-4" /> {t(`${K}.lifecycle.return`)}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSupersede(reason)}
              disabled={busy || status !== "approved" || !reasonValid}
            >
              <History className="size-4" /> {t(`${K}.lifecycle.supersede`)}
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="evm-reason">{t(`${K}.lifecycle.reason`)}</Label>
            <Textarea
              id="evm-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(`${K}.lifecycle.reasonPlaceholder`)}
            />
            <p className="text-xs text-muted-foreground">{t(`${K}.lifecycle.reasonHint`)}</p>
          </div>
          {blockers > 0 ? (
            <p className="text-xs text-destructive">
              {t(`${K}.lifecycle.blocked`, { count: blockers })}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function EvmFormulaCard({
  measures,
  currency,
  official,
  canWrite,
  busy,
  onChangeOfficial,
}: {
  measures: EvmMeasures;
  currency: string;
  official: EacMethod;
  canWrite: boolean;
  busy: boolean;
  onChangeOfficial: (method: EacMethod) => void;
}) {
  const { t } = useI18n();
  const rows = formulaRows(measures);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-foreground">{t(`${K}.formula.title`)}</h2>
      <p className="text-xs text-muted-foreground">{t(`${K}.formula.description`)}</p>

      <Table>
        <caption className="sr-only">{t(`${K}.formula.title`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.formula.method`)}</TableHead>
            <TableHead scope="col">{t(`${K}.formula.expression`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.eac`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} aria-current={official === methodOf(r.key) ? "true" : undefined}>
              <TableCell className="text-foreground">
                {t(`${K}.method.${methodOf(r.key)}`)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {t(`${K}.formulaExpr.${methodOf(r.key)}`)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(r.value, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-1">
        <Label htmlFor="evm-official-eac">{t(`${K}.formula.official`)}</Label>
        <Select
          value={official}
          onValueChange={(v) => onChangeOfficial(v as EacMethod)}
          disabled={!canWrite || busy}
        >
          <SelectTrigger id="evm-official-eac" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EAC_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`${K}.method.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t(`${K}.formula.officialHint`)}</p>
      </div>
    </Card>
  );
}

function methodOf(key: string): EacMethod {
  switch (key) {
    case "eac_cpi":
      return "cpi";
    case "eac_cpi_spi":
      return "cpi_spi";
    case "eac_ac_plus_remaining":
      return "ac_plus_remaining";
    default:
      return "bottom_up";
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
