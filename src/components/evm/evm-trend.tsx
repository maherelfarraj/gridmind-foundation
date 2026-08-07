// GC-12 — Period trend with a chart plus the equivalent data table.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, ratio } from "@/components/evm/evm-format";
import type { TrendAnalysis } from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

export function EvmTrend({ analysis, currency }: { analysis: TrendAnalysis; currency: string }) {
  const { t } = useI18n();
  const points = analysis.points;

  if (points.length === 0) {
    return (
      <EmptyState title={t(`${K}.trend.emptyTitle`)} description={t(`${K}.trend.emptyBody`)} />
    );
  }

  const chartData = points.map((p) => ({
    period: p.period_month.slice(0, 7),
    cpi: p.cpi,
    spi: p.spi,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="h-64 w-full" role="img" aria-label={t(`${K}.trend.chartLabel`)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="period" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <YAxis domain={[0, "auto"]} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.5rem",
                color: "var(--color-popover-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey="cpi"
              stroke="var(--color-primary)"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="spi"
              stroke="var(--color-accent)"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Table>
        <caption className="sr-only">{t(`${K}.trend.caption`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.trend.period`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.cpi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.spi`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ev`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.ac`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.kpi.eac`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.period_month}>
              <TableCell>{p.period_month.slice(0, 7)}</TableCell>
              <TableCell className="text-right tabular-nums">{ratio(p.cpi)}</TableCell>
              <TableCell className="text-right tabular-nums">{ratio(p.spi)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.ev, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.ac, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.eac, currency)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">
        {t(`${K}.trend.deltas`, {
          cpi: ratio(analysis.cpi_delta),
          spi: ratio(analysis.spi_delta),
          eac: money(analysis.eac_delta, currency),
        })}
      </p>
    </div>
  );
}
