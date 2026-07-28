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
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";
import { MoneyCell, Num } from "@/components/ui/num";
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
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">{t("procurementMod.receiving.loadError")}</h2>
      <p className="text-sm text-muted-foreground">
        {translateError(t, errorCodeOf(error), error.message)}
      </p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
    </div>
  );
}

function slipVariant(s: SlipSeverity): "destructive" | "secondary" | "outline" {
  if (s === "late") return "destructive";
  if (s === "at_risk") return "secondary";
  return "outline";
}

function slipLabelKey(s: SlipSeverity): string {
  return {
    late: "procurementMod.receiving.slipLate",
    at_risk: "procurementMod.receiving.slipAtRisk",
    on_time: "procurementMod.receiving.slipOnTime",
    unknown: "procurementMod.receiving.slipUnknown",
  }[s];
}

function ReceivingDashboardPage() {
  const { t } = useI18n();
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
        title={t("procurementMod.receiving.title")}
        description={t("procurementMod.receiving.subtitle")}
      />

      <KpiGrid>
        <KpiTile label={t("procurementMod.receiving.openReceipts")} value={String(data.counts.open_receipts)} icon={ClipboardCheck} />
        <KpiTile label={t("procurementMod.receiving.matchExceptions")} value={String(data.counts.match_exceptions)} icon={Scale} />
        <KpiTile label={t("procurementMod.receiving.unconfirmedEtas")} value={String(data.counts.unconfirmed_etas)} icon={CalendarClock} />
        <KpiTile label={t("procurementMod.receiving.lateLines")} value={String(data.counts.late_lines)} icon={AlertTriangle} />
      </KpiGrid>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("procurementMod.receiving.openReceipts")}</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/receipts">{t("procurementMod.receiving.allReceipts")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.open_receipts.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={t("procurementMod.receiving.nothingInReceiving")}
              description={t("procurementMod.receiving.everyGrnClosed")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("procurementMod.receiving.colGrn")}</TableHead>
                  <TableHead>{t("procurementMod.common.po")}</TableHead>
                  <TableHead>{t("procurementMod.common.status")}</TableHead>
                  <TableHead>{t("procurementMod.receiving.colStarted")}</TableHead>
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
          <CardTitle className="text-base">{t("procurementMod.receiving.matchExceptions")}</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/matches">{t("procurementMod.receiving.allMatches")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.exceptions.length === 0 ? (
            <EmptyState
              icon={Scale}
              title={t("procurementMod.receiving.noBlockedInvoices")}
              description={t("procurementMod.receiving.everyInvoiceMatched")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("procurementMod.common.po")}</TableHead>
                  <TableHead>{t("procurementMod.receiving.colVendorInvoice")}</TableHead>
                  <TableHead className="text-end">{t("procurementMod.receiving.colAmountVariance")}</TableHead>
                  <TableHead>{t("procurementMod.common.status")}</TableHead>
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
                    <TableCell className="text-end">
                      <MoneyCell>{m.amount_variance == null ? "—" : m.amount_variance.toFixed(2)}</MoneyCell>
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
          <CardTitle className="text-base">{t("procurementMod.receiving.etaSlippage")}</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/procurement/expediting">{t("procurementMod.receiving.expediting")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.slippage.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("procurementMod.receiving.noOpenDeliveryLines")}
              description={t("procurementMod.receiving.importToExpediteHint")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("procurementMod.common.po")}</TableHead>
                  <TableHead>{t("procurementMod.common.description")}</TableHead>
                  <TableHead>{t("procurementMod.receiving.colSiteNeed")}</TableHead>
                  <TableHead>{t("procurementMod.receiving.colCurrentEta")}</TableHead>
                  <TableHead className="text-end">{t("procurementMod.receiving.colSlipDays")}</TableHead>
                  <TableHead>{t("procurementMod.receiving.colState")}</TableHead>
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
                        <span className="ms-2 text-xs text-muted-foreground">
                          {t("procurementMod.receiving.unconfirmed")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-end">
                      <Num>{r.slip_days == null ? "—" : r.slip_days > 0 ? `+${r.slip_days}` : r.slip_days}</Num>
                    </TableCell>
                    <TableCell>
                      <Badge variant={slipVariant(r.severity)}>{t(slipLabelKey(r.severity))}</Badge>
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
