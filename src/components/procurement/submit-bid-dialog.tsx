// P-063 — Submit-bid dialog (procurement records a vendor's quote).
import { useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BidRow } from "@/lib/rfq.functions";
import type { RfqLine } from "@/lib/rfq-rules";
import type { SubmitBidInput } from "@/lib/rfq-query";

interface FormValues {
  totalPrice: number | null;
  currencyCode: string;
  leadTimeDays: number | null;
  validityDate: string | null;
  lines: Array<{
    line_no: number;
    description: string;
    unit_price: number;
    qty: number;
    lead_time_days: number | null;
    exceptions: string | null;
  }>;
}

export function SubmitBidDialog({
  bid,
  rfqLines,
  currencyCode,
  onSubmit,
  trigger,
}: {
  bid: BidRow;
  rfqLines: RfqLine[];
  currencyCode: string;
  onSubmit: (input: SubmitBidInput) => Promise<unknown> | void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaults: FormValues = useMemo(() => {
    const bidLineByNo = new Map(bid.lines.map((l) => [l.line_no, l]));
    return {
      totalPrice: bid.total_price ?? null,
      currencyCode: bid.currency_code ?? currencyCode,
      leadTimeDays: bid.lead_time_days ?? null,
      validityDate: bid.validity_date ?? null,
      lines: rfqLines.map((l) => {
        const existing = bidLineByNo.get(l.line_no);
        return {
          line_no: l.line_no,
          description: l.description,
          unit_price: existing?.unit_price ?? 0,
          qty: existing?.qty ?? l.qty,
          lead_time_days: existing?.lead_time_days ?? null,
          exceptions: existing?.exceptions ?? null,
        };
      }),
    };
  }, [bid, rfqLines, currencyCode]);

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { fields } = useFieldArray({ control: form.control, name: "lines" });

  async function submit(values: FormValues) {
    setBusy(true);
    try {
      await onSubmit({
        bidId: bid.id,
        totalPrice: values.totalPrice,
        currencyCode: values.currencyCode,
        leadTimeDays: values.leadTimeDays,
        validityDate: values.validityDate,
        lines: values.lines.map((l) => ({
          line_no: Number(l.line_no),
          unit_price: Number(l.unit_price),
          qty: Number(l.qty),
          lead_time_days:
            l.lead_time_days == null || Number.isNaN(Number(l.lead_time_days))
              ? null
              : Number(l.lead_time_days),
          exceptions: l.exceptions || null,
        })),
      });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Record bid — {bid.vendor_name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(submit)}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Total price</Label>
              <Input
                type="number"
                step="any"
                {...form.register("totalPrice", {
                  setValueAs: (v) =>
                    v === "" || v == null ? null : Number(v),
                })}
              />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Input {...form.register("currencyCode")} maxLength={3} />
            </div>
            <div className="space-y-1">
              <Label>Lead time (days)</Label>
              <Input
                type="number"
                min={0}
                {...form.register("leadTimeDays", {
                  setValueAs: (v) =>
                    v === "" || v == null ? null : Number(v),
                })}
              />
            </div>
            <div className="space-y-1">
              <Label>Validity date</Label>
              <Input
                type="date"
                {...form.register("validityDate", {
                  setValueAs: (v) => (v === "" ? null : v),
                })}
              />
            </div>
          </div>

          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-28">Unit price</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-28">Lead (days)</TableHead>
                  <TableHead>Exceptions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field, idx) => (
                  <TableRow key={field.id}>
                    <TableCell>{(field as any).line_no}</TableCell>
                    <TableCell className="text-sm">
                      {(field as any).description}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        {...form.register(`lines.${idx}.unit_price` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        {...form.register(`lines.${idx}.qty` as const, {
                          valueAsNumber: true,
                        })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        {...form.register(
                          `lines.${idx}.lead_time_days` as const,
                          {
                            setValueAs: (v) =>
                              v === "" || v == null ? null : Number(v),
                          },
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        {...form.register(
                          `lines.${idx}.exceptions` as const,
                          { setValueAs: (v) => (v === "" ? null : v) },
                        )}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Attachment uploads land in the next iteration — bid save preserves any
            attachments already on the record.
          </p>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save bid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
