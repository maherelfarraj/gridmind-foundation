// GC-12 — Manual progress override management: reason, evidence and authorisation.
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

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
import type { EvmScopeCatalog } from "@/lib/evm.report.functions";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";
const NONE = "__none__";

export interface OverrideView {
  id: string;
  scope_key: string;
  wbs_item_id: string | null;
  schedule_task_id: string | null;
  calculated_pct: number | null;
  override_pct: number;
  reason: string;
  evidence_ref: string;
  approved_by: string | null;
}

export interface OverrideDraft {
  wbs_item_id: string | null;
  schedule_task_id: string | null;
  override_pct: number;
  calculated_pct: number | null;
  reason: string;
  evidence_ref: string;
}

function emptyDraft(): OverrideDraft {
  return {
    wbs_item_id: null,
    schedule_task_id: null,
    override_pct: 0,
    calculated_pct: null,
    reason: "",
    evidence_ref: "",
  };
}

export function EvmOverridePanel({
  overrides,
  catalog,
  period,
  canWrite,
  busy,
  onSave,
  onDelete,
}: {
  overrides: OverrideView[];
  catalog: EvmScopeCatalog;
  period: string;
  canWrite: boolean;
  busy: boolean;
  onSave: (draft: OverrideDraft) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<OverrideDraft | null>(null);

  const wbsLabel = (id: string | null) => {
    const w = catalog.wbs.find((x) => x.id === id);
    return w ? `${w.code} ${w.name}` : null;
  };
  const taskLabel = (id: string | null) => catalog.tasks.find((x) => x.id === id)?.name ?? null;

  const valid =
    draft !== null &&
    (Boolean(draft.wbs_item_id) || Boolean(draft.schedule_task_id)) &&
    draft.reason.trim().length >= 8 &&
    draft.evidence_ref.trim().length > 0;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t(`${K}.mapping.overridesTitle`)}
          </h2>
          <p className="text-xs text-muted-foreground">{t(`${K}.mapping.overridesDescription`)}</p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setDraft(emptyDraft())}>
            <Plus className="size-4" /> {t(`${K}.mapping.addOverride`)}
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {t(`${K}.mapping.period`)}
        {": "}
        {period.slice(0, 7)}
      </p>

      {overrides.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${K}.mapping.noOverrides`)}</p>
      ) : (
        <Table>
          <caption className="sr-only">{t(`${K}.mapping.overridesTitle`)}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t(`${K}.mapping.scope`)}</TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.mapping.calculated`)}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t(`${K}.mapping.override`)}
              </TableHead>
              <TableHead scope="col">{t(`${K}.mapping.reason`)}</TableHead>
              <TableHead scope="col">{t(`${K}.mapping.evidence`)}</TableHead>
              <TableHead scope="col">{t(`${K}.mapping.actions`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-foreground">
                  {taskLabel(o.schedule_task_id) ?? wbsLabel(o.wbs_item_id) ?? o.scope_key}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.calculated_pct === null ? "—" : o.calculated_pct.toFixed(2)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.override_pct.toFixed(2)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.reason}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{o.evidence_ref}</TableCell>
                <TableCell>
                  {canWrite ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(`${K}.mapping.editOverride`)}
                        onClick={() =>
                          setDraft({
                            wbs_item_id: o.wbs_item_id,
                            schedule_task_id: o.schedule_task_id,
                            override_pct: o.override_pct,
                            calculated_pct: o.calculated_pct,
                            reason: o.reason,
                            evidence_ref: o.evidence_ref,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(`${K}.mapping.delete`)}
                        disabled={busy}
                        onClick={() => onDelete(o.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {draft ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ovr-wbs">{t(`${K}.mapping.scopeWbs`)}</Label>
              <Select
                value={draft.wbs_item_id ?? NONE}
                onValueChange={(v) => setDraft({ ...draft, wbs_item_id: v === NONE ? null : v })}
              >
                <SelectTrigger id="ovr-wbs">
                  <SelectValue placeholder={t(`${K}.mapping.selectScope`)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t(`${K}.mapping.none`)}</SelectItem>
                  {catalog.wbs.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {`${w.code} ${w.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="ovr-task">{t(`${K}.mapping.scopeTask`)}</Label>
              <Select
                value={draft.schedule_task_id ?? NONE}
                onValueChange={(v) =>
                  setDraft({ ...draft, schedule_task_id: v === NONE ? null : v })
                }
              >
                <SelectTrigger id="ovr-task">
                  <SelectValue placeholder={t(`${K}.mapping.selectScope`)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t(`${K}.mapping.none`)}</SelectItem>
                  {catalog.tasks.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="ovr-pct">{t(`${K}.mapping.override`)}</Label>
              <Input
                id="ovr-pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.override_pct}
                onChange={(e) => setDraft({ ...draft, override_pct: Number(e.target.value) })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="ovr-evidence">{t(`${K}.mapping.evidence`)}</Label>
              <Input
                id="ovr-evidence"
                value={draft.evidence_ref}
                onChange={(e) => setDraft({ ...draft, evidence_ref: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="ovr-reason">{t(`${K}.mapping.reason`)}</Label>
              <Textarea
                id="ovr-reason"
                rows={2}
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              />
            </div>
          </div>

          {!valid ? (
            <p role="alert" className="text-xs text-destructive">
              {t(`${K}.mapping.requiredScope`)}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !valid}
              onClick={() => {
                onSave(draft);
                setDraft(null);
              }}
            >
              {t(`${K}.mapping.save`)}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              {t(`${K}.mapping.cancel`)}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
