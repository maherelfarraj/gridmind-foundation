// GC-13 — Governed manual cash adjustments: prepare, authorize, void.
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/components/cashflow/cash-format";
import type { AdjustmentRow } from "@/lib/cashflow.server";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.cashFlow";

export interface AdjustmentDraft {
  bucket_date: string;
  direction: "inflow" | "outflow";
  category: string;
  counterparty: string;
  amount: string;
  reason: string;
  evidence_reference: string;
}

const EMPTY: AdjustmentDraft = {
  bucket_date: "",
  direction: "inflow",
  category: "",
  counterparty: "",
  amount: "",
  reason: "",
  evidence_reference: "",
};

export function CashAdjustmentPanel({
  adjustments,
  currency,
  canWrite,
  busy,
  onCreate,
  onDecide,
}: {
  adjustments: AdjustmentRow[];
  currency: string;
  canWrite: boolean;
  busy: boolean;
  onCreate: (draft: AdjustmentDraft) => void;
  onDecide: (id: string, decision: "authorize" | "void", reason: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AdjustmentDraft>(EMPTY);

  const valid =
    draft.bucket_date.length === 10 &&
    draft.category.trim().length >= 2 &&
    Number(draft.amount) !== 0 &&
    Number.isFinite(Number(draft.amount)) &&
    draft.reason.trim().length >= 5;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t(`${K}.adjustments.title`)}</h2>
        <p className="text-xs text-muted-foreground">{t(`${K}.adjustments.description`)}</p>
      </div>

      {canWrite ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-date" className="text-xs">
              {t(`${K}.adjustments.date`)}
            </Label>
            <Input
              id="adj-date"
              type="date"
              value={draft.bucket_date}
              onChange={(e) => setDraft({ ...draft, bucket_date: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-direction" className="text-xs">
              {t(`${K}.adjustments.direction`)}
            </Label>
            <Select
              value={draft.direction}
              onValueChange={(v) => setDraft({ ...draft, direction: v as "inflow" | "outflow" })}
            >
              <SelectTrigger id="adj-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inflow">{t(`${K}.direction.inflow`)}</SelectItem>
                <SelectItem value="outflow">{t(`${K}.direction.outflow`)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-category" className="text-xs">
              {t(`${K}.adjustments.category`)}
            </Label>
            <Input
              id="adj-category"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-counterparty" className="text-xs">
              {t(`${K}.adjustments.counterparty`)}
            </Label>
            <Input
              id="adj-counterparty"
              value={draft.counterparty}
              onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-amount" className="text-xs">
              {t(`${K}.adjustments.amount`, { currency })}
            </Label>
            <Input
              id="adj-amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="adj-evidence" className="text-xs">
              {t(`${K}.adjustments.evidence`)}
            </Label>
            <Input
              id="adj-evidence"
              value={draft.evidence_reference}
              onChange={(e) => setDraft({ ...draft, evidence_reference: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2 xl:col-span-3">
            <Label htmlFor="adj-reason" className="text-xs">
              {t(`${K}.adjustments.reason`)}
            </Label>
            <Textarea
              id="adj-reason"
              rows={2}
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </div>
          <div>
            <Button
              size="sm"
              disabled={!valid || busy}
              onClick={() => {
                onCreate(draft);
                setDraft(EMPTY);
              }}
            >
              {t(`${K}.adjustments.create`)}
            </Button>
          </div>
        </div>
      ) : null}

      {adjustments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.adjustments.empty`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.adjustments.title`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.adjustments.date`)}</TableHead>
              <TableHead scope="col">{t(`${K}.adjustments.category`)}</TableHead>
              <TableHead scope="col">{t(`${K}.adjustments.direction`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.adjustments.amountShort`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.adjustments.status`)}</TableHead>
              <TableHead scope="col">{t(`${K}.adjustments.actions`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="tabular-nums">{a.bucket_date.slice(0, 10)}</TableCell>
                <TableCell className="font-medium">{a.category}</TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`${K}.direction.${a.direction}`)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(a.amount, a.currency_code || currency)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`${K}.adjustmentStatus.${a.status}`)}
                </TableCell>
                <TableCell>
                  {canWrite && a.status === "draft" ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onDecide(a.id, "authorize", a.reason)}
                      >
                        {t(`${K}.adjustments.authorize`)}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onDecide(a.id, "void", a.reason)}
                      >
                        {t(`${K}.adjustments.void`)}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
