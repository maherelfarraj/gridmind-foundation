// P-237 — Receiving dashboard: open receipts, match exceptions, ETA slippage.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ClipboardCheck, Scale } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { getReceivingDashboard } from "@/lib/receiving.functions";
import type { SlipSeverity } from "@/lib/receiving-dashboard.rules";

export const Route = createFileRoute("/_authenticated/procurement/receiving")({
  head: () => ({
    meta: [
      { title: "Receiving Dashboard — GridMind EPC" },
      {
        name: "description",
        content:
          "Open goods receipts, three-way match exceptions and delivery ETA slippage against site-need dates.",
      },
      { property: "og:title", content: "Receiving Dashboard — GridMind EPC" },
      {
        property: "og:description",
        content: "Track the last mile of procure-to-pay: receipts, match exceptions and ETA slip.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceivingDashboardPage,
  errorComponent: ReceivingError,
});

function ReceivingError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load the receiving dashboard</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}

const SLIP_LABEL: Record<SlipSeverity, string> = {
  late: "Late",
  at_risk: "At risk",
  on_time: "On time",
  unknown: "No dates",
};

function slipVariant(s: SlipSeverity): "destructive" | "secondary" | "outline" {
  if (s === "late") return "destructive";
  if (s === "at_risk") return "secondary";
  return "outline";
}

function ReceivingDashboardPage() {
  const fn = useServerFn(getReceivingDashboard);
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["receiving", "dashboard"],
      queryFn: () => fn(),
      staleTime: 30_000,
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receiving"
        description="The last mile of procure-to-pay — receipts in flight, match exceptions and ETA slippage."
      />

      <KpiGrid>
        <KpiTile label="Open receipts" value={String(data.counts.open_receipts)} icon={ClipboardCheck} />
        <KpiTile label="Match exceptions" value={String(data.counts.match_exceptions)} icon={Scale} />
        <KpiTile label="Unconfirmed ETAs" value={String(data.counts.unconfirmed_etas)} icon={CalendarClock} />
        <KpiTile label="Late lines" value={String(data.counts.late_lines)} icon={AlertTriangle} />
      </KpiGrid>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Open receipts</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/receipts">All receipts</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.open_receipts.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nothing in receiving"
              description="Every goods receipt is confirmed and closed."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.open_receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/procurement/receipts/$grnId"
                        params={{ grnId: r.id }}
                        className="hover:underline"
                      >
                        {r.grn_number}
                      </Link>
                    </TableCell>
                    <TableCell>{r.po_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(r.created_at), "d MMM yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Match exceptions</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/matches">All matches</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.exceptions.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No blocked invoices"
              description="Every vendor invoice matched its PO and goods receipt within tolerance."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Vendor invoice</TableHead>
                  <TableHead className="text-right">Amount variance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.exceptions.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.po_number ?? "—"}</TableCell>
                    <TableCell>
                      <Link
                        to="/procurement/matches/$matchId"
                        params={{ matchId: m.id }}
                        className="hover:underline"
                      >
                        {m.vendor_invoice_number ?? "View match"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.amount_variance == null ? "—" : m.amount_variance.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="destructive">{m.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">ETA slippage vs site need</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/expediting">Expediting</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.slippage.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No open delivery lines"
              description="Import PO lines into expediting to track ETAs against site-need dates."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Site need</TableHead>
                  <TableHead>Current ETA</TableHead>
                  <TableHead className="text-right">Slip (days)</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.slippage.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.po_number ?? "—"}</TableCell>
                    <TableCell className="max-w-[24rem] truncate">{r.item_description}</TableCell>
                    <TableCell>{r.site_need_date ?? "—"}</TableCell>
                    <TableCell>
                      {r.current_eta ?? "—"}
                      {r.current_eta && !r.eta_confirmed ? (
                        <span className="ml-2 text-xs text-muted-foreground">unconfirmed</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.slip_days == null ? "—" : r.slip_days > 0 ? `+${r.slip_days}` : r.slip_days}
                    </TableCell>
                    <TableCell>
                      <Badge variant={slipVariant(r.severity)}>{SLIP_LABEL[r.severity]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
