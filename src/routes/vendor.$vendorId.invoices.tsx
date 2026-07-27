// P-225 — Vendor invoice upload + submitted-invoice list.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, Receipt, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VendorStateCard, VendorTableSkeleton } from "@/components/vendor-portal/state-cards";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatMoney } from "@/lib/format";
import { vendorPortalErrorCode } from "@/lib/vendor-portal.rules";
import { getVendorPortalPos } from "@/lib/vendor-portal.functions";
import {
  createVendorInvoiceUpload,
  listVendorSubmittedInvoices,
  signVendorFileUrl,
  submitVendorInvoice,
} from "@/lib/vendor-exchange.functions";
import {
  validateUploadFile,
  VENDOR_INVOICE_MIME,
  VENDOR_UPLOAD_ERRORS,
  type VendorUploadErrorCode,
} from "@/lib/vendor-uploads.rules";

export const Route = createFileRoute("/vendor/$vendorId/invoices")({
  head: () => ({
    meta: [
      { title: "Submit an invoice — GridMind Vendor Portal" },
      {
        name: "description",
        content:
          "Upload your invoice against a purchase order and track its three-way match status.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VendorInvoicesPage,
});



function VendorInvoicesPage() {
  const { vendorId } = Route.useParams();
  const qc = useQueryClient();
  const posFn = useServerFn(getVendorPortalPos);
  const listFn = useServerFn(listVendorSubmittedInvoices);
  const uploadFn = useServerFn(createVendorInvoiceUpload);
  const submitFn = useServerFn(submitVendorInvoice);
  const signFn = useServerFn(signVendorFileUrl);

  const pos = useQuery({
    queryKey: ["vendor-portal", "pos", vendorId],
    queryFn: () => posFn({ data: { vendorId } }),
    retry: false,
  });
  const invoicesKey = ["vendor-portal", "submitted-invoices", vendorId] as const;
  const invoices = useQuery({
    queryKey: invoicesKey,
    queryFn: () => listFn({ data: { vendorId } }),
    retry: false,
  });

  const [poId, setPoId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const openPos = useMemo(
    () => (pos.data ?? []).filter((p) => !["draft", "cancelled"].includes(p.status)),
    [pos.data],
  );
  const selectedPo = openPos.find((p) => p.id === poId) ?? null;

  const submit = useMutation({
    mutationFn: async () => {
      if (!selectedPo) throw new Error("po_required");
      const bad = validateUploadFile(file, [VENDOR_INVOICE_MIME]);
      if (bad) throw new Error(bad);
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("invalid_amount");
      if (!invoiceNumber.trim()) throw new Error("invoice_number_required");

      const target = await uploadFn({
        data: {
          vendorId,
          poId: selectedPo.id,
          filename: file!.name,
          size: file!.size,
          mimeType: file!.type,
        },
      });
      const { error: upErr } = await supabase.storage
        .from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file!, { contentType: file!.type });
      if (upErr) throw new Error(upErr.message);

      return submitFn({
        data: {
          vendorId,
          poId: selectedPo.id,
          path: target.path,
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          amount: value,
          currency: selectedPo.currency_code,
        },
      });
    },
    onSuccess: () => {
      toast.success("Invoice submitted — queued for three-way match");
      setInvoiceNumber("");
      setAmount("");
      setFile(null);
      void qc.invalidateQueries({ queryKey: invoicesKey });
    },
    onError: (err: unknown) => {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        VENDOR_UPLOAD_ERRORS[code as VendorUploadErrorCode] ??
          vendorPortalErrorCode(err) ??
          "Could not submit the invoice.",
      );
    },
  });

  async function download(path: string | null) {
    if (!path) return;
    const { url } = await signFn({ data: { vendorId, path } });
    if (!url) {
      toast.error("Could not open that file.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (invoices.isError) {
    return (
      <div className="space-y-6">
        <BackLink vendorId={vendorId} />
        <VendorStateCard
          title="Invoices are not shared with your account"
          description="Ask your buyer contact to enable invoice access for this portal login."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink vendorId={vendorId} />
      <PageHeader
        title="Invoices"
        description="Upload a PDF invoice against a purchase order. It lands straight in the buyer's three-way match queue."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit an invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="po">Purchase order</Label>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger id="po">
                <SelectValue placeholder="Select a PO" />
              </SelectTrigger>
              <SelectContent>
                {openPos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.po_number} — {formatMoney(p.total_amount, p.currency_code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-no">Your invoice number</Label>
            <Input
              id="inv-no"
              value={invoiceNumber}
              maxLength={120}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-2026-0142"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-date">Invoice date</Label>
            <Input
              id="inv-date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount">Amount ({selectedPo?.currency_code ?? "—"})</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="file">Invoice PDF (max 25 MB)</Label>
            <Input
              id="file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Files are scanned and stored privately. Only you and your buyer can open them.
            </p>
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !selectedPo || !file}
            >
              {submit.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Submit invoice
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your submitted invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.isLoading ? (
            <VendorTableSkeleton />
          ) : (invoices.data ?? []).length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices submitted yet"
              description="Upload your first invoice above to start the match."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Match status</TableHead>
                  <TableHead className="text-right">File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoices.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.vendor_invoice_number}</TableCell>
                    <TableCell>{row.po_number ?? "—"}</TableCell>
                    <TableCell>{formatDate(row.invoice_date)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.invoice_amount, row.invoice_currency_code)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} label={row.status.replace(/_/g, " ")} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void download(row.invoice_file_path)}
                        disabled={!row.invoice_file_path}
                      >
                        <Download className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink({ vendorId }: { vendorId: string }) {
  return (
    <Link
      to="/vendor/$vendorId"
      params={{ vendorId }}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to portal
    </Link>
  );
}
