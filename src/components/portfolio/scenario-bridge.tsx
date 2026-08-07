// GC-11 — Scenario EAC bridge + comparison tables (presentation only).
// Every figure arrives pre-computed in the reporting currency; this component
// never converts, sums across currencies or re-derives a measure.
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import type {
  BridgeStep,
  ComparisonLine,
  ScenarioProjectResult,
} from "@/lib/portfolio-scenarios.rules";

const K = "portfolioMod.costing.scenarios";

export function ScenarioBridge({ bridge, currency }: { bridge: BridgeStep[]; currency: string }) {
  const { t, locale } = useI18n();
  const money = (v: number) => formatCurrency(v, locale, currency);
  const label = (driver: BridgeStep["driver"]) =>
    driver === "base"
      ? t(`${K}.base`)
      : driver === "scenario"
        ? t(`${K}.scenario`)
        : t(`${K}.drivers.${driver}`);

  return (
    <Table>
      <caption className="sr-only">{t(`${K}.bridgeDescription`)}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.driver`)}</TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.deltaEac`)}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.scenarioEac`)}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bridge.map((step, i) => (
          <TableRow key={`${step.driver}-${i}`}>
            <TableCell className="font-medium">{label(step.driver)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {step.driver === "base" || step.driver === "scenario" ? "—" : money(step.amount)}
            </TableCell>
            <TableCell className="text-end tabular-nums">{money(step.cumulative)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScenarioProjectTable({
  results,
  currency,
}: {
  results: ScenarioProjectResult[];
  currency: string;
}) {
  const { t, locale } = useI18n();
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatCurrency(v, locale, currency);

  return (
    <Table>
      <caption className="sr-only">{t(`${K}.comparisonDescription`)}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.project`)}</TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.baseEac`)}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.scenarioEac`)}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.deltaEac`)}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.p80`)}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.project_id}>
            <TableCell>
              <span className="font-medium">{r.code}</span>
              <div className="text-muted-foreground text-xs">{r.name}</div>
              {r.excluded_reason ? (
                <div className="text-destructive text-xs">{t(`${K}.excluded`)}</div>
              ) : null}
            </TableCell>
            <TableCell className="text-end tabular-nums">{money(r.base_reporting?.eac)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {money(r.scenario_reporting?.eac)}
            </TableCell>
            <TableCell className="text-end tabular-nums">{money(r.delta_eac_reporting)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {r.scenario_reporting
                ? money(r.scenario_reporting.eac + 0.8416 * r.band.sigma * (r.rate.rate ?? 1))
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScenarioComparisonTable({
  lines,
  currency,
  leftName,
  rightName,
}: {
  lines: ComparisonLine[];
  currency: string;
  leftName: string;
  rightName: string;
}) {
  const { t, locale } = useI18n();
  const money = (v: number | null) => (v === null ? "—" : formatCurrency(v, locale, currency));
  return (
    <Table>
      <caption className="sr-only">{t(`${K}.comparisonDescription`)}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t(`${K}.project`)}</TableHead>
          <TableHead scope="col" className="text-end">
            {leftName}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {rightName}
          </TableHead>
          <TableHead scope="col" className="text-end">
            {t(`${K}.deltaEac`)}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.project_id}>
            <TableCell>
              <span className="font-medium">{l.code}</span>
              <div className="text-muted-foreground text-xs">{l.name}</div>
            </TableCell>
            <TableCell className="text-end tabular-nums">{money(l.left)}</TableCell>
            <TableCell className="text-end tabular-nums">{money(l.right)}</TableCell>
            <TableCell className="text-end tabular-nums">{money(l.delta)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
