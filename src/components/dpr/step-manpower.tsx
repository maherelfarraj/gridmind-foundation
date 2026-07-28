// P-086 — Manpower step: repeatable rows with denormalized totals.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Minus, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dprDetailQueryOptions, errorMessage } from "@/lib/dpr-query";
import { addManpowerRow, deleteManpowerRow, type ManpowerRow } from "@/lib/dpr.functions";
import { sumManpower, TRADE_LABELS, TRADES, type Trade } from "@/lib/dpr.rules";
import { useI18n } from "@/lib/i18n/locale-provider";
import { Num } from "@/components/ui/num";

interface Props {
  dprId: string;
  rows: ManpowerRow[];
  readOnly: boolean;
}

export function StepManpower({ dprId, rows, readOnly }: Props) {
  const { t } = useI18n();
  const totals = sumManpower(rows);
  const qc = useQueryClient();
  const add = useServerFn(addManpowerRow);
  const del = useServerFn(deleteManpowerRow);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: dprDetailQueryOptions(dprId).queryKey });

  const [trade, setTrade] = useState<Trade>("civil");
  const [contractor, setContractor] = useState("");
  const [headcount, setHeadcount] = useState(1);
  const [hours, setHours] = useState(8);

  const addMut = useMutation({
    mutationFn: () =>
      add({
        data: {
          dprId,
          trade,
          contractor: contractor.trim() || null,
          headcount,
          hours,
        },
      }),
    onSuccess: () => {
      toast.success(t("fieldMod.dpr.manpower.rowAdded"));
      setContractor("");
      setHeadcount(1);
      setHours(8);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id, dprId } }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" aria-hidden /> {t("fieldMod.dpr.manpower.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <TotalTile
            label={t("fieldMod.dpr.manpower.headcount")}
            value={totals.totalManpower.toString()}
          />
          <TotalTile
            label={t("fieldMod.dpr.manpower.manHours")}
            value={totals.totalHours.toFixed(1)}
          />
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("fieldMod.dpr.manpower.noRows")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {TRADE_LABELS[r.trade as Trade] ?? r.trade}
                  {r.contractor ? ` · ${r.contractor}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  <Num>
                    {r.headcount} × {Number(r.hours).toFixed(1)} h ={" "}
                    {(Number(r.hours) * r.headcount).toFixed(1)} h
                  </Num>
                </div>
              </div>
              {!readOnly && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                  disabled={delMut.isPending}
                  onClick={() => delMut.mutate(r.id)}
                  aria-label={t("fieldMod.dpr.manpower.removeRow")}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("fieldMod.dpr.manpower.addRowTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mp-trade">{t("fieldMod.dpr.manpower.trade")}</Label>
                <Select value={trade} onValueChange={(v) => setTrade(v as Trade)}>
                  <SelectTrigger id="mp-trade" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRADE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mp-contractor">{t("fieldMod.dpr.manpower.contractor")}</Label>
                <Input
                  id="mp-contractor"
                  className="h-11"
                  value={contractor}
                  maxLength={120}
                  onChange={(e) => setContractor(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>{t("fieldMod.dpr.manpower.headcount")}</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11 shrink-0"
                    onClick={() => setHeadcount((n) => Math.max(0, n - 1))}
                    aria-label={t("fieldMod.dpr.manpower.decreaseHeadcount")}
                  >
                    <Minus className="h-4 w-4" aria-hidden />
                  </Button>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    className="h-11 text-center"
                    value={headcount}
                    onChange={(e) => setHeadcount(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11 shrink-0"
                    onClick={() => setHeadcount((n) => n + 1)}
                    aria-label={t("fieldMod.dpr.manpower.increaseHeadcount")}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mp-hours">{t("fieldMod.dpr.manpower.hoursPerPerson")}</Label>
                <Input
                  id="mp-hours"
                  type="number"
                  dir="ltr"
                  inputMode="decimal"
                  step="0.5"
                  min={0}
                  max={24}
                  className="h-11"
                  value={hours}
                  onChange={(e) => setHours(Math.min(24, Math.max(0, Number(e.target.value) || 0)))}
                />
              </div>
            </div>
            <Button
              type="button"
              className="h-11 w-full"
              disabled={addMut.isPending || headcount <= 0 || hours <= 0}
              onClick={() => addMut.mutate()}
            >
              <Plus className="me-2 h-4 w-4" aria-hidden />
              {t("fieldMod.dpr.manpower.addRow")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TotalTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
