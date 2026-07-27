// P-213 — Estimate vs actuals comparison card.
import { useQuery } from "@tanstack/react-query";
import { Info, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateComparisonQueryOptions, estimatingErrorMessage } from "@/lib/estimating.query";
import type { ComparisonRow } from "@/lib/estimating/comparison";
import { RATE_TYPE_LABELS, type EstimateRateType } from "@/lib/estimating.rules";
import { formatMoney } from "@/lib/format";

const TONE_VARIANT = {
  neutral: "mutedOutline",
  warning: "warning",
  destructive: "destructive",
} as const;

function VarianceChip({ row }: { row: ComparisonRow }) {
  if (row.variance_pct == null) return <span className="text-muted-foreground">—</span>;
  const sign = row.variance_pct > 0 ? "+" : "";
  return (
    <Badge variant={TONE_VARIANT[row.tone]}>
      {sign}
      {row.variance_pct.toFixed(1)}%
    </Badge>
  );
}

function Money({ value, currency }: { value: number | null; currency: string }) {
  if (value == null) return <span className="text-muted-foreground">n/a</span>;
  return (
    <span className="tabular-nums">
      {formatMoney(value, currency, { maximumFractionDigits: 0 })}
    </span>
  );
}

export function EstimateComparisonCard({
  estimateId,
  status,
  projectId,
}: {
  estimateId: string;
  status: string;
  projectId: string | null;
}) {
  const enabled = (status === "priced" || status === "approved") && !!projectId;
  const query = useQuery({ ...estimateComparisonQueryOptions(estimateId), enabled });

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-primary" aria-hidden />
          Estimate vs actuals
        </CardTitle>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="How these figures are calculated"
              className="text-muted-foreground hover:text-foreground"
            >
              <Info className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {(query.data?.formulas ?? []).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : query.isError || !query.data ? (
          <p className="text-sm text-muted-foreground">{estimatingErrorMessage(query.error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line type</TableHead>
                <TableHead className="text-right">Estimated</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead className="text-right">Actuals</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.rows.map((row) => (
                <TableRow key={row.line_type}>
                  <TableCell>
                    {RATE_TYPE_LABELS[row.line_type as EstimateRateType] ?? row.line_type}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.estimated} currency={query.data.currency_code} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.committed} currency={query.data.currency_code} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.actuals} currency={query.data.currency_code} />
                  </TableCell>
                  <TableCell className="text-right">
                    <VarianceChip row={row} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-border font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">
                  <Money value={query.data.total.estimated} currency={query.data.currency_code} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={query.data.total.committed} currency={query.data.currency_code} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={query.data.total.actuals} currency={query.data.currency_code} />
                </TableCell>
                <TableCell className="text-right">
                  <VarianceChip row={query.data.total} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
