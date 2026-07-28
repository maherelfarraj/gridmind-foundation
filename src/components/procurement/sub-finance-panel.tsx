// P-261 — Subcontract finance panel: AP invoices generated on certification,
// their payment state (derived by the P-247 sync trigger) and retention release.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyCell, Num } from "@/components/ui/num";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  getSubcontractFinance,
  releaseSubcontractRetention,
} from "@/lib/subcontract-finance.functions";
import { money } from "@/lib/subcontracts-format";

export function SubFinancePanel({
  subcontractId,
  currency,
  canWrite,
}: {
  subcontractId: string;
  currency: string;
  canWrite: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const loadFn = useServerFn(getSubcontractFinance);
  const releaseFn = useServerFn(releaseSubcontractRetention);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const { data } = useQuery({
    queryKey: ["subcontract-finance", subcontractId],
    queryFn: () => loadFn({ data: { subcontract_id: subcontractId } }),
    staleTime: 15_000,
  });

  const release = useMutation({
    mutationFn: () =>
      releaseFn({
        data: {
          subcontract_id: subcontractId,
          amount: Number(amount),
          reason: reason.trim() || null,
        },
      }),
    onSuccess: (res) => {
      toast.success(t("procurementMod.subcontracts.finance.released"), {
        description: res.invoice_number,
      });
      setOpen(false);
      setAmount("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["subcontract-finance", subcontractId] });
      void qc.invalidateQueries({ queryKey: ["subcontract", subcontractId] });
    },
    onError: (e: Error) =>
      toast.error(t("procurementMod.subcontracts.finance.releaseFailed"), {
        description: e.message,
      }),
  });

  const held = data?.retention_held ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">
          {t("procurementMod.subcontracts.finance.title")}
        </CardTitle>
        {canWrite && held > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Banknote className="size-4" aria-hidden />
            {t("procurementMod.subcontracts.finance.releaseRetention")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {t("procurementMod.subcontracts.finance.terms")}:{" "}
          <Num className="font-mono">{data?.payment_terms_days ?? 30}</Num>
        </p>

        {!data || data.ap_invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("procurementMod.subcontracts.finance.noInvoices")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurementMod.subcontracts.finance.invoice")}</TableHead>
                <TableHead>{t("procurementMod.subcontracts.finance.due")}</TableHead>
                <TableHead className="text-end">
                  {t("procurementMod.subcontracts.finance.amount")}
                </TableHead>
                <TableHead className="text-end">
                  {t("procurementMod.subcontracts.finance.balance")}
                </TableHead>
                <TableHead>{t("procurementMod.subcontracts.finance.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.ap_invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {inv.due_date ?? "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyCell>{money(inv.amount, inv.currency_code || currency)}</MoneyCell>
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyCell>{money(inv.balance, inv.currency_code || currency)}</MoneyCell>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {data && data.releases.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("procurementMod.subcontracts.finance.releases")}
            </p>
            {data.releases.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {r.invoice_number ?? r.release_date}
                </span>
                <Num className="font-mono">{money(r.amount, currency)}</Num>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("procurementMod.subcontracts.finance.releaseRetention")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("procurementMod.subcontracts.retentionHeld")}:{" "}
              <Num className="font-mono">{money(held, currency)}</Num>
            </p>
            <div className="space-y-1">
              <Label htmlFor="retention-amount">
                {t("procurementMod.subcontracts.finance.amount")}
              </Label>
              <Input
                id="retention-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retention-reason">{t("procurementMod.subcontracts.notes")}</Label>
              <Input
                id="retention-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("procurementMod.subcontracts.cancel")}
            </Button>
            <Button
              disabled={!(Number(amount) > 0) || release.isPending}
              onClick={() => release.mutate()}
            >
              {t("procurementMod.subcontracts.finance.releaseRetention")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
