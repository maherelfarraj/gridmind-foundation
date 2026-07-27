// P-204 — Claims tab + release / return / cancel actions for the bond drawer.
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  applyBondReleaseDecision,
  cancelBondInstrument,
  createBondClaim,
  requestBondRelease,
  resolveBondClaim,
  returnBondInstrument,
  submitBondClaim,
  type BondDetailResult,
} from "@/lib/bonds.functions";
import { bondErrorMessage } from "@/lib/bonds.query";
import {
  CLAIM_RESOLUTIONS,
  OPEN_CLAIM_STATUSES,
  RELEASABLE_STATUSES,
  isTerminalBondStatus,
  titleize,
} from "@/lib/bonds.rules";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function BondWorkflowSections({ detail }: { detail: BondDetailResult }) {
  const qc = useQueryClient();
  const instrument = detail.instrument;
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [reasonMode, setReasonMode] = useState<"release" | "return" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<(typeof CLAIM_RESOLUTIONS)[number]>("paid");
  const [notes, setNotes] = useState("");
  const [claimForm, setClaimForm] = useState({
    amount: "",
    currency_code: instrument.currency_code,
    reason: "",
    claim_date: new Date().toISOString().slice(0, 10),
  });

  const createClaimFn = useServerFn(createBondClaim);
  const submitClaimFn = useServerFn(submitBondClaim);
  const resolveClaimFn = useServerFn(resolveBondClaim);
  const requestReleaseFn = useServerFn(requestBondRelease);
  const applyDecisionFn = useServerFn(applyBondReleaseDecision);
  const returnFn = useServerFn(returnBondInstrument);
  const cancelFn = useServerFn(cancelBondInstrument);

  const canWrite = detail.can_write;
  const terminal = isTerminalBondStatus(instrument.status);
  const releasePending = detail.release_approval?.status === "pending";
  const hasOpenClaim = detail.claims.some((c) => OPEN_CLAIM_STATUSES.includes(c.status as never));

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await qc.invalidateQueries({ queryKey: ["bonds"] });
      return true;
    } catch (err) {
      toast.error(bondErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitReasonAction() {
    if (!reasonMode) return;
    const payload = { instrument_id: instrument.id, reason };
    const ok = await run(
      async () => {
        if (reasonMode === "release") await requestReleaseFn({ data: payload });
        else if (reasonMode === "return") await returnFn({ data: payload });
        else await cancelFn({ data: payload });
      },
      reasonMode === "release" ? "Release sent for approval." : "Instrument updated.",
    );
    if (ok) {
      setReasonMode(null);
      setReason("");
    }
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Claims</h3>
          {canWrite && !terminal ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setClaimOpen(true)}>
              New claim
            </Button>
          ) : null}
        </div>
        {detail.claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No claims against this instrument.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.claims.map((c) => (
              <li key={c.id} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.claim_number ?? "Claim"}</span>
                  <span className="tabular-nums">
                    {money(c.amount, c.currency_code ?? instrument.currency_code)}
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.claim_date ?? "—"}
                  {c.submitted_by ? " · submitted" : " · not submitted"}
                  {c.resolution_notes ? ` · ${c.resolution_notes}` : ""}
                </p>
                {canWrite ? (
                  <div className="mt-2 flex gap-2">
                    {c.status === "draft" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(() => submitClaimFn({ data: { claim_id: c.id } }), "Claim submitted.")
                        }
                      >
                        Submit claim
                      </Button>
                    ) : null}
                    {OPEN_CLAIM_STATUSES.includes(c.status as never) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setResolving(c.id);
                          setOutcome("paid");
                          setNotes("");
                        }}
                      >
                        Resolve
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Lifecycle actions</h3>
        {detail.release_approval ? (
          <p className="text-sm text-muted-foreground">
            {releasePending
              ? "Release pending approval — Finance then Legal."
              : `Release approval ${titleize(detail.release_approval.status)}.`}
          </p>
        ) : null}
        {!canWrite ? (
          <p className="text-sm text-muted-foreground">Read-only — you cannot change this bond.</p>
        ) : terminal ? (
          <p className="text-sm text-muted-foreground">
            Closed ({titleize(instrument.status)}) — no further transitions.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {RELEASABLE_STATUSES.includes(instrument.effective_status) && !releasePending ? (
              <Button size="sm" disabled={busy} onClick={() => setReasonMode("release")}>
                Request release
              </Button>
            ) : null}
            {detail.release_approval ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => applyDecisionFn({ data: { instrument_id: instrument.id } }),
                    "Approval checked.",
                  )
                }
              >
                Check approval
              </Button>
            ) : null}
            {instrument.instrument_type === "bid_bond" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || hasOpenClaim}
                onClick={() => setReasonMode("return")}
              >
                Return bid bond
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setReasonMode("cancel")}
            >
              Cancel / waive
            </Button>
          </div>
        )}
      </section>

      {/* New claim */}
      <Dialog open={claimOpen} onOpenChange={(v) => setClaimOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New claim</DialogTitle>
            <DialogDescription>
              A claim may not exceed {money(instrument.amount, instrument.currency_code)}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="claim-amount">Amount</Label>
              <Input
                id="claim-amount"
                type="number"
                min="0"
                step="0.01"
                value={claimForm.amount}
                onChange={(e) => setClaimForm({ ...claimForm, amount: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="claim-date">Claim date</Label>
              <Input
                id="claim-date"
                type="date"
                value={claimForm.claim_date}
                onChange={(e) => setClaimForm({ ...claimForm, claim_date: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="claim-reason">Reason</Label>
              <Textarea
                id="claim-reason"
                value={claimForm.reason}
                onChange={(e) => setClaimForm({ ...claimForm, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={async () => {
                const ok = await run(
                  () =>
                    createClaimFn({
                      data: {
                        instrument_id: instrument.id,
                        amount: Number(claimForm.amount),
                        currency_code: claimForm.currency_code,
                        reason: claimForm.reason,
                        claim_date: claimForm.claim_date,
                      },
                    }),
                  "Claim created as draft.",
                );
                if (ok) {
                  setClaimOpen(false);
                  setClaimForm({ ...claimForm, amount: "", reason: "" });
                }
              }}
            >
              Create claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve claim */}
      <Dialog open={Boolean(resolving)} onOpenChange={(v) => !v && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve claim</DialogTitle>
            <DialogDescription>
              Notes are mandatory when a claim is paid or rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAIM_RESOLUTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {titleize(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="resolution-notes">Resolution notes</Label>
              <Textarea
                id="resolution-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!resolving) return;
                const ok = await run(
                  () =>
                    resolveClaimFn({
                      data: {
                        claim_id: resolving,
                        outcome,
                        resolution_notes: notes || undefined,
                      },
                    }),
                  "Claim resolved.",
                );
                if (ok) setResolving(null);
              }}
            >
              Save outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reason-gated instrument actions */}
      <Dialog open={Boolean(reasonMode)} onOpenChange={(v) => !v && setReasonMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonMode === "release"
                ? "Request release"
                : reasonMode === "return"
                  ? "Return bid bond"
                  : "Cancel / waive instrument"}
            </DialogTitle>
            <DialogDescription>
              {reasonMode === "release"
                ? "Release runs through the Finance → Legal approval chain."
                : "This transition is final and fully audited."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="action-reason">Reason</Label>
            <Textarea
              id="action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button disabled={busy || reason.trim().length < 3} onClick={submitReasonAction}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
