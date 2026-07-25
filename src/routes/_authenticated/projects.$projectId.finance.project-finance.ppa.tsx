// P-082 — PPA terms tab.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { upsertPpaTerms } from "@/lib/ppa.functions";
import {
  ppaContractsQueryOptions,
  ppaListQueryOptions,
  projectFinanceAccessQueryOptions,
  projectFinanceErrorMessage,
} from "@/lib/project-finance.query";
import {
  ppaYearOneRevenue,
  type PpaRow,
} from "@/lib/project-finance.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/project-finance/ppa",
)({
  head: () => ({
    meta: [
      { title: "PPA terms — GridMind EPC" },
      {
        name: "description",
        content:
          "Power purchase agreement terms — counterparty, tariff, escalation, LDs.",
      },
      { property: "og:title", content: "PPA terms — GridMind EPC" },
      {
        property: "og:description",
        content: "PPA terms: tariff, escalation, capacity, availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        ppaListQueryOptions(params.projectId),
      ),
      context.queryClient.ensureQueryData(
        ppaContractsQueryOptions(params.projectId),
      ),
      context.queryClient.ensureQueryData(projectFinanceAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <Card className="p-4">
      <p className="text-sm text-destructive">
        {projectFinanceErrorMessage(error)}
      </p>
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
  component: PpaTab,
});

function money(n: number, code = "USD") {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  });
}

function PpaTab() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(ppaListQueryOptions(projectId));
  const contracts = useSuspenseQuery(ppaContractsQueryOptions(projectId));
  const access = useSuspenseQuery(projectFinanceAccessQueryOptions());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PpaRow | null>(null);

  const rows = list.data.rows;
  const portfolioYear1 = useMemo(
    () => rows.reduce((s, r) => s + ppaYearOneRevenue(r.tariff, r.annual_energy_mwh), 0),
    [rows],
  );
  const primaryCurrency = rows[0]?.currency_code ?? "USD";

  const exportCsv = () => {
    const header = [
      "name",
      "counterparty",
      "term_years",
      "tariff",
      "currency",
      "escalation_pct",
      "capacity_mw",
      "annual_energy_mwh",
      "availability_target_pct",
      "year1_revenue",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          JSON.stringify(r.name),
          JSON.stringify(r.counterparty ?? ""),
          r.term_years,
          r.tariff,
          r.currency_code,
          r.escalation_pct,
          r.capacity_mw ?? "",
          r.annual_energy_mwh ?? "",
          r.availability_target_pct ?? "",
          ppaYearOneRevenue(r.tariff, r.annual_energy_mwh),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `ppa-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Portfolio year-1 revenue
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {money(portfolioYear1, primaryCurrency)}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Across {rows.length} PPA{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rows.length === 0 ? "No PPAs yet." : `${rows.length} agreement(s)`}
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
              <Plus className="mr-2 size-4" /> New PPA
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Add the first power purchase agreement for this project.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead className="text-right">Term</TableHead>
                <TableHead className="text-right">Tariff</TableHead>
                <TableHead className="text-right">Capacity MW</TableHead>
                <TableHead className="text-right">Annual MWh</TableHead>
                <TableHead className="text-right">Year-1 revenue</TableHead>
                <TableHead className="text-right">Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => {
                    if (!access.data.canWrite) return;
                    setEditing(r);
                    setOpen(true);
                  }}
                >
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.counterparty ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.term_years}y
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.tariff.toLocaleString(undefined, {
                      style: "currency",
                      currency: r.currency_code,
                      maximumFractionDigits: 4,
                    })}
                    /MWh
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.capacity_mw?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.annual_energy_mwh?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {money(
                      ppaYearOneRevenue(r.tariff, r.annual_energy_mwh),
                      r.currency_code,
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.availability_target_pct == null ? (
                      "—"
                    ) : (
                      <Badge variant="outline">
                        {r.availability_target_pct}%
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {open ? (
        <PpaDrawer
          projectId={projectId}
          initial={editing}
          contracts={contracts.data.contracts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface PpaDrawerProps {
  projectId: string;
  initial: PpaRow | null;
  contracts: Array<{
    id: string;
    contract_number: string;
    title: string;
    currency_code: string | null;
  }>;
  onClose: () => void;
}

function PpaDrawer({ projectId, initial, contracts, onClose }: PpaDrawerProps) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertPpaTerms);

  const [name, setName] = useState(initial?.name ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [contractId, setContractId] = useState<string>(
    initial?.contract_id ?? "",
  );
  const [termYears, setTermYears] = useState(String(initial?.term_years ?? 25));
  const [tariff, setTariff] = useState(String(initial?.tariff ?? "55"));
  const [currency, setCurrency] = useState(initial?.currency_code ?? "USD");
  const [escalation, setEscalation] = useState(
    String(initial?.escalation_pct ?? 0),
  );
  const [capacity, setCapacity] = useState(
    initial?.capacity_mw == null ? "" : String(initial.capacity_mw),
  );
  const [energy, setEnergy] = useState(
    initial?.annual_energy_mwh == null ? "" : String(initial.annual_energy_mwh),
  );
  const [availability, setAvailability] = useState(
    initial?.availability_target_pct == null
      ? ""
      : String(initial.availability_target_pct),
  );
  const [ldEntries, setLdEntries] = useState<Array<[string, string]>>(() => {
    const src = initial?.liquidated_damages ?? {};
    return Object.entries(src).map(([k, v]) => [k, String(v ?? "")]);
  });
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const yearOne = ppaYearOneRevenue(Number(tariff || 0), Number(energy || 0));

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: initial?.id,
          project_id: projectId,
          name,
          counterparty: counterparty || null,
          contract_id: contractId || null,
          term_years: parseInt(termYears || "0", 10),
          tariff: Number(tariff || 0),
          currency_code: currency,
          escalation_pct: Number(escalation || 0),
          capacity_mw: capacity ? Number(capacity) : null,
          annual_energy_mwh: energy ? Number(energy) : null,
          availability_target_pct: availability ? Number(availability) : null,
          liquidated_damages: Object.fromEntries(
            ldEntries.filter(([k]) => k.trim().length > 0),
          ),
          notes: notes || null,
        },
      }),
    onSuccess: async () => {
      toast.success(initial ? "PPA updated" : "PPA created");
      await qc.invalidateQueries({ queryKey: ["pf", "ppa", projectId] });
      onClose();
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  const canSave =
    name.trim().length > 0 &&
    Number(tariff) >= 0 &&
    parseInt(termYears || "0", 10) > 0 &&
    currency.length === 3;

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit PPA" : "New PPA"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Counterparty</Label>
              <Input
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Linked contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No signed/active contracts on this project.
                    </div>
                  ) : (
                    contracts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.contract_number} — {c.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Term (years)</Label>
              <Input
                type="number"
                min="1"
                value={termYears}
                onChange={(e) => setTermYears(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tariff / MWh</Label>
              <Input
                type="number"
                step="0.0001"
                value={tariff}
                onChange={(e) => setTariff(e.target.value)}
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
              <Label>Escalation %</Label>
              <Input
                type="number"
                step="0.01"
                value={escalation}
                onChange={(e) => setEscalation(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Capacity MW</Label>
              <Input
                type="number"
                step="0.001"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Availability %</Label>
              <Input
                type="number"
                step="0.01"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Annual energy (MWh)</Label>
            <Input
              type="number"
              step="0.01"
              value={energy}
              onChange={(e) => setEnergy(e.target.value)}
            />
          </div>

          <Card className="bg-primary/5 border-primary/20 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Year-1 revenue (tariff × annual energy)
            </div>
            <div className="text-xl font-semibold tabular-nums">
              {money(yearOne, currency || "USD")}
            </div>
          </Card>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label>Liquidated damages</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLdEntries((e) => [...e, ["", ""]])}
              >
                <Plus className="mr-1 size-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {ldEntries.length === 0 ? (
                <div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Optional. Key/value pairs for LDs (e.g. `availability_shortfall: $50/MWh`).
                </div>
              ) : (
                ldEntries.map(([k, v], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Key"
                      value={k}
                      onChange={(e) => {
                        const next = [...ldEntries];
                        next[i] = [e.target.value, v];
                        setLdEntries(next);
                      }}
                    />
                    <Input
                      placeholder="Value"
                      value={v}
                      onChange={(e) => {
                        const next = [...ldEntries];
                        next[i] = [k, e.target.value];
                        setLdEntries(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setLdEntries((ee) => ee.filter((_, ix) => ix !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Saving…" : initial ? "Update" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
