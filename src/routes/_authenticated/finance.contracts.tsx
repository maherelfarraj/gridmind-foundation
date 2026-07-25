// P-078 — Contracts list route.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Plus, Search } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { upsertContract } from "@/lib/contracts.functions";
import {
  contractsAccessQueryOptions,
  contractsListQueryOptions,
  contractErrorMessage,
} from "@/lib/contracts.query";
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  ContractUpsertSchema,
  contractLabelForType,
  contractStatusLabel,
  type ContractRow,
  type ContractStatus,
} from "@/lib/contracts.rules";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/finance/contracts")({
  head: () => ({
    meta: [
      { title: "Contracts — GridMind EPC" },
      {
        name: "description",
        content:
          "Track EPC, PPA, supply and service contracts, schedule of values, and obligations across your portfolio.",
      },
      { property: "og:title", content: "Contracts — GridMind EPC" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContractsIndex,
  errorComponent: ContractsError,
});

function ContractsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">Couldn’t load contracts</h2>
      <p className="text-sm text-muted-foreground">{contractErrorMessage(error)}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

function statusVariant(
  s: ContractStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (s) {
    case "signed":
    case "active":
      return "default";
    case "draft":
    case "negotiation":
      return "outline";
    case "completed":
      return "secondary";
    case "terminated":
      return "destructive";
  }
}

function ContractsIndex() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [contractType, setContractType] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const list = useSuspenseQuery(
    contractsListQueryOptions({
      q: q || undefined,
      status: status === "all" ? undefined : status,
      contractType: contractType === "all" ? undefined : contractType,
    }),
  );
  const access = useSuspenseQuery(contractsAccessQueryOptions());
  const rows = list.data.rows;
  const canWrite = access.data.canWrite;

  const totalValue = useMemo(
    () => rows.reduce((a, r) => a + (r.value ?? 0), 0),
    [rows],
  );

  function exportCsv() {
    const csv = toCsv(
      ["Number", "Title", "Counterparty", "Type", "Status", "Value", "Currency", "Expiry"],
      rows.map((r) => [
        r.contract_number,
        r.title,
        r.counterparty,
        contractLabelForType(r.contract_type),
        contractStatusLabel(r.status),
        r.value ?? "",
        r.currency_code ?? "",
        r.expiry_date ?? "",
      ]),
    );
    downloadCsv(`contracts-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Contracts</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} contract{rows.length === 1 ? "" : "s"} · Total value{" "}
            {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 size-4" /> Export CSV
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button
                disabled={!canWrite}
                title={canWrite ? undefined : "Requires finance/legal/company admin"}
              >
                <Plus className="mr-2 size-4" /> New contract
              </Button>
            </DialogTrigger>
            <NewContractDialog onDone={() => setCreateOpen(false)} />
          </Dialog>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search number, title, counterparty"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={contractType} onValueChange={setContractType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CONTRACT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {contractLabelForType(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CONTRACT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {contractStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border">
        {list.isFetching && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <FileText className="size-8 text-muted-foreground" />
            <p className="font-medium">No contracts yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first contract to start tracking obligations.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <ContractRowView key={r.id} row={r} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function ContractRowView({ row }: { row: ContractRow }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <Link
          to="/finance/contracts/$contractId"
          params={{ contractId: row.id }}
          className="hover:underline"
        >
          {row.contract_number}
        </Link>
      </TableCell>
      <TableCell className="max-w-[280px] truncate">{row.title}</TableCell>
      <TableCell className="max-w-[200px] truncate">{row.counterparty}</TableCell>
      <TableCell>{contractLabelForType(row.contract_type)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.value == null
          ? "—"
          : `${row.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${row.currency_code ?? ""}`}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant(row.status)}>{contractStatusLabel(row.status)}</Badge>
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {row.expiry_date ?? "—"}
      </TableCell>
    </TableRow>
  );
}

const CreateFormSchema = ContractUpsertSchema.omit({ id: true, project_id: true });
type CreateFormValues = z.infer<typeof CreateFormSchema>;

function NewContractDialog({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertContract);
  const form = useForm<CreateFormValues>({
    resolver: zodResolver(CreateFormSchema),
    defaultValues: {
      title: "",
      contract_type: "epc",
      counterparty: "",
      value: undefined,
      currency_code: "USD",
      effective_date: null,
      expiry_date: null,
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: CreateFormValues) => upsert({ data: values }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["contracts", "list"] });
      toast.success("Contract created");
      onDone();
    },
    onError: (e) => toast.error(contractErrorMessage(e)),
  });

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New contract</DialogTitle>
        <DialogDescription>
          Contract number is generated automatically. You can add the schedule of values and
          upload the signed copy on the detail page.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-3"
      >
        <div className="space-y-1">
          <Label>Title</Label>
          <Input {...form.register("title")} placeholder="Wind Farm Alpha — EPC" />
        </div>
        <div className="space-y-1">
          <Label>Counterparty</Label>
          <Input {...form.register("counterparty")} placeholder="Acme Renewables Inc." />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={form.watch("contract_type")}
              onValueChange={(v) => form.setValue("contract_type", v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {contractLabelForType(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Input {...form.register("currency_code")} maxLength={3} />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Value</Label>
          <Input
            type="number"
            step="0.01"
            {...form.register("value", { valueAsNumber: true })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>Effective date</Label>
            <Input type="date" {...form.register("effective_date")} />
          </div>
          <div className="space-y-1">
            <Label>Expiry date</Label>
            <Input type="date" {...form.register("expiry_date")} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create contract"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
