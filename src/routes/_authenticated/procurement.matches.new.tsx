// P-067 — New three-way match form.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { getMatchContextForPo, getMatchWriteAccess, listMatchablePos } from "@/lib/match.functions";
import { amountVariancePct, computeVariances, deriveMatchStatus } from "@/lib/match-rules";
import {
  matchContextForPoQueryOptions,
  matchWriteAccessQueryOptions,
  matchablePosQueryOptions,
  useAttachInvoiceFile,
  useCreateMatch,
} from "@/lib/match-query";

const searchSchema = z.object({
  po: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/procurement/matches/new")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "New Invoice Match — GridMind EPC" },
      {
        name: "description",
        content: "Match a vendor invoice against its purchase order and received goods.",
      },
    ],
  }),
  component: NewMatch,
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

function NewMatch() {
  const { po } = useSearch({
    from: "/_authenticated/procurement/matches/new",
  });
  const navigate = useNavigate();
  const listFn = useServerFn(listMatchablePos);
  const posQuery = useSuspenseQuery(matchablePosQueryOptions(listFn));

  if (!po) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/matches" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <h1 className="font-display text-xl font-semibold">Pick a PO to match</h1>
        {posQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No issued POs are available yet.</p>
        ) : (
          <div className="space-y-2">
            {posQuery.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  navigate({
                    to: "/procurement/matches/new",
                    search: { po: p.id },
                  })
                }
                className="flex w-full items-center justify-between rounded-md border border-border p-3 text-left hover:bg-accent"
              >
                <div>
                  <div className="font-mono text-sm">{p.po_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.vendor_name ?? "—"} · {formatCurrency(p.total_amount, p.currency_code)}
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">
                  {p.status.replace(/_/g, " ")}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <MatchForm poId={po} />;
}

function MatchForm({ poId }: { poId: string }) {
  const navigate = useNavigate();
  const ctxFn = useServerFn(getMatchContextForPo);
  const accessFn = useServerFn(getMatchWriteAccess);
  const ctxQuery = useSuspenseQuery(matchContextForPoQueryOptions(ctxFn, poId));
  const accessQuery = useSuspenseQuery(matchWriteAccessQueryOptions(accessFn));
  const ctx = ctxQuery.data;

  const create = useCreateMatch();
  const attach = useAttachInvoiceFile();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState<string>(
    ctx.po_total ? String(ctx.po_total) : "",
  );
  const [grnId, setGrnId] = useState<string>(ctx.goods_receipts[0]?.id ?? "");
  const [threshold, setThreshold] = useState<string>("5");
  const [file, setFile] = useState<File | null>(null);

  const parsedAmount = Number(invoiceAmount);
  const parsedThreshold = Number(threshold);
  const canSubmit =
    invoiceNo.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Number.isFinite(parsedThreshold) &&
    parsedThreshold >= 0;

  const preview = useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
    const variances = computeVariances({
      poTotal: ctx.po_total,
      poLines: ctx.lines.map((l) => ({
        po_line_no: l.po_line_no,
        qty: l.qty_ordered,
        unit_price: l.unit_price,
      })),
      grnQtyByLine: Object.fromEntries(ctx.lines.map((l) => [l.po_line_no, l.qty_received])),
      invoiceAmount: parsedAmount,
    });
    const status = deriveMatchStatus({
      variances,
      poTotal: ctx.po_total,
      thresholdPct: Number.isFinite(parsedThreshold) ? parsedThreshold : 5,
    });
    return {
      ...variances,
      pct: amountVariancePct(variances.amount_variance, ctx.po_total),
      status,
    };
  }, [ctx, parsedAmount, parsedThreshold]);

  const submit = async () => {
    if (!accessQuery.data.canWrite) {
      toast.error("You don’t have permission to match invoices.");
      return;
    }
    try {
      const res = await create.mutateAsync({
        poId,
        goodsReceiptId: grnId || null,
        vendor_invoice_number: invoiceNo.trim(),
        invoice_date: invoiceDate.trim() ? invoiceDate.trim() : null,
        invoice_amount: parsedAmount,
        invoice_currency_code: ctx.currency_code,
        variance_threshold_pct: parsedThreshold,
      });
      if (file) {
        try {
          const ext = (file.name.split(".").pop() ?? "pdf").toLowerCase();
          const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}`;
          // NOTE: companyId is not returned by createMatch — read from ctx.
          const companyPath = await resolveCompanyId();
          const path = `${companyPath}/invoices/${res.id}/${id}.${ext}`;
          const { error } = await supabase.storage.from("documents").upload(path, file, {
            contentType: file.type || "application/pdf",
          });
          if (error) throw error;
          await attach.mutateAsync({ matchId: res.id, path });
        } catch (e: any) {
          toast.error(e?.message ?? "Invoice PDF upload failed");
        }
      }
      navigate({
        to: "/procurement/matches/$matchId",
        params: { matchId: res.id },
      });
    } catch {
      /* toast fires from hook */
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-32">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/procurement/matches" })}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <header>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Match invoice against PO
        </div>
        <h1 className="font-display text-xl font-bold">{ctx.po_number}</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.vendor_name ?? "—"} · PO total{" "}
          <span className="font-medium">{formatCurrency(ctx.po_total, ctx.currency_code)}</span>
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Received to date</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="space-y-1">
            {ctx.lines.map((l) => (
              <li key={l.po_line_no} className="flex justify-between">
                <span>
                  <span className="font-mono text-xs text-muted-foreground">#{l.po_line_no}</span>{" "}
                  {l.description}
                </span>
                <span className="text-muted-foreground">
                  {l.qty_received} / {l.qty_ordered} {l.uom}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="inv-no">Vendor invoice #</Label>
              <Input
                id="inv-no"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="INV-2026-0001"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-date">Invoice date</Label>
              <Input
                id="inv-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-amount">Amount ({ctx.currency_code})</Label>
              <Input
                id="inv-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="threshold">
                Variance tolerance (%)
                {!accessQuery.data.canOverride && (
                  <span className="ml-1 text-xs text-muted-foreground">(finance admins only)</span>
                )}
              </Label>
              <Input
                id="threshold"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                disabled={!accessQuery.data.canOverride}
              />
            </div>
            {ctx.goods_receipts.length > 0 && (
              <div className="space-y-1 sm:col-span-2">
                <Label>Linked GRN (optional)</Label>
                <Select value={grnId} onValueChange={(v) => setGrnId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {ctx.goods_receipts.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.grn_number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="inv-file">Invoice PDF (optional)</Label>
              <Input
                id="inv-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {preview && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="mb-1 font-medium">Live variance preview</div>
              <div className="grid grid-cols-2 gap-y-1 text-xs sm:grid-cols-3">
                <span className="text-muted-foreground">Amount Δ</span>
                <span className="col-span-2">
                  {formatCurrency(preview.amount_variance, ctx.currency_code)} (
                  {preview.pct.toFixed(2)}%)
                </span>
                <span className="text-muted-foreground">Derived status</span>
                <span className="col-span-2 capitalize">{preview.status.replace(/_/g, " ")}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate({ to: "/procurement/matches" })}
          >
            Cancel
          </Button>
          <Button className="flex-1" disabled={!canSubmit || create.isPending} onClick={submit}>
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : file ? (
              <Upload className="mr-2 h-4 w-4" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Create match
          </Button>
        </div>
      </div>
    </div>
  );
}

// resolve current user's company id via a lightweight profile lookup.
async function resolveCompanyId(): Promise<string> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error("no_session");
  const { data, error } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", uid)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id;
  if (!cid) throw new Error("no_company");
  return cid as string;
}
