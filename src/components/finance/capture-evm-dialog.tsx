// P-076 — Capture EVM snapshot dialog.
import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { previewEvmSnapshot } from "@/lib/evm.functions";
import type { EvmComputation } from "@/lib/evm.rules";
import { indexHealth } from "@/lib/evm.rules";
import { evmErrorMessage } from "@/lib/evm.query";

export function CaptureEvmDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onCapture: (input: { snapshotDate: string; includeAccruals: boolean }) => Promise<void>;
  submitting: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [accruals, setAccruals] = useState(false);
  const [preview, setPreview] = useState<{ computation: EvmComputation; currency: string } | null>(
    null,
  );
  const [previewing, setPreviewing] = useState(false);

  const previewFn = useServerFn(previewEvmSnapshot);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setPreviewing(true);
    setPreview(null);
    previewFn({
      data: { projectId: props.projectId, snapshotDate: date, includeAccruals: accruals },
    })
      .then((r: any) => {
        if (!cancelled) setPreview(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) toast.error(evmErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.projectId, date, accruals, previewFn]);

  const c = preview?.computation;
  const currency = preview?.currency ?? "USD";
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  const spiHealth = indexHealth(c?.spi ?? null);
  const cpiHealth = indexHealth(c?.cpi ?? null);
  const healthColor = (h: string) =>
    h === "good"
      ? "text-emerald-500"
      : h === "warn"
        ? "text-amber-500"
        : h === "bad"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Capture EVM snapshot</DialogTitle>
          <DialogDescription>
            Snapshots are immutable — one per date. Confirm values below before saving.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="evm-date">Snapshot date</Label>
              <Input
                id="evm-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2">
                <Switch id="evm-accruals" checked={accruals} onCheckedChange={setAccruals} />
                <Label htmlFor="evm-accruals" className="text-sm">
                  Accrue uninvoiced commitments
                </Label>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-xs uppercase text-muted-foreground">Preview</div>
            {previewing || !c ? (
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Row label="BAC" value={fmt(c.bac)} />
                <Row label="PV" value={fmt(c.pv)} />
                <Row label="EV" value={fmt(c.ev)} />
                <Row label="AC" value={fmt(c.ac)} />
                <Row
                  label="SPI"
                  value={c.spi == null ? "—" : c.spi.toFixed(2)}
                  valueClass={healthColor(spiHealth)}
                />
                <Row
                  label="CPI"
                  value={c.cpi == null ? "—" : c.cpi.toFixed(2)}
                  valueClass={healthColor(cpiHealth)}
                />
                <Row label="EAC" value={c.eac == null ? "—" : fmt(c.eac)} />
                <Row label="Tasks" value={String(c.taskCount)} />
              </div>
            )}
          </div>
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
            onClick={() => props.onCapture({ snapshotDate: date, includeAccruals: accruals })}
            disabled={props.submitting || previewing || !c}
          >
            {props.submitting ? "Capturing…" : "Capture snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between rounded bg-muted/40 px-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-medium ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
