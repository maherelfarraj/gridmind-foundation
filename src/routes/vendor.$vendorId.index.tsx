// P-222 — Vendor portal dashboard: POs, deliveries, invoices, documents.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Inbox, Lock, PackageSearch, Receipt } from "lucide-react";

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
import { deriveVendorOverview, vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import {
  getVendorPortalDeliveries,
  getVendorPortalDocuments,
  getVendorPortalInvoices,
  getVendorPortalPos,
  listMyVendorMemberships,
} from "@/lib/vendor-portal.functions";

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
  if (loading) return <VendorTableSkeleton />;
  const code = vendorPortalErrorCode(error);
  if (code === "vendor_portal_access_denied") {
    return (
      <VendorStateCard
        icon={Lock}
        title="Access expired or revoked"
        description="Your access to this vendor account is no longer active. Please contact your EPC representative."
      />
    );
  }
  if (code?.endsWith("_not_exposed")) {
    return (
      <VendorStateCard
        icon={Lock}
        title="Not shared with you"
        description="Your EPC contact hasn’t shared this information with your account."
      />
    );
  }
  return (
    <VendorStateCard
      title="Couldn’t load this tab"
      description="Something went wrong. Please try again."
    />
  );
}

function VendorDashboard() {
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

  if (membership && membership.status !== "active") {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <VendorStateCard
          icon={Lock}
          title="Access expired or revoked"
          description="Your access to this vendor account is no longer active. Please contact your EPC representative."
        />
      </div>
    );
  }

  const overview = deriveVendorOverview(pos.data ?? []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={membership?.vendor_name ?? "Vendor dashboard"}
        description={membership?.company_name ? `Shared by ${membership.company_name}` : undefined}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Open purchase orders" value={String(overview.openPos)} />
        <KpiTile label="Pending acknowledgments" value={String(overview.pendingAcknowledgments)} />
        <KpiTile
          label="Next required by"
          value={overview.nextRequiredBy ? formatDate(overview.nextRequiredBy) : "—"}
        />
      </div>

      <Tabs defaultValue="pos">
        <TabsList>
          <TabsTrigger value="pos">Purchase Orders</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" asChild>
              <Link to="/vendor/$vendorId/pos" params={{ vendorId }}>
                Open PO workspace
              </Link>
            </Button>
          </div>

          {pos.isLoading || pos.error ? (
            <TabState loading={pos.isLoading} error={pos.error} />
          ) : (pos.data ?? []).length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="No purchase orders"
              description="Purchase orders issued to you will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Required by</TableHead>
                  <TableHead className="text-right">Value</TableHead>
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
                Propose delivery dates
              </Link>
            </Button>
          </div>
          {deliveries.isLoading || deliveries.error ? (

            <TabState loading={deliveries.isLoading} error={deliveries.error} />
          ) : (deliveries.data ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No deliveries"
              description="Shipments linked to your purchase orders will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Delivered</TableHead>
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

        <TabsContent value="invoices" className="mt-4">
          {invoices.isLoading || invoices.error ? (
            <TabState loading={invoices.isLoading} error={invoices.error} />
          ) : (invoices.data ?? []).length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices"
              description="Invoices you have submitted will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
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

        <TabsContent value="documents" className="mt-4">
          {documents.isLoading || documents.error ? (
            <TabState loading={documents.isLoading} error={documents.error} />
          ) : (documents.data ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents"
              description="Documents shared with your organisation will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Shared</TableHead>
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
