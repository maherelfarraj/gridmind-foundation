// P-205 — Renew action + renewals timeline for the bond drawer.
import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  renewBondInstrument,
  uploadBondRenewalDocument,
  type BondDetailResult,
} from "@/lib/bonds.functions";
import { bondErrorMessage } from "@/lib/bonds.query";
import {
  RENEWABLE_STATUSES,
  isTerminalBondStatus,
  renewBondSchemaFor,
} from "@/lib/bonds.rules";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function BondRenewalSection({ detail }: { detail: BondDetailResult }) {
  const qc = useQueryClient();
  const instrument = detail.instrument;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [premium, setPremium] = useState("");
  const [notes, setNotes] = useState("");
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docName, setDocName] = useState<string | null>(null);

  const renewFn = useServerFn(renewBondInstrument);
  const uploadFn = useServerFn(uploadBondRenewalDocument);

  const canRenew =
    detail.can_write &&
    !isTerminalBondStatus(instrument.status) &&
    RENEWABLE_STATUSES.includes(instrument.effective_status);

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      buf.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      const res = await uploadFn({
        data: {
          instrument_id: instrument.id,
          filename: file.name,
          content_base64: btoa(binary),
          content_type: file.type || undefined,
        },
      });
      setDocPath(res.path);
      setDocName(file.name);
      toast.success("Renewal document uploaded.");
    } catch (err) {
      toast.error(bondErrorMessage(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function submit() {
    const parsed = renewBondSchemaFor(instrument.expiry_date).safeParse({
      instrument_id: instrument.id,
      new_expiry: newExpiry,
      premium_amount: premium ? Number(premium) : undefined,
      document_path: docPath ?? undefined,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renewFn({ data: parsed.data });
      toast.success("Instrument renewed — countdown re-armed.");
      await qc.invalidateQueries({ queryKey: ["bonds"] });
      setOpen(false);
      setNewExpiry("");
      setPremium("");
      setNotes("");
      setDocPath(null);
      setDocName(null);
    } catch (err) {
      setError(bondErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Renewals</h3>
        {canRenew ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
            Renew
          </Button>
        ) : null}
      </div>

      {detail.renewals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No renewals recorded.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {detail.renewals.map((r) => (
            <li key={r.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {r.previous_expiry ?? "—"}
                </span>
                <span className="text-xs text-muted-foreground">→</span>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                  {r.new_expiry ?? "—"}
                </span>
                {r.premium_amount !== null ? (
                  <span className="tabular-nums text-xs">
                    {money(r.premium_amount, instrument.currency_code)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {(r.renewed_at ?? "").slice(0, 10)}
                {r.renewed_by_name ? ` · ${r.renewed_by_name}` : ""}
                {r.notes ? ` · ${r.notes}` : ""}
              </p>
              {r.document_url ? (
                <a
                  className="text-xs text-primary underline"
                  href={r.document_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Renewal document
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renew instrument</DialogTitle>
            <DialogDescription>
              Current expiry {instrument.expiry_date ?? "—"}. The new expiry must be later; the
              expiry watchdog re-arms its 90/60/30/7-day notices from the new date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="renew-expiry">New expiry</Label>
              <Input
                id="renew-expiry"
                type="date"
                value={newExpiry}
                min={instrument.expiry_date ?? undefined}
                onChange={(e) => setNewExpiry(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="renew-premium">Premium amount (optional)</Label>
              <Input
                id="renew-premium"
                type="number"
                min="0"
                step="0.01"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="renew-doc">Renewal document (optional)</Label>
              <Input id="renew-doc" type="file" disabled={busy} onChange={handleUpload} />
              {docName ? (
                <p className="text-xs text-muted-foreground">Attached: {docName}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="renew-notes">Notes</Label>
              <Textarea
                id="renew-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button disabled={busy || !newExpiry} onClick={submit}>
              Confirm renewal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
