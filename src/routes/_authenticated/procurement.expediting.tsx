// P-068 — Expediting workbench.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Download, MessageSquare, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { ExpeditingStatusBadge } from "@/components/procurement/expediting-status-badge";
import {
  deleteExpediting,
  getExpeditingAccess,
  getLongLeadKpi,
  importFromPo,
  listExpediting,
  listOpenPosForExpediting,
  logVendorContact,
  updateExpediting,
  confirmEta,
  counterProposeEta,
  type ExpeditingRow,
} from "@/lib/expediting.functions";
import { daysUntilNeed, EXPEDITING_STATUSES, type ExpeditingStatus } from "@/lib/expediting-rules";
import { isCounterProposedNote, isVendorProposedNote } from "@/lib/vendor-portal.rules";
import {
  errorMessage,
  expeditingAccessQueryOptions,
  expeditingListQueryOptions,
  longLeadKpiQueryOptions,
  openPosForExpeditingQueryOptions,
} from "@/lib/expediting-query";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/procurement/expediting")({
  head: () => ({
    meta: [
      { title: "Expediting — GridMind EPC" },
      {
        name: "description",
        content:
          "Chase deliveries against site-need dates. Track long-lead items, ETAs, and the Stage-3 procurement exit gate.",
      },
      { property: "og:title", content: "Expediting — GridMind EPC" },
      {
        property: "og:description",
        content: "Delivery expediting workbench for long-lead procurement items.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpeditingPage,
  errorComponent: ExpeditingError,
  pendingComponent: ExpeditingPending,
});

function ExpeditingError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Failed to load expediting log</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}

function ExpeditingPending() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function ExpeditingPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listExpediting);
  const kpiFn = useServerFn(getLongLeadKpi);
  const accessFn = useServerFn(getExpeditingAccess);
  const openPosFn = useServerFn(listOpenPosForExpediting);
  const updateFn = useServerFn(updateExpediting);
  const contactFn = useServerFn(logVendorContact);
  const importFn = useServerFn(importFromPo);
  const deleteFn = useServerFn(deleteExpediting);
  const confirmEtaFn = useServerFn(confirmEta);
  const counterEtaFn = useServerFn(counterProposeEta);

  const [statusFilter, setStatusFilter] = useState<ExpeditingStatus | "all">("all");
  const [longLeadOnly, setLongLeadOnly] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data: access } = useSuspenseQuery(expeditingAccessQueryOptions(accessFn));
  const { data: rows } = useSuspenseQuery(
    expeditingListQueryOptions(listFn, {
      status: statusFilter === "all" ? null : statusFilter,
    }),
  );
  const { data: kpi } = useSuspenseQuery(longLeadKpiQueryOptions(kpiFn));

  const filteredRows = useMemo(
    () => (longLeadOnly ? rows.filter((r) => r.is_long_lead) : rows),
    [rows, longLeadOnly],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { projectName: string; items: ExpeditingRow[] }>();
    for (const r of filteredRows) {
      const key = r.project_id;
      if (!map.has(key)) map.set(key, { projectName: r.project_name ?? "—", items: [] });
      map.get(key)!.items.push(r);
    }
    return Array.from(map.entries());
  }, [filteredRows]);

  const openCount = rows.filter((r) => r.status !== "delivered").length;
  const delayedCount = rows.filter((r) => r.status === "delayed").length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expediting"] });
  };

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; patch: Record<string, unknown> }) =>
      updateFn({ data: vars as any }),
    onSuccess: () => {
      invalidate();
      toast.success("Updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const contactMutation = useMutation({
    mutationFn: (id: string) => contactFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Vendor contact logged");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmEtaFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("ETA confirmed — vendor notified");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const counterMutation = useMutation({
    mutationFn: (vars: { id: string; eta: string; comment: string }) =>
      counterEtaFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Counter-proposal sent to vendor");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Item removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const importMutation = useMutation({
    mutationFn: (vars: { poId: string; longLeadLineNos: number[] }) => importFn({ data: vars }),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["expediting", "open-pos"] });
      toast.success(
        `Imported ${res.imported} item${res.imported === 1 ? "" : "s"}` +
          (res.skipped > 0 ? ` · ${res.skipped} skipped` : ""),
      );
      setImportOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function exportCsv() {
    const headers = [
      "Project",
      "PO",
      "Item",
      "Long-lead",
      "Promised",
      "Window start",
      "Window end",
      "Site need",
      "ETA",
      "ETA confirmed",
      "Status",
      "Days until need",
      "Last vendor contact",
    ];
    const data = filteredRows.map((r) => [
      r.project_name ?? "",
      r.po_number ?? "",
      r.item_description,
      r.is_long_lead ? "yes" : "no",
      r.promised_delivery_date ?? "",
      r.delivery_window_start ?? "",
      r.delivery_window_end ?? "",
      r.site_need_date,
      r.current_eta ?? "",
      r.eta_confirmed ? "yes" : "no",
      r.status,
      daysUntilNeed(r.site_need_date) ?? "",
      r.last_vendor_contact_at ?? "",
    ]);
    downloadCsv(`expediting-${format(new Date(), "yyyyMMdd")}.csv`, toCsv(headers, data));
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Expediting log"
        description="Chase deliveries against site-need dates and the Stage-3 exit gate."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            {access.canWrite ? (
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add from PO
                  </Button>
                </DialogTrigger>
                <ImportFromPoDialog
                  openPosFn={openPosFn}
                  onImport={(poId, longLeadLineNos) =>
                    importMutation.mutate({ poId, longLeadLineNos })
                  }
                  submitting={importMutation.isPending}
                />
              </Dialog>
            ) : null}
          </>
        }
      />

      <TooltipProvider>
        <KpiGrid columns={3}>
          <KpiTile label="Open items" value={String(openCount)} hint="Not yet delivered" />
          <KpiTile
            label="Delayed"
            value={String(delayedCount)}
            hint="ETA past site-need date"
            status={delayedCount > 0 ? "bad" : "neutral"}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <KpiTile
                  label="Long-lead ready"
                  value={
                    kpi.total === 0 ? "—" : `${kpi.ready}/${kpi.total} · ${kpi.pct.toFixed(0)}%`
                  }
                  hint="Delivered or ETA confirmed"
                  status={
                    kpi.total === 0
                      ? "neutral"
                      : kpi.band === "green"
                        ? "good"
                        : kpi.band === "amber"
                          ? "warning"
                          : "bad"
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Procure → Plan exit gate (≥95%)</TooltipContent>
          </Tooltip>
        </KpiGrid>
      </TooltipProvider>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as ExpeditingStatus | "all")}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {EXPEDITING_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={longLeadOnly} onCheckedChange={(v) => setLongLeadOnly(!!v)} />
          Long-lead only
        </label>
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No items being expedited"
          description="Import lines from an approved PO to begin."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([projectId, group]) => (
            <section
              key={projectId}
              className="rounded-md border border-border"
              aria-label={`Project ${group.projectName}`}
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="font-medium">{group.projectName}</div>
                <div className="text-xs text-muted-foreground">
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Promised</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Site need</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Countdown</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((r) => (
                    <ExpeditingRowUI
                      key={r.id}
                      row={r}
                      canWrite={access.canWrite}
                      onPatch={(patch) => updateMutation.mutate({ id: r.id, patch })}
                      onLogContact={() => contactMutation.mutate(r.id)}
                      onDelete={() => deleteMutation.mutate(r.id)}
                      onConfirmEta={() => confirmMutation.mutate(r.id)}
                      onCounterPropose={(eta, comment) =>
                        counterMutation.mutate({ id: r.id, eta, comment })
                      }

                    />
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = "muted",
  progress = null,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "muted" | "green" | "amber" | "destructive";
  progress?: number | null;
}) {
  const barClass =
    tone === "green"
      ? "bg-primary"
      : tone === "amber"
        ? "bg-secondary"
        : tone === "destructive"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  const valueClass =
    tone === "green"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${valueClass}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
      {progress != null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${barClass}`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function CountdownChip({ siteNeedDate }: { siteNeedDate: string }) {
  const days = daysUntilNeed(siteNeedDate);
  if (days == null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone =
    days < 0
      ? "text-destructive"
      : days <= 7
        ? "text-destructive"
        : days <= 21
          ? "text-secondary-foreground"
          : "text-muted-foreground";
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`;
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

function ExpeditingRowUI({
  row,
  canWrite,
  onPatch,
  onLogContact,
  onDelete,
  onConfirmEta,
  onCounterPropose,
}: {
  row: ExpeditingRow;
  canWrite: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onLogContact: () => void;
  onDelete: () => void;
  onConfirmEta: () => void;
  onCounterPropose: (eta: string, comment: string) => void;
}) {
  const [eta, setEta] = useState(row.current_eta ?? "");
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterEta, setCounterEta] = useState(row.current_eta ?? "");
  const [counterComment, setCounterComment] = useState("");
  const vendorProposed = isVendorProposedNote(row.notes) && !row.eta_confirmed;

  const commitEta = () => {
    const next = eta.trim() === "" ? null : eta;
    if (next === row.current_eta) return;
    onPatch({ current_eta: next });
  };


  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{row.item_description}</div>
        <div className="flex items-center gap-2 pt-1">
          {row.is_long_lead ? (
            <Badge variant="secondary" className="text-[10px]">
              Long lead
            </Badge>
          ) : null}
          {row.last_vendor_contact_at ? (
            <span className="text-[10px] text-muted-foreground">
              Contact {format(new Date(row.last_vendor_contact_at), "PP")}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">No contact yet</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Link
          to="/procurement/pos/$poId"
          params={{ poId: row.po_id }}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {row.po_number ?? "PO"}
        </Link>
        {row.po_line_no ? (
          <div className="text-[10px] text-muted-foreground">Line {row.po_line_no}</div>
        ) : null}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.promised_delivery_date ? format(new Date(row.promised_delivery_date), "PP") : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.delivery_window_start && row.delivery_window_end
          ? `${format(new Date(row.delivery_window_start), "MMM d")} – ${format(
              new Date(row.delivery_window_end),
              "MMM d",
            )}`
          : "—"}
      </TableCell>
      <TableCell className="text-xs">{format(new Date(row.site_need_date), "PP")}</TableCell>
      <TableCell>
        <Input
          type="date"
          value={eta}
          disabled={!canWrite}
          onChange={(e) => setEta(e.target.value)}
          onBlur={commitEta}
          className="h-8 w-36"
          aria-label="Current ETA"
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Switch
            checked={row.eta_confirmed}
            disabled={!canWrite}
            onCheckedChange={(v) => onPatch({ eta_confirmed: !!v })}
            aria-label="ETA confirmed"
          />
          {vendorProposed ? (
            <Badge className="bg-accent text-[10px] text-accent-foreground">
              Vendor-proposed ETA
            </Badge>
          ) : null}
          {isCounterProposedNote(row.notes) && !row.eta_confirmed ? (
            <span className="text-[10px] text-muted-foreground">Counter-proposed</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <ExpeditingStatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        <CountdownChip siteNeedDate={row.site_need_date} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1">
          {canWrite && vendorProposed ? (
            <>
              <Button variant="outline" size="sm" onClick={onConfirmEta}>
                Confirm ETA
              </Button>
              <Dialog open={counterOpen} onOpenChange={setCounterOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Counter
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Counter-propose delivery date</DialogTitle>
                    <DialogDescription>
                      The vendor is notified and the ETA stays unconfirmed until they agree.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor={`counter-eta-${row.id}`}>Proposed ETA</Label>
                      <Input
                        id={`counter-eta-${row.id}`}
                        type="date"
                        value={counterEta}
                        onChange={(e) => setCounterEta(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`counter-note-${row.id}`}>Comment</Label>
                      <Input
                        id={`counter-note-${row.id}`}
                        value={counterComment}
                        onChange={(e) => setCounterComment(e.target.value)}
                        placeholder="Why this date works better"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCounterOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={!counterEta || counterComment.trim() === ""}
                      onClick={() => {
                        onCounterPropose(counterEta, counterComment.trim());
                        setCounterOpen(false);
                        setCounterComment("");
                      }}
                    >
                      Send counter-proposal
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!canWrite}
            onClick={onLogContact}
            title="Log vendor contact"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
          {canWrite ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Remove this expediting item?")) onDelete();
              }}
              title="Remove"
            >
              <CheckCircle2 className="h-4 w-4 opacity-0" />
              <span className="text-xs text-muted-foreground">Remove</span>
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>

  );
}

function ImportFromPoDialog({
  openPosFn,
  onImport,
  submitting,
}: {
  openPosFn: ReturnType<typeof useServerFn<typeof listOpenPosForExpediting>>;
  onImport: (poId: string, longLeadLineNos: number[]) => void;
  submitting: boolean;
}) {
  const { data: pos } = useSuspenseQuery(openPosForExpeditingQueryOptions(openPosFn));
  const [poId, setPoId] = useState<string>("");
  const [longLead, setLongLead] = useState<Set<number>>(new Set());

  const selected = pos.find((p) => p.id === poId);

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Add items from a purchase order</DialogTitle>
        <DialogDescription>
          Import the PO's lines into the expediting log. Existing lines are skipped automatically.
          Flag transformers, modules, and other long-lead items so they roll up into the Stage-3
          exit-gate KPI.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wide">Purchase order</Label>
          <Select value={poId} onValueChange={setPoId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick an approved / issued PO" />
            </SelectTrigger>
            <SelectContent>
              {pos.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">No open POs available</div>
              ) : (
                pos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.po_number} · {p.vendor_name ?? "—"} · {p.project_name ?? "—"}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {selected ? (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Long-lead</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Site need</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.lines.map((l) => (
                  <TableRow key={l.line_no}>
                    <TableCell>
                      <Checkbox
                        checked={longLead.has(l.line_no)}
                        onCheckedChange={(v) => {
                          setLongLead((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(l.line_no);
                            else next.delete(l.line_no);
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.line_no}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right">
                      {l.qty} {l.uom}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.site_need_date ?? selected.required_by_date ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button disabled={!poId || submitting} onClick={() => onImport(poId, Array.from(longLead))}>
          {submitting ? "Importing…" : "Import lines"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
