// P-067 — Three-way match detail: variance breakdown, block banner, override.
import { useState } from "react";
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, FileText, Scale } from "lucide-react";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MatchStatusBadge } from "@/components/procurement/match-status-badge";
import { getMatch, getMatchWriteAccess } from "@/lib/match.functions";
import {
  matchDetailQueryOptions,
  matchWriteAccessQueryOptions,
  useOverrideMatch,
  useUpdateMatchThreshold,
} from "@/lib/match-query";

export const Route = createFileRoute("/_authenticated/procurement/matches/$matchId")({
  head: () => ({
    meta: [
      { title: "Invoice Match — GridMind EPC" },
      {
        name: "description",
        content: "Review a three-way match, variance breakdown, and payment release status.",
      },
    ],
  }),
  component: MatchDetail,
});

function formatCurrency(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function MatchDetail() {
  const { matchId } = useParams({
    from: "/_authenticated/procurement/matches/$matchId",
  });
  const navigate = useNavigate();
  const detailFn = useServerFn(getMatch);
  const accessFn = useServerFn(getMatchWriteAccess);
  const query = useSuspenseQuery(matchDetailQueryOptions(detailFn, matchId));
  const access = useSuspenseQuery(matchWriteAccessQueryOptions(accessFn));
  const m = query.data;

  const override = useOverrideMatch(matchId);
  const updateThreshold = useUpdateMatchThreshold(matchId);

  const [note, setNote] = useState("");
  const [thresholdInput, setThresholdInput] = useState(String(m.variance_threshold_pct));
  const [overrideOpen, setOverrideOpen] = useState(false);

  const pct = m.po_total > 0 ? ((m.amount_variance ?? 0) / m.po_total) * 100 : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/matches" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to matches
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Scale className="h-3.5 w-3.5" /> Procurement · Match
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {m.vendor_invoice_number}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <MatchStatusBadge status={m.status} />
            {m.po_number && (
              <>
                <span>·</span>
                <Link
                  to="/procurement/pos/$poId"
                  params={{ poId: m.po_id }}
                  className="underline-offset-4 hover:underline"
                >
                  PO {m.po_number}
                </Link>
              </>
            )}
            {m.vendor_name && (
              <>
                <span>·</span>
                <span>{m.vendor_name}</span>
              </>
            )}
            {m.invoice_date && (
              <>
                <span>·</span>
                <span>Invoice {m.invoice_date}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {m.payment_release_blocked && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5" />
          <div className="flex-1">
            <div className="font-semibold">Payment release blocked</div>
            <div className="text-xs">
              Variance exceeds the {m.variance_threshold_pct}% tolerance. A finance admin must
              review and approve before payment can be released.
            </div>
          </div>
          {access.data.canOverride && (
            <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  Approve with variance
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve with variance</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="note">Resolution note</Label>
                  <Textarea
                    id="note"
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Explain why the variance is acceptable…"
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOverrideOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={note.trim().length < 5 || override.isPending}
                    onClick={() =>
                      override.mutate(note.trim(), {
                        onSuccess: () => {
                          setOverrideOpen(false);
                          setNote("");
                        },
                      })
                    }
                  >
                    Approve
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Invoice</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-display text-xl font-bold">
              {formatCurrency(m.invoice_amount, m.invoice_currency_code)}
            </div>
            <div className="text-xs text-muted-foreground">{m.vendor_invoice_number}</div>
            {m.invoice_file_url && (
              <a
                href={m.invoice_file_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
              >
                <FileText className="h-3.5 w-3.5" /> View invoice PDF
              </a>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">PO total</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-display text-xl font-bold">
              {formatCurrency(m.po_total, m.invoice_currency_code)}
            </div>
            <div className="text-xs text-muted-foreground">{m.po_number ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">GRN</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="font-display text-xl font-bold">{m.grn_number ?? "—"}</div>
            <div className="text-xs text-muted-foreground">Confirmed receipt reference</div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          Variance breakdown
        </h2>
        <dl className="grid gap-y-2 text-sm sm:grid-cols-3">
          <dt className="text-muted-foreground">Amount Δ</dt>
          <dd className="sm:col-span-2">
            {formatCurrency(m.amount_variance ?? 0, m.invoice_currency_code)}{" "}
            <Badge variant={Math.abs(pct) > m.variance_threshold_pct ? "destructive" : "default"}>
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Qty variance</dt>
          <dd className="sm:col-span-2">
            {m.qty_variance_pct == null ? "—" : `${m.qty_variance_pct.toFixed(2)}%`}
          </dd>
          <dt className="text-muted-foreground">Price variance</dt>
          <dd className="sm:col-span-2">
            {m.price_variance_pct == null ? "—" : `${m.price_variance_pct.toFixed(2)}%`}
          </dd>
          <dt className="text-muted-foreground">Tolerance</dt>
          <dd className="sm:col-span-2">{m.variance_threshold_pct.toFixed(2)}%</dd>
        </dl>

        {access.data.canOverride && (
          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="thr">Update tolerance (%)</Label>
              <Input
                id="thr"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={
                updateThreshold.isPending ||
                Number(thresholdInput) === m.variance_threshold_pct ||
                !Number.isFinite(Number(thresholdInput))
              }
              onClick={() => updateThreshold.mutate(Number(thresholdInput))}
            >
              Save
            </Button>
          </div>
        )}
      </section>

      {m.resolution_note && (
        <section className="rounded-md border border-border p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Resolution note
          </h2>
          <p className="whitespace-pre-wrap text-sm">{m.resolution_note}</p>
          {m.matched_at && (
            <p className="mt-2 text-xs text-muted-foreground">
              Approved {format(new Date(m.matched_at), "PPp")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
