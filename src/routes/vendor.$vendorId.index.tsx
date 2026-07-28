// P-222 — Vendor portal dashboard: POs, deliveries, invoices, documents.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, HardHat, Inbox, Lock, PackageSearch, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { formatDate, formatMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import { deriveVendorOverview, vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import {
  getVendorPortalDeliveries,
  getVendorPortalDocuments,
  getVendorPortalInvoices,
  getVendorPortalPos,
  listMyVendorMemberships,
} from "@/lib/vendor-portal.functions";
import { listSubPortalSubcontracts } from "@/lib/sub-portal.functions";

export const Route = createFileRoute("/vendor/$vendorId/")({
  head: () => ({
    meta: [
      { title: "Vendor dashboard — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Track your purchase orders, deliveries, invoices and shared documents with GridMind EPC.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorDashboard,
});

function useVendorQuery<T>(
  key: string,
  vendorId: string,
  fn: (a: { data: { vendorId: string } }) => Promise<T>,
) {
  return useQuery({
    queryKey: ["vendor-portal", key, vendorId],
    queryFn: () => fn({ data: { vendorId } }),
    retry: false,
  });
}

function TabState({ error, loading }: { error: unknown; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <VendorTableSkeleton />;
  const code = vendorPortalErrorCode(error);
  if (code === "vendor_portal_access_denied") {
    return (
      <VendorStateCard
        icon={Lock}
        title={t("portalMod.dashboard.accessExpiredTitle")}
        description={t("portalMod.dashboard.accessExpiredDesc")}
      />
    );
  }
  if (code?.endsWith("_not_exposed")) {
    return (
      <VendorStateCard
        icon={Lock}
        title={t("portalMod.dashboard.notSharedTitle")}
        description={t("portalMod.dashboard.notSharedDesc")}
      />
    );
  }
  return (
    <VendorStateCard
      title={t("portalMod.dashboard.couldntLoadTabTitle")}
      description={t("portalMod.dashboard.couldntLoadTabDesc")}
    />
  );
}

function VendorDashboard() {
  const { t } = useI18n();
  const { vendorId } = Route.useParams();
  const membershipsFn = useServerFn(listMyVendorMemberships);
  const memberships = useQuery({
    queryKey: ["vendor-portal", "memberships"],
    queryFn: () => membershipsFn(),
  });
  const membership = (memberships.data ?? []).find((m) => m.vendor_id === vendorId);

  const pos = useVendorQuery("pos", vendorId, useServerFn(getVendorPortalPos));
  const deliveries = useVendorQuery("deliveries", vendorId, useServerFn(getVendorPortalDeliveries));
  const invoices = useVendorQuery("invoices", vendorId, useServerFn(getVendorPortalInvoices));
  const documents = useVendorQuery("documents", vendorId, useServerFn(getVendorPortalDocuments));
  const subcontracts = useVendorQuery(
    "subcontracts",
    vendorId,
    useServerFn(listSubPortalSubcontracts),
  );

  if (membership && membership.status !== "active") {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <VendorStateCard
          icon={Lock}
          title={t("portalMod.dashboard.accessExpiredTitle")}
          description={t("portalMod.dashboard.accessExpiredDesc")}
        />
      </div>
    );
  }

  const overview = deriveVendorOverview(pos.data ?? []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={membership?.vendor_name ?? t("portalMod.dashboard.titleFallback")}
        description={
          membership?.company_name
            ? t("portalMod.dashboard.sharedBy", { company: membership.company_name })
            : undefined
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label={t("portalMod.dashboard.kpiOpenPos")} value={String(overview.openPos)} />
        <KpiTile
          label={t("portalMod.dashboard.kpiPendingAck")}
          value={String(overview.pendingAcknowledgments)}
        />
        <KpiTile
          label={t("portalMod.dashboard.kpiNextRequiredBy")}
          value={overview.nextRequiredBy ? formatDate(overview.nextRequiredBy) : "—"}
        />
      </div>

      <Tabs defaultValue="pos">
        <TabsList>
          <TabsTrigger value="pos">{t("portalMod.dashboard.tabPos")}</TabsTrigger>
          <TabsTrigger value="deliveries">{t("portalMod.dashboard.tabDeliveries")}</TabsTrigger>
          <TabsTrigger value="invoices">{t("portalMod.dashboard.tabInvoices")}</TabsTrigger>
          <TabsTrigger value="subcontracts">{t("portalMod.sub.tab")}</TabsTrigger>
          <TabsTrigger value="documents">{t("portalMod.dashboard.tabDocuments")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/pos" params={{ vendorId }}>
                {t("portalMod.dashboard.openPoWorkspace")}
              </Link>
            </Button>
          </div>

          {pos.isLoading || pos.error ? (
            <TabState loading={pos.isLoading} error={pos.error} />
          ) : (pos.data ?? []).length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title={t("portalMod.dashboard.noPosTitle")}
              description={t("portalMod.dashboard.noPosDesc")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("portalMod.dashboard.colPo")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colStatus")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colIssued")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colRequiredBy")}</TableHead>
                  <TableHead className="text-right">{t("portalMod.dashboard.colValue")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pos.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.po_number}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {String(p.status).replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.issued_at ? formatDate(p.issued_at) : "—"}</TableCell>
                    <TableCell>
                      {p.required_by_date ? formatDate(p.required_by_date) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(p.total_amount ?? 0), p.currency_code)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="deliveries" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/deliveries" params={{ vendorId }}>
                {t("portalMod.dashboard.proposeDeliveryDates")}
              </Link>
            </Button>
          </div>
          {deliveries.isLoading || deliveries.error ? (
            <TabState loading={deliveries.isLoading} error={deliveries.error} />
          ) : (deliveries.data ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t("portalMod.dashboard.noDeliveriesTitle")}
              description={t("portalMod.dashboard.noDeliveriesDesc")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("portalMod.dashboard.colReference")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colPo")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colStatus")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colCarrier")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colExpected")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colDelivered")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deliveries.data ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.reference ?? "—"}</TableCell>
                    <TableCell>{d.po_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {String(d.status).replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{d.carrier ?? "—"}</TableCell>
                    <TableCell>{d.expected_date ? formatDate(d.expected_date) : "—"}</TableCell>
                    <TableCell>{d.delivered_at ? formatDate(d.delivered_at) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/invoices" params={{ vendorId }}>
                {t("portalMod.dashboard.submitAnInvoice")}
              </Link>
            </Button>
          </div>
          {invoices.isLoading || invoices.error ? (
            <TabState loading={invoices.isLoading} error={invoices.error} />
          ) : (invoices.data ?? []).length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t("portalMod.dashboard.noInvoicesTitle")}
              description={t("portalMod.dashboard.noInvoicesDesc")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("portalMod.dashboard.colInvoice")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colStatus")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colIssued")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colDue")}</TableHead>
                  <TableHead className="text-right">{t("portalMod.dashboard.colAmount")}</TableHead>
                  <TableHead className="text-right">{t("portalMod.dashboard.colPaid")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {String(inv.status).replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>{inv.issue_date ? formatDate(inv.issue_date) : "—"}</TableCell>
                    <TableCell>{inv.due_date ? formatDate(inv.due_date) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(inv.amount ?? 0), inv.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(inv.paid_amount ?? 0), inv.currency_code)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="subcontracts" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/subcontracts" params={{ vendorId }}>
                {t("portalMod.sub.listTitle")}
              </Link>
            </Button>
          </div>
          {subcontracts.isLoading || subcontracts.error ? (
            <TabState loading={subcontracts.isLoading} error={subcontracts.error} />
          ) : (subcontracts.data ?? []).length === 0 ? (
            <EmptyState
              icon={HardHat}
              title={t("portalMod.sub.emptyTitle")}
              description={t("portalMod.sub.emptyDesc")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("portalMod.sub.colSc")}</TableHead>
                  <TableHead>{t("portalMod.sub.colProject")}</TableHead>
                  <TableHead>{t("portalMod.sub.colStatus")}</TableHead>
                  <TableHead className="text-right">{t("portalMod.sub.colValue")}</TableHead>
                  <TableHead className="text-right">{t("portalMod.sub.colRetention")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(subcontracts.data ?? []).map((sc) => (
                  <TableRow key={sc.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/vendor/$vendorId/subcontracts/$subcontractId"
                        params={{ vendorId, subcontractId: sc.id }}
                        className="underline-offset-2 hover:underline"
                      >
                        {sc.subcontract_number ?? sc.title}
                      </Link>
                    </TableCell>
                    <TableCell>{sc.project_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {String(sc.status).replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(sc.contract_value ?? 0), sc.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(sc.retention_held ?? 0), sc.currency_code)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/documents" params={{ vendorId }}>
                {t("portalMod.dashboard.shareADocument")}
              </Link>
            </Button>
          </div>
          {documents.isLoading || documents.error ? (
            <TabState loading={documents.isLoading} error={documents.error} />
          ) : (documents.data ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title={t("portalMod.dashboard.noDocumentsTitle")}
              description={t("portalMod.dashboard.noDocumentsDesc")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("portalMod.dashboard.colTitle")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colCategory")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colFile")}</TableHead>
                  <TableHead>{t("portalMod.dashboard.colShared")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(documents.data ?? []).map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.title}</TableCell>
                    <TableCell className="capitalize">
                      {String(doc.category).replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{doc.file_name ?? "—"}</TableCell>
                    <TableCell>{formatDate(doc.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
