// P-082 — Bank facilities tab.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, isValid } from "date-fns";
import { Download, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { recordFacilityDrawdown, upsertBankFacility } from "@/lib/bank-facilities.functions";
import {
  bankFacilitiesQueryOptions,
  projectFinanceAccessQueryOptions,
  projectFinanceErrorMessage,
} from "@/lib/project-finance.query";
import {
  FACILITY_STATUSES,
  FACILITY_TYPES,
  facilityUtilizationPct,
  type BankFacilityRow,
  type Covenant,
  type FacilityStatus,
  type FacilityType,
} from "@/lib/project-finance.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/project-finance/facilities",
)({
  head: () => ({
    meta: [
      { title: "Bank facilities — GridMind EPC" },
      {
        name: "description",
        content: "Lender facilities, drawdowns, covenants and utilization for the project.",
      },
      { property: "og:title", content: "Bank facilities — GridMind EPC" },
      {
        property: "og:description",
        content: "Track bank facilities, drawdowns and covenants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(bankFacilitiesQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(projectFinanceAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <Card className="p-4">
      <p className="text-sm text-destructive">{projectFinanceErrorMessage(error)}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Card>
  ),
  pendingComponent: () => (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  ),
  component: FacilitiesTab,
});

function money(n: number, code = "USD") {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  });
}

function FacilitiesTab() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(bankFacilitiesQueryOptions(projectId));
  const access = useSuspenseQuery(projectFinanceAccessQueryOptions());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BankFacilityRow | null>(null);
  const [drawDialog, setDrawDialog] = useState<BankFacilityRow | null>(null);

  const rows = list.data.rows;
  const totals = useMemo(() => {
    const commitment = rows.reduce((s, r) => s + r.commitment_amount, 0);
    const drawn = rows.reduce((s, r) => s + r.drawn_amount, 0);
    return {
      commitment,
      drawn,
      utilization: facilityUtilizationPct(drawn, commitment),
    };
  }, [rows]);
  const primaryCurrency = rows[0]?.currency_code ?? "USD";

  const exportCsv = () => {
    const header = [
      "lender_name",
      "facility_type",
      "commitment_amount",
      "drawn_amount",
      "currency",
      "interest_rate_pct",
      "margin_pct",
      "maturity_date",
      "status",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          JSON.stringify(r.lender_name),
          r.facility_type,
          r.commitment_amount,
          r.drawn_amount,
          r.currency_code,
          r.interest_rate_pct ?? "",
          r.margin_pct ?? "",
          r.maturity_date ?? "",
          r.status,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `bank-facilities-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Portfolio utilization
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {totals.utilization.toFixed(1)}%
            </div>
          </div>
          <div className="text-sm text-muted-foreground tabular-nums">
            {money(totals.drawn, primaryCurrency)} drawn ·{" "}
            {money(totals.commitment, primaryCurrency)} committed
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rows.length === 0 ? "No facilities yet." : `${rows.length} facility(ies)`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 size-4" /> CSV
          </Button>
          {access.data.canWrite ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" /> New facility
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Add the first lender facility for this project.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lender</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Commitment</TableHead>
                <TableHead className="text-right">Drawn</TableHead>
                <TableHead>Utilization</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const util = facilityUtilizationPct(r.drawn_amount, r.commitment_amount);
                return (
                  <TableRow key={r.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => {
                          if (!access.data.canWrite) return;
                          setEditing(r);
                          setOpen(true);
                        }}
                      >
                        {r.lender_name}
                      </button>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {r.facility_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.commitment_amount, r.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(r.drawn_amount, r.currency_code)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.min(100, Math.max(0, util))}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {util.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.interest_rate_pct == null ? "—" : `${r.interest_rate_pct}%`}
                      {r.margin_pct != null ? ` +${r.margin_pct}%` : ""}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {r.maturity_date && isValid(new Date(r.maturity_date))
                        ? format(new Date(r.maturity_date), "dd MMM yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {access.data.canWrite && r.status === "active" ? (
                        <Button variant="ghost" size="sm" onClick={() => setDrawDialog(r)}>
                          <Wallet className="mr-1 size-3" /> Draw
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {open ? (
        <FacilityDrawer projectId={projectId} initial={editing} onClose={() => setOpen(false)} />
      ) : null}
      {drawDialog ? (
        <DrawdownDialog
          projectId={projectId}
          facility={drawDialog}
          onClose={() => setDrawDialog(null)}
        />
      ) : null}
    </div>
  );
}

interface FacilityDrawerProps {
  projectId: string;
  initial: BankFacilityRow | null;
  onClose: () => void;
}

function FacilityDrawer({ projectId, initial, onClose }: FacilityDrawerProps) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertBankFacility);

  const [lender, setLender] = useState(initial?.lender_name ?? "");
  const [type, setType] = useState<FacilityType>(initial?.facility_type ?? "term_loan");
  const [commitment, setCommitment] = useState(String(initial?.commitment_amount ?? 0));
  const [drawn, setDrawn] = useState(String(initial?.drawn_amount ?? 0));
  const [currency, setCurrency] = useState(initial?.currency_code ?? "USD");
  const [rate, setRate] = useState(
    initial?.interest_rate_pct == null ? "" : String(initial.interest_rate_pct),
  );
  const [margin, setMargin] = useState(
    initial?.margin_pct == null ? "" : String(initial.margin_pct),
  );
  const [maturity, setMaturity] = useState(initial?.maturity_date ?? "");
  const [status, setStatus] = useState<FacilityStatus>(
    (initial?.status as FacilityStatus) ?? "active",
  );
  const [covenants, setCovenants] = useState<Covenant[]>(initial?.covenants ?? []);

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: initial?.id,
          project_id: projectId,
          lender_name: lender,
          facility_type: type,
          commitment_amount: Number(commitment),
          drawn_amount: Number(drawn),
          currency_code: currency,
          interest_rate_pct: rate === "" ? null : Number(rate),
          margin_pct: margin === "" ? null : Number(margin),
          maturity_date: maturity || null,
          covenants,
          status,
        },
      }),
    onSuccess: async () => {
      toast.success(initial ? "Facility updated" : "Facility created");
      await qc.invalidateQueries({
        queryKey: ["pf", "facilities", projectId],
      });
      onClose();
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  const canSave =
    lender.trim().length > 0 &&
    Number(commitment) > 0 &&
    Number(drawn) <= Number(commitment) &&
    currency.length === 3;

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit facility" : "New facility"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Lender</Label>
              <Input value={lender} onChange={(e) => setLender(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as FacilityType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Commitment</Label>
              <Input
                type="number"
                step="0.01"
                value={commitment}
                onChange={(e) => setCommitment(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Drawn</Label>
              <Input
                type="number"
                step="0.01"
                value={drawn}
                onChange={(e) => setDrawn(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Currency</Label>
              <Input
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Rate %</Label>
              <Input
                type="number"
                step="0.001"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Margin %</Label>
              <Input
                type="number"
                step="0.001"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Maturity</Label>
              <Input
                type="date"
                value={maturity ?? ""}
                onChange={(e) => setMaturity(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as FacilityStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FACILITY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Covenants</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setCovenants((c) => [
                    ...c,
                    { name: "", threshold: "", measured_at: "", status: "" },
                  ])
                }
              >
                <Plus className="mr-1 size-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {covenants.length === 0 ? (
                <div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Optional. Name, threshold, measurement date, status.
                </div>
              ) : (
                covenants.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                    <Input
                      placeholder="Name"
                      value={c.name}
                      onChange={(e) => {
                        const next = [...covenants];
                        next[i] = { ...c, name: e.target.value };
                        setCovenants(next);
                      }}
                    />
                    <Input
                      placeholder="Threshold"
                      value={c.threshold == null ? "" : String(c.threshold)}
                      onChange={(e) => {
                        const next = [...covenants];
                        next[i] = { ...c, threshold: e.target.value };
                        setCovenants(next);
                      }}
                    />
                    <Input
                      type="date"
                      value={c.measured_at ?? ""}
                      onChange={(e) => {
                        const next = [...covenants];
                        next[i] = { ...c, measured_at: e.target.value };
                        setCovenants(next);
                      }}
                    />
                    <Input
                      placeholder="Status"
                      value={c.status ?? ""}
                      onChange={(e) => {
                        const next = [...covenants];
                        next[i] = { ...c, status: e.target.value };
                        setCovenants(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setCovenants((cc) => cc.filter((_, ix) => ix !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving…" : initial ? "Update" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface DrawdownDialogProps {
  projectId: string;
  facility: BankFacilityRow;
  onClose: () => void;
}

function DrawdownDialog({ projectId, facility, onClose }: DrawdownDialogProps) {
  const qc = useQueryClient();
  const draw = useServerFn(recordFacilityDrawdown);
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");

  const remaining = facility.commitment_amount - facility.drawn_amount;
  const num = Number(amount || 0);
  const wouldExceed = num > remaining + 0.005;

  const mut = useMutation({
    mutationFn: () =>
      draw({
        data: {
          id: facility.id,
          amount: num,
          note: note || undefined,
        },
      }),
    onSuccess: async () => {
      toast.success("Drawdown recorded");
      await qc.invalidateQueries({
        queryKey: ["pf", "facilities", projectId],
      });
      onClose();
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record drawdown — {facility.lender_name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="text-sm text-muted-foreground tabular-nums">
            Drawn {money(facility.drawn_amount, facility.currency_code)} of{" "}
            {money(facility.commitment_amount, facility.currency_code)} · remaining{" "}
            <span className="font-medium text-foreground">
              {money(remaining, facility.currency_code)}
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label>Amount ({facility.currency_code})</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {wouldExceed ? (
              <p className="text-xs text-destructive">Exceeds remaining commitment.</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={num <= 0 || wouldExceed || mut.isPending}
            onClick={() => mut.mutate()}
            className={cn(wouldExceed && "opacity-60")}
          >
            {mut.isPending ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
