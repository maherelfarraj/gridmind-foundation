// P-223 — Vendor PO list with acknowledgment.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Lock, MapPin, PackageSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { PoStatusStepper } from "@/components/vendor-portal/po-status-stepper";
import { AcknowledgmentChip } from "@/components/vendor-portal/acknowledgment-chip";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { countdownLabel, parsePoLines, vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import {
  acknowledgePo,
  getVendorPortalPos,
  listMyVendorMemberships,
  type VendorPoRow,
} from "@/lib/vendor-portal.functions";

export const Route = createFileRoute("/vendor/$vendorId/pos")({
  head: () => ({
    meta: [
      { title: "Purchase orders — GridMind Vendor Portal" },
      {
        name: "description",
        content: "Review and acknowledge the purchase orders issued to you by GridMind EPC.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorPoList,
});

type Decision = "accepted" | "accepted_with_comments" | "rejected";

function VendorPoList() {
  const { vendorId } = Route.useParams();
  const qc = useQueryClient();
  const posFn = useServerFn(getVendorPortalPos);
  const ackFn = useServerFn(acknowledgePo);
  const membershipsFn = useServerFn(listMyVendorMemberships);

  const memberships = useQuery({
    queryKey: ["vendor-portal", "memberships"],
    queryFn: () => membershipsFn(),
  });
  const membership = (memberships.data ?? []).find((m) => m.vendor_id === vendorId);

  const queryKey = ["vendor-portal", "pos", vendorId] as const;
  const pos = useQuery({
    queryKey,
    queryFn: () => posFn({ data: { vendorId } }),
    retry: false,
  });

  const [linesPo, setLinesPo] = useState<VendorPoRow | null>(null);
  const [ackPo, setAckPo] = useState<VendorPoRow | null>(null);

  const ack = useMutation({
    mutationFn: (args: { poId: string; decision: Decision; comment?: string }) =>
      ackFn({ data: { vendorId, ...args } }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<VendorPoRow[]>(queryKey);
      qc.setQueryData<VendorPoRow[]>(queryKey, (rows) =>
        (rows ?? []).map((r) =>
          r.id === args.poId
            ? {
                ...r,
                acknowledged_at: new Date().toISOString(),
                acknowledgment_status: args.decision,
                acknowledgment_note: args.comment ?? null,
              }
            : r,
        ),
      );
      return { previous };
    },
    onError: (err, _args, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      const code = vendorPortalErrorCode(err);
      toast.error(
        code === "comment_required"
          ? "A comment is required for this decision"
          : code === "po_not_acknowledgeable"
            ? "This purchase order can no longer be acknowledged"
            : code === "vendor_portal_access_denied"
              ? "Access expired or revoked"
              : "Could not submit your acknowledgment",
      );
    },
    onSuccess: () => {
      toast.success("Acknowledgment submitted");
      setAckPo(null);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey }),
  });

  const rows = useMemo(() => pos.data ?? [], [pos.data]);
  const code = vendorPortalErrorCode(pos.error);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/vendor/$vendorId" params={{ vendorId }}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
        </Link>
      </Button>

      <PageHeader
        title="Purchase orders"
        description={
          membership?.company_name
            ? `Issued to you by ${membership.company_name}`
            : "Issued to your organisation"
        }
      />

      {pos.isLoading ? (
        <VendorTableSkeleton rows={5} />
      ) : pos.error ? (
        code === "vendor_portal_access_denied" ? (
          <VendorStateCard
            icon={Lock}
            title="Access expired or revoked"
            description="Your access to this vendor account is no longer active. Please contact your EPC representative."
          />
        ) : code?.endsWith("_not_exposed") ? (
          <VendorStateCard
            icon={Lock}
            title="Not shared with you"
            description="Your EPC contact hasn’t shared purchase orders with your account."
          />
        ) : (
          <VendorStateCard
            title="Couldn’t load purchase orders"
            description="Something went wrong. Please try again."
            onRetry={() => void pos.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No purchase orders"
          description="Purchase orders issued to you will appear here."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((po) => {
            const canAck = po.status === "issued" || po.status === "partially_received";
            const countdown = countdownLabel(po.required_by_date);
            return (
              <Card key={po.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-base font-semibold text-foreground">
                      {po.po_number}
                    </span>
                    {po.acknowledgment_status ? (
                      <AcknowledgmentChip
                        status={po.acknowledgment_status}
                        at={po.acknowledged_at}
                        note={po.acknowledgment_note}
                      />
                    ) : null}
                    <span className="ml-auto tabular-nums text-sm text-muted-foreground">
                      {formatMoney(Number(po.total_amount ?? 0), po.currency_code)}
                    </span>
                  </div>

                  <PoStatusStepper status={po.status} />

                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      Required by{" "}
                      <span className="text-foreground">
                        {po.required_by_date ? formatDate(po.required_by_date) : "—"}
                      </span>
                    </span>
                    {countdown ? (
                      <Badge variant={countdown.overdue ? "destructive" : "secondary"}>
                        {countdown.label}
                      </Badge>
                    ) : null}
                    {po.delivery_address ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> {po.delivery_address}
                      </span>
                    ) : null}
                    {po.issued_at ? <span>Issued {formatDate(po.issued_at)}</span> : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setLinesPo(po)}>
                      View lines
                    </Button>
                    {canAck ? (
                      <Button size="sm" onClick={() => setAckPo(po)}>
                        {po.acknowledgment_status ? "Re-acknowledge" : "Acknowledge"}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PoLinesDrawer po={linesPo} onClose={() => setLinesPo(null)} />
      <AcknowledgeDialog
        po={ackPo}
        pending={ack.isPending}
        onClose={() => setAckPo(null)}
        onSubmit={(decision, comment) => ackPo && ack.mutate({ poId: ackPo.id, decision, comment })}
      />
    </div>
  );
}

function PoLinesDrawer({ po, onClose }: { po: VendorPoRow | null; onClose: () => void }) {
  const lines = parsePoLines(po?.lines);
  return (
    <Drawer open={po !== null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{po?.po_number} — lines</DrawerTitle>
          <DrawerDescription>Quantities, specifications and your agreed prices.</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[60vh] overflow-auto px-4 pb-8">
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No line items on this purchase order.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>UoM</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{l.description}</TableCell>
                    <TableCell className="text-muted-foreground">{l.spec ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell>{l.uom ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(l.unit_price, po?.currency_code ?? "USD", {
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(l.amount, po?.currency_code ?? "USD", {
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function AcknowledgeDialog({
  po,
  pending,
  onClose,
  onSubmit,
}: {
  po: VendorPoRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (decision: Decision, comment?: string) => void;
}) {
  const [decision, setDecision] = useState<Decision>("accepted");
  const [comment, setComment] = useState("");
  const commentRequired = decision !== "accepted";
  const disabled = pending || (commentRequired && comment.trim().length === 0);

  return (
    <Dialog
      open={po !== null}
      onOpenChange={(o) => {
        if (!o) {
          setDecision("accepted");
          setComment("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acknowledge {po?.po_number}</DialogTitle>
          <DialogDescription>
            {po?.acknowledged_at
              ? `Last acknowledged ${formatDateTime(po.acknowledged_at)} — submitting again overwrites it.`
              : "Confirm receipt of this purchase order."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2">
            {(
              [
                ["accepted", "Accept"],
                ["accepted_with_comments", "Accept with comments"],
                ["rejected", "Reject"],
              ] as Array<[Decision, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDecision(value)}
                className={`rounded-md border p-3 text-left text-sm transition ${
                  decision === value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {commentRequired ? (
            <div className="space-y-1.5">
              <label htmlFor="ack-comment" className="text-sm text-muted-foreground">
                Comment (required)
              </label>
              <Textarea
                id="ack-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell the EPC team what needs to change"
                rows={4}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  disabled={disabled}
                  onClick={() => onSubmit(decision, commentRequired ? comment.trim() : undefined)}
                >
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit acknowledgment
                </Button>
              </span>
            </TooltipTrigger>
            {disabled && !pending ? (
              <TooltipContent>A comment is required for this decision.</TooltipContent>
            ) : null}
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
