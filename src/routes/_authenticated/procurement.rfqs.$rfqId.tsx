// P-063 — RFQ detail page with Lines / Vendors / Bids / Tabulation tabs.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, MailPlus, Send, Trash2 } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { UnderChangeControlBanner } from "@/components/moc/under-change-control-banner";
import { useUnderChangeControl } from "@/hooks/use-change-control";
import { EmptyState } from "@/components/ui/empty-state";
import { RfqBidStatusBadge, RfqStatusBadge } from "@/components/procurement/rfq-status-badge";
import { InviteVendorDialog } from "@/components/procurement/invite-vendor-dialog";
import { SubmitBidDialog } from "@/components/procurement/submit-bid-dialog";
import { BidTabulationTable } from "@/components/procurement/bid-tabulation-table";
import { AwardPanel } from "@/components/procurement/award-panel";
import { Num } from "@/components/ui/num";
import { useI18n } from "@/lib/i18n/locale-provider";
import { getRfq, getRfqWriteAccess } from "@/lib/rfq.functions";
import {
  rfqDetailQueryOptions,
  rfqWriteAccessQueryOptions,
  useInviteVendors,
  useIssueRfq,
  useRemoveInvite,
  useSubmitBid,
} from "@/lib/rfq-query";

export const Route = createFileRoute("/_authenticated/procurement/rfqs/$rfqId")({
  head: () => ({
    meta: [
      { title: "RFQ — GridMind EPC" },
      {
        name: "description",
        content: "Manage a GridMind EPC RFQ: lines, invited vendors, bids, and TCO tabulation.",
      },
    ],
  }),
  component: RfqDetail,
});

function RfqDetail() {
  const { t } = useI18n();
  const { rfqId } = useParams({ from: "/_authenticated/procurement/rfqs/$rfqId" });
  const navigate = useNavigate();
  const [tab, setTab] = useState("lines");

  const detailFn = useServerFn(getRfq);
  const accessFn = useServerFn(getRfqWriteAccess);
  const detailQuery = useSuspenseQuery(rfqDetailQueryOptions(detailFn, rfqId));
  const accessQuery = useSuspenseQuery(rfqWriteAccessQueryOptions(accessFn));
  const { rfq, bids } = detailQuery.data;
  const { canAuthor, canAward } = accessQuery.data;

  const invite = useInviteVendors(rfqId);
  const removeInvite = useRemoveInvite(rfqId);
  const issue = useIssueRfq(rfqId);
  const changeControl = useUnderChangeControl("rfq", rfqId);

  const submitBid = useSubmitBid(rfqId);

  const invitedVendorIds = useMemo(() => new Set(bids.map((b) => b.vendor_id)), [bids]);

  const inviteCount = bids.length;
  const submittedCount = bids.filter(
    (b) => b.status === "submitted" || b.status === "under_review" || b.status === "awarded",
  ).length;

  return (
    <div className="page-shell">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/rfqs" })}>
          <ArrowLeft className="me-2 h-4 w-4" /> {t("procurementMod.rfqs.backToList")}
        </Button>
      </div>

      <PageHeader
        title={rfq.title}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{rfq.rfq_number}</span>
            <RfqStatusBadge status={rfq.status} />
            <span>{rfq.project_name ?? "—"}</span>
            <span>{rfq.currency_code}</span>
            {rfq.due_date && <span>{t("procurementMod.rfqs.dueOn", { date: format(new Date(rfq.due_date), "PP") })}</span>}
          </span>
        }
        actions={
          canAuthor && rfq.status === "draft" ? (
            <Button
              onClick={() => issue.mutate()}
              disabled={
                issue.isPending ||
                rfq.lines.length === 0 ||
                inviteCount === 0 ||
                changeControl.blocked
              }
              title={
                changeControl.blocked
                  ? t("procurementMod.common.changeControlBlocked")
                  : undefined
              }
            >
              <Send className="me-2 h-4 w-4" />
              {issue.isPending ? t("procurementMod.rfqs.issuing") : t("procurementMod.rfqs.issueRfq")}
            </Button>
          ) : undefined
        }
      />

      <UnderChangeControlBanner entityType="rfq" entityId={rfqId} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lines">{t("procurementMod.rfqs.linesTab", { count: rfq.lines.length })}</TabsTrigger>
          <TabsTrigger value="vendors">{t("procurementMod.rfqs.vendorsTab", { count: inviteCount })}</TabsTrigger>
          <TabsTrigger value="bids">{t("procurementMod.rfqs.bidsTab", { count: submittedCount })}</TabsTrigger>
          <TabsTrigger value="tabulation">{t("procurementMod.rfqs.tabulationTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t("procurementMod.common.hash")}</TableHead>
                <TableHead>{t("procurementMod.common.description")}</TableHead>
                <TableHead>{t("procurementMod.common.spec")}</TableHead>
                <TableHead className="w-24">{t("procurementMod.common.qtyShort")}</TableHead>
                <TableHead className="w-20">{t("procurementMod.common.uom")}</TableHead>
                <TableHead className="w-32">{t("procurementMod.rfqs.colTarget")}</TableHead>
                <TableHead className="w-36">{t("procurementMod.rfqs.colSiteNeed")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="border-0 bg-transparent">
                    <EmptyState title={t("procurementMod.rfqs.noLines")} compact />
                  </TableCell>
                </TableRow>
              ) : (
                rfq.lines.map((l) => (
                  <TableRow key={l.line_no}>
                    <TableCell>{l.line_no}</TableCell>
                    <TableCell className="font-medium">{l.description}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.spec ?? "—"}</TableCell>
                    <TableCell>
                      <Num>{l.qty}</Num>
                    </TableCell>
                    <TableCell>{l.uom}</TableCell>
                    <TableCell>
                      {l.target_price != null ? <Num>{l.target_price}</Num> : "—"}
                    </TableCell>
                    <TableCell>
                      {l.site_need_date ? format(new Date(l.site_need_date), "PP") : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="vendors" className="space-y-3 pt-4">
          {canAuthor && rfq.status !== "cancelled" && (
            <div className="flex justify-end">
              <InviteVendorDialog
                alreadyInvited={invitedVendorIds}
                onInvite={(ids) => invite.mutateAsync(ids)}
                trigger={
                  <Button>
                    <MailPlus className="me-2 h-4 w-4" /> {t("procurementMod.rfqs.inviteVendors")}
                  </Button>
                }
              />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurementMod.common.vendor")}</TableHead>
                <TableHead>{t("procurementMod.common.status")}</TableHead>
                <TableHead className="w-32">{t("procurementMod.rfqs.colInvited")}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bids.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="border-0 bg-transparent">
                    <EmptyState title={t("procurementMod.rfqs.noVendorsInvited")} compact />
                  </TableCell>
                </TableRow>
              ) : (
                bids.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.vendor_name}</TableCell>
                    <TableCell>
                      <RfqBidStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(b.created_at), "PP")}
                    </TableCell>
                    <TableCell>
                      {canAuthor && b.status === "invited" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("procurementMod.rfqs.removeVendor", { name: b.vendor_name })}
                          onClick={() => removeInvite.mutate(b.id)}
                          disabled={removeInvite.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="bids" className="pt-4">
          {bids.length === 0 ? (
            <EmptyState title={t("procurementMod.rfqs.noBids")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("procurementMod.common.vendor")}</TableHead>
                  <TableHead>{t("procurementMod.common.status")}</TableHead>
                  <TableHead>{t("procurementMod.rfqs.colTotal")}</TableHead>
                  <TableHead>{t("procurementMod.rfqs.colLead")}</TableHead>
                  <TableHead>{t("procurementMod.rfqs.colValidity")}</TableHead>
                  <TableHead>{t("procurementMod.rfqs.colSubmitted")}</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bids.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.vendor_name}</TableCell>
                    <TableCell>
                      <RfqBidStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell>
                      {b.total_price != null ? (
                        <Num>
                          {b.currency_code ?? rfq.currency_code} {b.total_price.toFixed(2)}
                        </Num>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{b.lead_time_days ?? "—"}</TableCell>
                    <TableCell>
                      {b.validity_date ? format(new Date(b.validity_date), "PP") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.submitted_at ? format(new Date(b.submitted_at), "PP") : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      {canAuthor &&
                        rfq.status === "issued" &&
                        b.status !== "awarded" &&
                        b.status !== "withdrawn" && (
                          <SubmitBidDialog
                            bid={b}
                            rfqLines={rfq.lines}
                            currencyCode={rfq.currency_code}
                            onSubmit={(input) => submitBid.mutateAsync(input)}
                            trigger={
                              <Button size="sm" variant="outline">
                                {t("procurementMod.rfqs.recordBid")}
                              </Button>
                            }
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="tabulation" className="space-y-6 pt-4">
          <AwardPanel rfq={rfq} bids={bids} canAward={canAward} />
          <BidTabulationTable rfqLines={rfq.lines} bids={bids} currency={rfq.currency_code} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
