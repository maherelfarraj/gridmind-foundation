// P-080 — Debit notes workbench: list + create/edit drawer + workflow actions.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Ban, Check, FileText, Plus, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelDebitNote,
  issueDebitNote,
  settleDebitNote,
  upsertDebitNote,
} from "@/lib/debit-notes.functions";
import { debitNotesListQueryOptions } from "@/lib/debit-notes.query";
import {
  DEBIT_NOTE_REASONS,
  DEBIT_NOTE_STATUSES,
  DebitNoteUpsertSchema,
  debitNoteReasonLabel,
  debitNoteStatusLabel,
  type DebitNoteRow,
  type DebitNoteStatus,
} from "@/lib/debit-notes.rules";
import { invoiceErrorMessage } from "@/lib/invoices.query";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const Route = createFileRoute("/_authenticated/finance/debit-notes")({
  head: () => ({
    meta: [
      { title: "Debit notes — GridMind EPC" },
      {
        name: "description",
        content: "Issue and settle debit notes against vendor invoices and contracts.",
      },
      { property: "og:title", content: "Debit notes — GridMind EPC" },
      {
        property: "og:description",
        content: "Backcharges, defect rectifications and delay damages.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(debitNotesListQueryOptions());
  },
  component: DebitNotesPage,
});

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

const STATUS_VARIANT: Record<DebitNoteStatus, "default" | "secondary" | "outline" | "destructive"> =
  {
    draft: "outline",
    issued: "secondary",
    settled: "default",
    cancelled: "destructive",
  };

function DebitNotesPage() {
  const [status, setStatus] = useState<DebitNoteStatus | "all">("all");
  const [editing, setEditing] = useState<DebitNoteRow | null>(null);
  const [creating, setCreating] = useState(false);

  const filters = useMemo(() => ({ status: status === "all" ? undefined : status }), [status]);
  const listQ = useSuspenseQuery(debitNotesListQueryOptions(filters));
  const rows = listQ.data.rows;

  return (
    <div className="page-shell">
      <PageHeader
        title="Debit notes"
        description="Backcharges, defect rectifications and delay damages."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 size-4" /> New debit note
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {DEBIT_NOTE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {debitNoteStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        {listQ.isFetching && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No debit notes yet"
            description="Create one to charge back a vendor or record delay damages."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DN #</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Settled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.note_number}</TableCell>
                  <TableCell className="text-sm">{debitNoteReasonLabel(r.reason)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {debitNoteStatusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {fmt(r.amount, r.currency_code)}
                  </TableCell>
                  <TableCell className="text-sm">{r.issued_at ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.settled_at ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <DebitNoteSheet
        key={editing?.id ?? (creating ? "new" : "closed")}
        row={editing}
        open={creating || editing !== null}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
      />
    </div>
  );
}

function DebitNoteSheet({
  row,
  open,
  onOpenChange,
}: {
  row: DebitNoteRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertDebitNote);
  const issueFn = useServerFn(issueDebitNote);
  const settleFn = useServerFn(settleDebitNote);
  const cancelFn = useServerFn(cancelDebitNote);

  const form = useForm({
    resolver: zodResolver(DebitNoteUpsertSchema),
    defaultValues: {
      id: row?.id,
      project_id: row?.project_id ?? null,
      contract_id: row?.contract_id ?? null,
      invoice_id: row?.invoice_id ?? null,
      reason: (row?.reason ?? "backcharge") as (typeof DEBIT_NOTE_REASONS)[number],
      amount: row?.amount ?? 0,
      currency_code: row?.currency_code ?? "USD",
      notes: row?.notes ?? "",
    },
  });

  const editable = row === null || row.status === "draft";

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["debit-notes"] });
    await qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const save = useMutation({
    mutationFn: (values: any) => upsertFn({ data: values }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Debit note saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(invoiceErrorMessage(e)),
  });

  const issue = useMutation({
    mutationFn: () => issueFn({ data: { id: row!.id } }),
    onSuccess: async (r) => {
      await invalidate();
      toast.success(`Issued ${r.note_number}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(invoiceErrorMessage(e)),
  });

  const settle = useMutation({
    mutationFn: () => settleFn({ data: { id: row!.id } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Debit note settled");
      onOpenChange(false);
    },
    onError: (e) => toast.error(invoiceErrorMessage(e)),
  });

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { id: row!.id } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Debit note cancelled");
      onOpenChange(false);
    },
    onError: (e) => toast.error(invoiceErrorMessage(e)),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row ? row.note_number : "New debit note"}</SheetTitle>
          <SheetDescription>
            {row
              ? `Status: ${debitNoteStatusLabel(row.status)}`
              : "Draft a new backcharge or damages note."}
          </SheetDescription>
        </SheetHeader>

        <form className="mt-4 space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select
              disabled={!editable}
              value={form.watch("reason")}
              onValueChange={(v) => form.setValue("reason", v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEBIT_NOTE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {debitNoteReasonLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dn-amount">Amount</Label>
              <Input
                id="dn-amount"
                type="number"
                step="0.01"
                min={0}
                disabled={!editable}
                {...form.register("amount", { valueAsNumber: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dn-currency">Currency</Label>
              <Input
                id="dn-currency"
                maxLength={3}
                disabled={!editable}
                {...form.register("currency_code")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dn-contract">Contract ID (optional)</Label>
            <Input
              id="dn-contract"
              placeholder="uuid"
              disabled={!editable}
              value={form.watch("contract_id") ?? ""}
              onChange={(e) => form.setValue("contract_id", e.target.value.trim() || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dn-invoice">Invoice ID (optional)</Label>
            <Input
              id="dn-invoice"
              placeholder="uuid"
              disabled={!editable}
              value={form.watch("invoice_id") ?? ""}
              onChange={(e) => form.setValue("invoice_id", e.target.value.trim() || null)}
            />
            <p className="text-xs text-muted-foreground">Must link to a contract or an invoice.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dn-notes">Notes</Label>
            <Textarea
              id="dn-notes"
              rows={4}
              disabled={!editable}
              value={form.watch("notes") ?? ""}
              onChange={(e) => form.setValue("notes", e.target.value)}
            />
          </div>

          <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {row?.status === "draft" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  <Send className="mr-2 size-4" /> Issue
                </Button>
              )}
              {row?.status === "issued" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={settle.isPending}
                  onClick={() => settle.mutate()}
                >
                  <Check className="mr-2 size-4" /> Settle
                </Button>
              )}
              {row && (row.status === "draft" || row.status === "issued") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  <Ban className="mr-2 size-4" /> Cancel
                </Button>
              )}
            </div>
            {editable && (
              <Button type="submit" size="sm" disabled={save.isPending}>
                {save.isPending ? "Saving…" : row ? "Save" : "Create draft"}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
