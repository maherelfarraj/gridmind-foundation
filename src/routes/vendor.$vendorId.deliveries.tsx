// P-224 — Vendor delivery scheduling: propose delivery windows per PO line.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarClock, ChevronDown, Lock, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Num } from "@/components/ui/num";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import {
  ConfirmationChip,
  ProposeDeliveryDialog,
} from "@/components/vendor-portal/propose-delivery-dialog";
import { useProposeDelivery, useVendorLineEtas } from "@/lib/vendor-portal-propose";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  isVendorProposedNote,
  parsePoLines,
  vendorPortalErrorCode,
} from "@/lib/vendor-portal.rules";
import {
  getVendorPortalPos,
  listMyVendorMemberships,
  type VendorLineEtaRow,
  type VendorPoRow,
} from "@/lib/vendor-portal.functions";

export const Route = createFileRoute("/vendor/$vendorId/deliveries")({
  head: () => ({
    meta: [
      { title: "Delivery scheduling — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Propose delivery dates per purchase order line and track procurement's ETA confirmations.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorDeliveries,
});

function VendorDeliveries() {
  const { t } = useI18n();
  const { vendorId } = Route.useParams();
  const posFn = useServerFn(getVendorPortalPos);
  const membershipsFn = useServerFn(listMyVendorMemberships);

  const memberships = useQuery({
    queryKey: ["vendor-portal", "memberships"],
    queryFn: () => membershipsFn(),
  });
  const membership = (memberships.data ?? []).find((m) => m.vendor_id === vendorId);

  const pos = useQuery({
    queryKey: ["vendor-portal", "pos", vendorId],
    queryFn: () => posFn({ data: { vendorId } }),
    retry: false,
  });
  const { etaByKey } = useVendorLineEtas(vendorId);

  const [dialogPo, setDialogPo] = useState<VendorPoRow | null>(null);
  const propose = useProposeDelivery(vendorId, () => setDialogPo(null));

  if (memberships.isLoading || pos.isLoading) return <VendorTableSkeleton rows={5} />;
  if (pos.error) {
    const code = vendorPortalErrorCode(pos.error);
    return code === "vendor_portal_access_denied" ? (
      <VendorStateCard
        icon={Lock}
        title={t("portalMod.deliveries.accessExpiredTitle")}
        description={t("portalMod.deliveries.accessExpiredDesc")}
      />
    ) : code?.endsWith("_not_exposed") ? (
      <VendorStateCard
        icon={Lock}
        title={t("portalMod.deliveries.notSharedTitle")}
        description={t("portalMod.deliveries.notSharedDesc")}
      />
    ) : (
      <VendorStateCard
        title={t("portalMod.deliveries.couldntLoadTitle")}
        description={t("portalMod.deliveries.couldntLoadDesc")}
        onRetry={() => void pos.refetch()}
      />
    );
  }
  if (membership && !membership.exposure.deliveries) {
    return (
      <VendorStateCard
        icon={Lock}
        title={t("portalMod.deliveries.notSharedTitle")}
        description={t("portalMod.deliveries.notSharedDesc")}
      />
    );
  }

  const openPos = (pos.data ?? []).filter((p) => p.status !== "closed" && p.status !== "cancelled");

  return (
    <div className="page-shell">
      <PageHeader
        title={t("portalMod.deliveries.title")}
        description={t("portalMod.deliveries.description")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/vendor/$vendorId" params={{ vendorId }}>
              <ArrowLeft className="me-2 h-4 w-4" />
              {t("portalMod.deliveries.backToDashboard")}
            </Link>
          </Button>
        }
      />

      {openPos.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={t("portalMod.deliveries.emptyTitle")}
          description={t("portalMod.deliveries.emptyDesc")}
        />
      ) : (
        <div className="space-y-4">
          {openPos.map((po) => (
            <PoDeliverySection
              key={po.id}
              po={po}
              etaByKey={etaByKey}
              onPropose={() => setDialogPo(po)}
            />
          ))}
        </div>
      )}

      <ProposeDeliveryDialog
        po={dialogPo}
        etaByKey={etaByKey}
        submitting={propose.isPending}
        onClose={() => setDialogPo(null)}
        onSubmit={(poId, poIssueDate, lines) => propose.mutate({ poId, poIssueDate, lines })}
      />
    </div>
  );
}

function PoDeliverySection({
  po,
  etaByKey,
  onPropose,
}: {
  po: VendorPoRow;
  etaByKey: Map<string, VendorLineEtaRow>;
  onPropose: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const lines = parsePoLines(po.lines);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <CollapsibleTrigger className="flex items-center gap-2 text-start">
            <ChevronDown
              className={`h-4 w-4 transition-transform rtl:-scale-x-100 ${open ? "" : "-rotate-90"}`}
              aria-hidden
            />
            <span className="font-mono text-sm">{po.po_number}</span>
            <span className="text-xs text-muted-foreground">
              {t(`portalMod.deliveries.lineCount`, { count: lines.length })}
              {t("portalMod.deliveries.issuedOn", {
                date: po.issued_at ? formatDate(po.issued_at) : "—",
              })}
            </span>
          </CollapsibleTrigger>
          <Button size="sm" onClick={onPropose} disabled={lines.length === 0}>
            <CalendarClock className="me-2 h-4 w-4" />
            {t("portalMod.deliveries.proposeDelivery")}
          </Button>
        </div>
        <CollapsibleContent>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t("portalMod.deliveries.colLine")}</TableHead>
                  <TableHead>{t("portalMod.deliveries.colDescription")}</TableHead>
                  <TableHead>{t("portalMod.deliveries.colQty")}</TableHead>
                  <TableHead>{t("portalMod.deliveries.colSiteNeed")}</TableHead>
                  <TableHead>{t("portalMod.deliveries.colCurrentEta")}</TableHead>
                  <TableHead>{t("portalMod.deliveries.colConfirmation")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const eta = etaByKey.get(`${po.id}:${l.line_no}`);
                  return (
                    <TableRow key={l.line_no}>
                      <TableCell className="font-mono text-xs">{l.line_no}</TableCell>
                      <TableCell>
                        <div className="text-sm">{l.description}</div>
                        {isVendorProposedNote(eta?.notes) ? (
                          <div className="text-[10px] text-muted-foreground">{eta?.notes}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Num>{l.quantity}</Num>
                        {l.uom ? ` ${l.uom}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">
                        {eta?.site_need_date
                          ? formatDate(eta.site_need_date)
                          : l.site_need_date
                            ? formatDate(l.site_need_date)
                            : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {eta?.current_eta ? formatDate(eta.current_eta) : "—"}
                      </TableCell>
                      <TableCell>
                        <ConfirmationChip eta={eta} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
