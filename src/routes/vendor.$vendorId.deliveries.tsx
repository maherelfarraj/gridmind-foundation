// P-224 — Vendor delivery scheduling: propose delivery windows per PO line.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, CalendarClock, CheckCircle2, ChevronDown, Loader2, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
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
import { formatDate } from "@/lib/format";
import {
  PROPOSE_DELIVERY_ERRORS,
  isCounterProposedNote,
  isVendorProposedNote,
  parsePoLines,
  validateProposedDate,
  vendorPortalErrorCode,
  type PoLine,
} from "@/lib/vendor-portal.rules";
import {
  getVendorPortalLineEtas,
  getVendorPortalPos,
  listMyVendorMemberships,
  proposeDelivery,
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

interface DraftRow {
  line_no: number;
  proposed_date: string;
  proposed_qty: string;
  note: string;
}

function VendorDeliveries() {
  const { vendorId } = Route.useParams();
  const qc = useQueryClient();
  const posFn = useServerFn(getVendorPortalPos);
  const etasFn = useServerFn(getVendorPortalLineEtas);
  const proposeFn = useServerFn(proposeDelivery);
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
  const etasKey = ["vendor-portal", "line-etas", vendorId] as const;
  const etas = useQuery({
    queryKey: etasKey,
    queryFn: () => etasFn({ data: { vendorId } }),
    retry: false,
  });

  const [dialogPo, setDialogPo] = useState<VendorPoRow | null>(null);

  const etaByKey = useMemo(() => {
    const map = new Map<string, VendorLineEtaRow>();
    for (const e of etas.data ?? []) map.set(`${e.po_id}:${e.po_line_no ?? 0}`, e);
    return map;
  }, [etas.data]);

  const propose = useMutation({
    mutationFn: (vars: {
      poId: string;
      poIssueDate: string | null;
      lines: Array<{
        line_no: number;
        proposed_date: string;
        proposed_qty?: number | null;
        note?: string | null;
      }>;
    }) => proposeFn({ data: { vendorId, ...vars } }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: etasKey });
      const prev = qc.getQueryData<VendorLineEtaRow[]>(etasKey);
      qc.setQueryData<VendorLineEtaRow[]>(etasKey, (old) => {
        const next = [...(old ?? [])];
        for (const l of vars.lines) {
          const i = next.findIndex((r) => r.po_id === vars.poId && r.po_line_no === l.line_no);
          const patch = {
            current_eta: l.proposed_date,
            eta_confirmed: false,
            notes: `Vendor-proposed${l.note ? ` — ${l.note}` : ""}`,
          };
          if (i >= 0) next[i] = { ...next[i], ...patch };
          else
            next.push({
              po_id: vars.poId,
              po_line_no: l.line_no,
              item_description: "",
              site_need_date: null,
              status: "on_track",
              updated_at: null,
              ...patch,
            });
        }
        return next;
      });
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(etasKey, ctx.prev);
      const code = vendorPortalErrorCode(e);
      toast.error(PROPOSE_DELIVERY_ERRORS[code] ?? "Could not submit your proposal");
    },
    onSuccess: (res) => {
      toast.success(
        `Proposed delivery for ${res.updated} line${res.updated === 1 ? "" : "s"} — awaiting procurement confirmation`,
      );
      setDialogPo(null);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: etasKey });
    },
  });

  if (memberships.isLoading || pos.isLoading) return <VendorTableSkeleton rows={5} />;
  if (pos.error) {
    const code = vendorPortalErrorCode(pos.error);
    return code === "vendor_portal_access_denied" ? (
      <VendorStateCard
        icon={Lock}
        title="Access expired or revoked"
        description="Your access to this vendor account is no longer active. Please contact your EPC representative."
      />
    ) : code?.endsWith("_not_exposed") ? (
      <VendorStateCard
        icon={Lock}
        title="Not shared with you"
        description="Your EPC contact hasn’t shared delivery scheduling with your account."
      />
    ) : (
      <VendorStateCard
        title="Couldn’t load deliveries"
        description="Something went wrong. Please try again."
        onRetry={() => void pos.refetch()}
      />
    );
  }
  if (membership && !membership.exposure.deliveries) {
    return (
      <VendorStateCard
        icon={Lock}
        title="Not shared with you"
        description="Your EPC contact hasn’t shared delivery scheduling with your account."
      />
    );
  }


  const openPos = (pos.data ?? []).filter((p) => p.status !== "closed" && p.status !== "cancelled");

  return (
    <div className="page-shell">
      <PageHeader
        title="Delivery scheduling"
        description="Propose delivery dates for your open purchase order lines. Procurement confirms each ETA."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/vendor/$vendorId" params={{ vendorId }}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Dashboard
            </Link>
          </Button>
        }
      />

      {openPos.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No open purchase orders"
          description="Delivery scheduling appears here once a purchase order is issued to you."
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

      <ProposeDialog
        po={dialogPo}
        etaByKey={etaByKey}
        submitting={propose.isPending}
        onClose={() => setDialogPo(null)}
        onSubmit={(poId, poIssueDate, lines) => propose.mutate({ poId, poIssueDate, lines })}
      />
    </div>
  );
}

function issueDateOf(po: VendorPoRow): string | null {
  const raw = po.issued_at ?? null;
  return raw ? raw.slice(0, 10) : null;
}

function ConfirmationChip({ eta }: { eta: VendorLineEtaRow | undefined }) {
  if (!eta?.current_eta) {
    return <span className="text-xs text-muted-foreground">No ETA proposed</span>;
  }
  if (eta.eta_confirmed) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        ETA confirmed
      </Badge>
    );
  }
  if (isCounterProposedNote(eta.notes)) {
    return <Badge className="bg-accent text-accent-foreground">Counter-proposed</Badge>;
  }
  return (
    <Badge variant="outline" className="gap-1">
      <CalendarClock className="h-3 w-3" />
      Awaiting procurement confirmation
    </Badge>
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
  const [open, setOpen] = useState(true);
  const lines = parsePoLines(po.lines);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <CollapsibleTrigger className="flex items-center gap-2 text-left">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden
            />
            <span className="font-mono text-sm">{po.po_number}</span>
            <span className="text-xs text-muted-foreground">
              {lines.length} line{lines.length === 1 ? "" : "s"} · issued{" "}
              {po.issued_at ? formatDate(po.issued_at) : "—"}
            </span>
          </CollapsibleTrigger>
          <Button size="sm" onClick={onPropose} disabled={lines.length === 0}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Propose delivery
          </Button>
        </div>
        <CollapsibleContent>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Line</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Site need</TableHead>
                  <TableHead>Current ETA</TableHead>
                  <TableHead>Confirmation</TableHead>
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
                        {l.quantity}
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

function ProposeDialog({
  po,
  etaByKey,
  submitting,
  onClose,
  onSubmit,
}: {
  po: VendorPoRow | null;
  etaByKey: Map<string, VendorLineEtaRow>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (
    poId: string,
    poIssueDate: string | null,
    lines: Array<{
      line_no: number;
      proposed_date: string;
      proposed_qty?: number | null;
      note?: string | null;
    }>,
  ) => void;
}) {
  const lines: PoLine[] = po ? parsePoLines(po.lines) : [];
  const issueDate = po ? issueDateOf(po) : null;
  const [draft, setDraft] = useState<Record<number, DraftRow>>({});
  const [touchedPo, setTouchedPo] = useState<string | null>(null);

  if (po && touchedPo !== po.id) {
    setTouchedPo(po.id);
    setDraft(
      Object.fromEntries(
        lines.map((l) => [
          l.line_no,
          {
            line_no: l.line_no,
            proposed_date: etaByKey.get(`${po.id}:${l.line_no}`)?.current_eta ?? "",
            proposed_qty: "",
            note: "",
          } satisfies DraftRow,
        ]),
      ),
    );
  }

  const rows = Object.values(draft).filter((r) => r.proposed_date.trim() !== "");
  const errors = rows.map((r) => validateProposedDate(r.proposed_date, issueDate));
  const firstError = errors.find(Boolean) ?? null;

  return (
    <Dialog open={!!po} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Propose delivery dates — {po?.po_number}</DialogTitle>
          <DialogDescription>
            Enter a proposed delivery date per line. Procurement reviews and confirms each ETA.
            {issueDate ? ` Dates cannot be earlier than the PO issue date (${issueDate}).` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Line</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-44">Proposed date</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const row = draft[l.line_no];
                const err = row?.proposed_date
                  ? validateProposedDate(row.proposed_date, issueDate)
                  : null;
                return (
                  <TableRow key={l.line_no}>
                    <TableCell className="font-mono text-xs">{l.line_no}</TableCell>
                    <TableCell className="text-sm">{l.description}</TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        min={issueDate ?? undefined}
                        value={row?.proposed_date ?? ""}
                        aria-label={`Proposed date for line ${l.line_no}`}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: {
                              ...(d[l.line_no] ?? {
                                line_no: l.line_no,
                                proposed_qty: "",
                                note: "",
                                proposed_date: "",
                              }),
                              proposed_date: e.target.value,
                            },
                          }))
                        }
                        className="h-8"
                      />
                      {err ? (
                        <p className="pt-1 text-[10px] text-destructive">
                          {PROPOSE_DELIVERY_ERRORS[err]}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={row?.proposed_qty ?? ""}
                        aria-label={`Proposed quantity for line ${l.line_no}`}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: { ...d[l.line_no], proposed_qty: e.target.value },
                          }))
                        }
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row?.note ?? ""}
                        maxLength={500}
                        aria-label={`Note for line ${l.line_no}`}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [l.line_no]: { ...d[l.line_no], note: e.target.value },
                          }))
                        }
                        className="h-8"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            disabled={submitting || rows.length === 0 || !!firstError}
            onClick={() =>
              po &&
              onSubmit(
                po.id,
                issueDate,
                rows.map((r) => ({
                  line_no: r.line_no,
                  proposed_date: r.proposed_date,
                  proposed_qty: r.proposed_qty.trim() === "" ? null : Number(r.proposed_qty),
                  note: r.note.trim() === "" ? null : r.note.trim(),
                })),
              )
            }
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
