// GC-13 — Time-phased cash buckets: chart plus the equivalent accessible table.
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
import { bucketLabel, money } from "@/components/cashflow/cash-format";
import type { BucketGranularity, CashBucket } from "@/lib/cashflow.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export function CashBucketChart({
  buckets,
  currency,
  granularity,
}: {
  buckets: CashBucket[];
  currency: string;
  granularity: BucketGranularity;
}) {
  const { t } = useI18n();
  if (buckets.length === 0) {
    return (
      <EmptyState title={t(`${K}.buckets.emptyTitle`)} description={t(`${K}.buckets.emptyBody`)} />
    );
  }

  const data = buckets.map((b) => ({
    bucket: bucketLabel(b.start, granularity),
    inflow: b.inflow,
    outflow: -b.outflow,
    closing: b.closing_cash,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" width={80} />
            <Tooltip
              formatter={(value: number | string) => money(Number(value), currency)}
              contentStyle={{
                background: "var(--color-popover)",
                borderColor: "var(--color-border)",
                color: "var(--color-popover-foreground)",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="inflow" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
            <Bar dataKey="outflow" fill="var(--color-destructive)" radius={[0, 0, 2, 2]} />
            <Line
              type="monotone"
              dataKey="closing"
              stroke="var(--color-primary)"
              dot={false}
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Table>
        <caption className="sr-only">{t(`${K}.buckets.caption`)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t(`${K}.buckets.bucket`)}</TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.inflow`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.outflow`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.net`)}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t(`${K}.buckets.closing`)}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buckets.map((b) => (
            <TableRow key={b.start}>
              <TableCell className="font-medium">{bucketLabel(b.start, granularity)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(b.inflow, currency)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {money(b.outflow, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(b.net, currency)}</TableCell>
              <TableCell
                className={
                  b.closing_cash < 0
                    ? "text-right tabular-nums text-destructive"
                    : "text-right tabular-nums"
                }
              >
                {money(b.closing_cash, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
