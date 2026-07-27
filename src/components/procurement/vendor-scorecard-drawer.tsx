// P-069 — Vendor scorecard detail drawer.
import { useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScorecardStatusBadge } from "@/components/procurement/scorecard-status-badge";
import { getVendorHistory } from "@/lib/scorecard.functions";
import { scorecardErrorMessage, vendorHistoryQueryOptions } from "@/lib/scorecard-query";
import type { ScorecardRow } from "@/lib/scorecard.functions";

interface Props {
  row: ScorecardRow | null;
  periodStart: string;
  periodEnd: string;
  onOpenChange: (open: boolean) => void;
}

export function VendorScorecardDrawer({ row, periodStart, periodEnd, onOpenChange }: Props) {
  const historyFn = useServerFn(getVendorHistory);
  const query = useQuery(
    vendorHistoryQueryOptions(
      historyFn,
      row ? { vendorId: row.vendor_id, periodStart, periodEnd } : null,
    ),
  );

  const chartData = useMemo(() => {
    if (!query.data) return [];
    return query.data.history.map((h) => ({
      period: h.period_start.slice(0, 7),
      OTD: h.on_time_delivery_pct,
      Quality: h.quality_score,
      Responsiveness: h.responsiveness_score,
    }));
  }, [query.data]);

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {row?.vendor_name ?? "Vendor"}
            <ScorecardStatusBadge otd={row?.on_time_delivery_pct} />
          </SheetTitle>
          <SheetDescription>
            Performance history and contributing records for the selected period.
          </SheetDescription>
        </SheetHeader>

        {query.isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <p className="mt-6 text-sm text-destructive">{scorecardErrorMessage(query.error)}</p>
        ) : query.data ? (
          <div className="mt-6 space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-medium">Historical trend</h3>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No prior periods stored yet.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="period" className="text-xs" />
                      <YAxis domain={[0, 100]} className="text-xs" />
                      <RTooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: "0.5rem",
                          fontSize: "0.75rem",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                      <Line type="monotone" dataKey="OTD" stroke="var(--primary)" strokeWidth={2} />
                      <Line
                        type="monotone"
                        dataKey="Quality"
                        stroke="var(--chart-2))"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="Responsiveness"
                        stroke="var(--chart-3))"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">
                Contributing receipts ({query.data.grns.length})
              </h3>
              {query.data.grns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipts in period.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border">
                  {query.data.grns.map((g) => (
                    <li key={g.id} className="flex items-center justify-between p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {g.grn_number}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {g.po_number ?? "—"}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Received {g.received_at ? format(new Date(g.received_at), "PP") : "—"}
                          {" · due "}
                          {g.required_by_date ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {g.defects_count > 0 && (
                          <Badge variant="destructive">
                            {g.defects_count} defect{g.defects_count === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {g.on_time == null ? null : g.on_time ? (
                          <Badge variant="default">On time</Badge>
                        ) : (
                          <Badge variant="secondary">Late</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">
                Purchase orders in period ({query.data.pos.length})
              </h3>
              {query.data.pos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No POs issued in period.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border">
                  {query.data.pos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between p-3 text-sm">
                      <span className="font-medium">{p.po_number}</span>
                      <span className="text-xs text-muted-foreground">
                        due {p.required_by_date ?? "—"} · {p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
