// P-063 — RFQ detail page with Lines / Vendors / Bids / Tabulation tabs.
import { useMemo, useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
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
import {
  RfqBidStatusBadge,
  RfqStatusBadge,
} from "@/components/procurement/rfq-status-badge";
import { InviteVendorDialog } from "@/components/procurement/invite-vendor-dialog";
import { SubmitBidDialog } from "@/components/procurement/submit-bid-dialog";
import { BidTabulationTable } from "@/components/procurement/bid-tabulation-table";
import { AwardPanel } from "@/components/procurement/award-panel";
import {
  getRfq,
  getRfqWriteAccess,
} from "@/lib/rfq.functions";
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
  const submitBid = useSubmitBid(rfqId);

  const invitedVendorIds = useMemo(
    () => new Set(bids.map((b) => b.vendor_id)),
    [bids],
  );

  const inviteCount = bids.length;
  const submittedCount = bids.filter(
    (b) => b.status === "submitted" || b.status === "under_review" || b.status === "awarded",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/procurement/rfqs" })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <MailPlus className="h-3.5 w-3.5" /> Procurement · RFQ
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {rfq.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-mono">{rfq.rfq_number}</span>
            <RfqStatusBadge status={rfq.status} />
            <span>{rfq.project_name ?? "—"}</span>
            <span>{rfq.currency_code}</span>
            {rfq.due_date && <span>Due {format(new Date(rfq.due_date), "PP")}</span>}
          </div>
        </div>
        {canAuthor && rfq.status === "draft" && (
          <Button
            onClick={() => issue.mutate()}
            disabled={issue.isPending || rfq.lines.length === 0 || inviteCount === 0}
          >
            <Send className="mr-2 h-4 w-4" />
            {issue.isPending ? "Issuing…" : "Issue RFQ"}
          </Button>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lines">Lines ({rfq.lines.length})</TabsTrigger>
          <TabsTrigger value="vendors">Invited ({inviteCount})</TabsTrigger>
          <TabsTrigger value="bids">Bids ({submittedCount})</TabsTrigger>
          <TabsTrigger value="tabulation">Tabulation</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="pt-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-20">UoM</TableHead>
                  <TableHead className="w-32">Target</TableHead>
                  <TableHead className="w-36">Site need</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfq.lines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No lines on this RFQ.
                    </TableCell>
                  </TableRow>
                ) : (
                  rfq.lines.map((l) => (
                    <TableRow key={l.line_no}>
                      <TableCell>{l.line_no}</TableCell>
                      <TableCell className="font-medium">{l.description}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {l.spec ?? "—"}
                      </TableCell>
                      <TableCell>{l.qty}</TableCell>
                      <TableCell>{l.uom}</TableCell>
                      <TableCell>
                        {l.target_price != null ? l.target_price : "—"}
                      </TableCell>
                      <TableCell>
                        {l.site_need_date
                          ? format(new Date(l.site_need_date), "PP")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="vendors" className="pt-4 space-y-3">
          {canAuthor && rfq.status !== "cancelled" && (
            <div className="flex justify-end">
              <InviteVendorDialog
                alreadyInvited={invitedVendorIds}
                onInvite={(ids) => invite.mutateAsync(ids)}
                trigger={
                  <Button>
                    <MailPlus className="mr-2 h-4 w-4" /> Invite vendors
                  </Button>
                }
              />
            </div>
          )}
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Invited</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {bids.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No vendors invited yet.
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
                            aria-label={`Remove ${b.vendor_name}`}
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
          </div>
        </TabsContent>

        <TabsContent value="bids" className="pt-4">
          {bids.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No bids submitted yet.
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Validity</TableHead>
                    <TableHead>Submitted</TableHead>
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
                        {b.total_price != null
                          ? `${b.currency_code ?? rfq.currency_code} ${b.total_price.toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell>{b.lead_time_days ?? "—"}</TableCell>
                      <TableCell>
                        {b.validity_date
                          ? format(new Date(b.validity_date), "PP")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {b.submitted_at
                          ? format(new Date(b.submitted_at), "PP")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
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
                                  Record bid
                                </Button>
                              }
                            />
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tabulation" className="space-y-6 pt-4">
          <AwardPanel rfq={rfq} bids={bids} canAward={canAward} />
          <BidTabulationTable
            rfqLines={rfq.lines}
            bids={bids}
            currency={rfq.currency_code}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
