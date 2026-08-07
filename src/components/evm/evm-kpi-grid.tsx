// GC-12 — EVM headline measures. Every tile carries an accessible label.
import { Activity, Banknote, Clock, Gauge, LineChart, Target } from "lucide-react";

import { KpiTile } from "@/components/ui/kpi-tile";
import { indexTone, days as fmtDays, money, ratio, varianceTone } from "@/components/evm/evm-format";
import type { EvmMeasures } from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

export function EvmKpiGrid({
  measures,
  currency,
  delayDays,
  cpiThreshold,
  spiThreshold,
}: {
  measures: EvmMeasures;
  currency: string;
  delayDays: number | null;
  cpiThreshold: number;
  spiThreshold: number;
}) {
  const { t } = useI18n();
  const m = measures;

  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      role="group"
      aria-label={t(`${K}.kpi.groupLabel`)}
    >
      <KpiTile label={t(`${K}.kpi.pv`)} value={money(m.pv, currency)} icon={LineChart} hint={t(`${K}.kpi.pvHint`)} />
      <KpiTile label={t(`${K}.kpi.ev`)} value={money(m.ev, currency)} icon={Activity} hint={t(`${K}.kpi.evHint`)} />
      <KpiTile label={t(`${K}.kpi.ac`)} value={money(m.ac, currency)} icon={Banknote} hint={t(`${K}.kpi.acHint`)} />
      <KpiTile label={t(`${K}.kpi.bac`)} value={money(m.bac, currency)} icon={Target} hint={t(`${K}.kpi.bacHint`)} />
      <KpiTile
        label={t(`${K}.kpi.cpi`)}
        value={ratio(m.cpi)}
        icon={Gauge}
        status={indexTone(m.cpi, cpiThreshold)}
        hint={t(`${K}.kpi.cpiHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.spi`)}
        value={ratio(m.spi)}
        icon={Gauge}
        status={indexTone(m.spi, spiThreshold)}
        hint={t(`${K}.kpi.spiHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.cv`)}
        value={money(m.cv, currency)}
        status={varianceTone(m.cv)}
        hint={t(`${K}.kpi.cvHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.sv`)}
        value={money(m.sv, currency)}
        status={varianceTone(m.sv)}
        hint={t(`${K}.kpi.svHint`)}
      />
      <KpiTile label={t(`${K}.kpi.eac`)} value={money(m.eac, currency)} hint={t(`${K}.method.${m.eac_method}`)} />
      <KpiTile label={t(`${K}.kpi.etc`)} value={money(m.etc, currency)} hint={t(`${K}.kpi.etcHint`)} />
      <KpiTile
        label={t(`${K}.kpi.vac`)}
        value={money(m.vac, currency)}
        status={varianceTone(m.vac)}
        hint={t(`${K}.kpi.vacHint`)}
      />
      <KpiTile
        label={t(`${K}.kpi.tcpi`)}
        value={ratio(m.tcpi_eac)}
        hint={t(`${K}.kpi.tcpiHint`, { bac: ratio(m.tcpi_bac) })}
      />
      <KpiTile
        label={t(`${K}.kpi.delay`)}
        value={fmtDays(delayDays)}
        icon={Clock}
        status={delayDays !== null && delayDays > 0 ? "warning" : "neutral"}
        hint={t(`${K}.kpi.delayHint`)}
      />
    </div>
  );
}
