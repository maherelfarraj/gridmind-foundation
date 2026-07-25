// P-077 — Cash-flow entry dialog.
import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CASH_FLOW_CATEGORIES,
  CASH_FLOW_DIRECTIONS,
  CASH_FLOW_KINDS,
  CASH_FLOW_REFERENCE_TYPES,
  CATEGORY_LABELS,
  type CreateCashFlowInput,
} from "@/lib/cash-flow.rules";
import { currenciesQueryOptions } from "@/lib/cash-flow.query";

export function CashFlowEntryDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  baseCurrency: string;
  submitting: boolean;
  onSubmit: (input: CreateCashFlowInput) => Promise<void>;
}) {
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const currencies = useSuspenseQuery(currenciesQueryOptions());

  const [period, setPeriod] = useState(defaultPeriod);
  const [direction, setDirection] =
    useState<(typeof CASH_FLOW_DIRECTIONS)[number]>("outflow");
  const [kind, setKind] = useState<(typeof CASH_FLOW_KINDS)[number]>("forecast");
  const [category, setCategory] =
    useState<(typeof CASH_FLOW_CATEGORIES)[number]>("po_payment");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState(props.baseCurrency);
  const [referenceType, setReferenceType] =
    useState<(typeof CASH_FLOW_REFERENCE_TYPES)[number] | "none">("none");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (props.open) setCurrency(props.baseCurrency);
  }, [props.open, props.baseCurrency]);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) return;
    await props.onSubmit({
      projectId: props.projectId,
      period,
      direction,
      kind,
      category,
      amount: amt,
      currencyCode: currency,
      referenceType: referenceType === "none" ? undefined : referenceType,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add cash-flow entry</DialogTitle>
          <DialogDescription>
            FX rate is captured at entry time from the FX table — historical rows
            never restate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Direction</Label>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASH_FLOW_DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d} className="capitalize">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASH_FLOW_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASH_FLOW_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Month</Label>
              <Input
                type="date"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div>
              <Label>Reference</Label>
              <Select
                value={referenceType}
                onValueChange={(v) => setReferenceType(v as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {CASH_FLOW_REFERENCE_TYPES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.data.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context"
              rows={2}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Base currency: <span className="font-medium">{props.baseCurrency}</span>.
            Amounts are converted at the FX rate on or before the entry month.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
            disabled={props.submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={props.submitting || !amount || Number(amount) < 0}
          >
            {props.submitting ? "Saving…" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
