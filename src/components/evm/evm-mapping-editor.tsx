// GC-12 — Versioned WBS/task ↔ cost-code mapping editor.
// Draft versions are editable; approved/superseded versions are read-only.
import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";

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
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvmScopeCatalog, MappingVersionRow } from "@/lib/evm.report.functions";
import {
  PROGRESS_METHODS,
  reconcileAllocations,
  type MappingRow,
  type ProgressMethod,
} from "@/lib/evm.report.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

const K = "financeMod.costing.evm";

export interface MappingDraft {
  id?: string;
  wbs_item_id: string | null;
  schedule_task_id: string | null;
  cost_code_id: string | null;
  allocation_pct: number;
  progress_method: ProgressMethod;
  planned_units: number | null;
}

const NONE = "__none__";

function emptyDraft(method: ProgressMethod): MappingDraft {
  return {
    wbs_item_id: null,
    schedule_task_id: null,
    cost_code_id: null,
    allocation_pct: 100,
    progress_method: method,
    planned_units: null,
  };
}

export function EvmMappingEditor({
  versions,
  selectedVersionId,
  onSelectVersion,
  mappings,
  catalog,
  defaultMethod,
  canWrite,
  busy,
  onCreateVersion,
  onApproveVersion,
  onSave,
  onDelete,
}: {
  versions: MappingVersionRow[];
  selectedVersionId: string | null;
  onSelectVersion: (id: string) => void;
  mappings: (MappingRow & { mapping_version_id: string })[];
  catalog: EvmScopeCatalog;
  defaultMethod: ProgressMethod;
  canWrite: boolean;
  busy: boolean;
  onCreateVersion: () => void;
  onApproveVersion: (id: string) => void;
  onSave: (draft: MappingDraft) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<MappingDraft | null>(null);

  const version = versions.find((v) => v.id === selectedVersionId) ?? null;
  const editable = canWrite && version?.status === "draft";

  const wbsLabel = useMemo(() => {
    const map = new Map(catalog.wbs.map((w) => [w.id, `${w.code} ${w.name}`]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : null);
  }, [catalog.wbs]);
  const taskLabel = useMemo(() => {
    const map = new Map(catalog.tasks.map((x) => [x.id, x.name]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : null);
  }, [catalog.tasks]);
  const codeLabel = useMemo(() => {
    const map = new Map(catalog.cost_codes.map((c) => [c.id, `${c.code} ${c.name}`]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : null);
  }, [catalog.cost_codes]);

  const reconciliation = useMemo(() => reconcileAllocations(mappings), [mappings]);
  const issues = reconciliation.filter((r) => !r.ok);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="flex min-w-56 flex-col gap-1">
          <Label htmlFor="evm-version">{t(`${K}.mapping.version`)}</Label>
          <Select value={selectedVersionId ?? ""} onValueChange={onSelectVersion}>
            <SelectTrigger id="evm-version">
              <SelectValue placeholder={t(`${K}.mapping.version`)} />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {`v${v.version_no}${v.label ? ` — ${v.label}` : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {version ? (
          <StatusBadge
            status={version.status === "approved" ? "approved" : version.status}
            label={t(`${K}.status.${version.status}`, { defaultValue: version.status })}
          />
        ) : null}
        {canWrite ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={onCreateVersion}>
              <Plus className="size-4" /> {t(`${K}.mapping.newVersion`)}
            </Button>
            <Button
              size="sm"
              disabled={busy || !version || version.status !== "draft" || issues.length > 0}
              onClick={() => version && onApproveVersion(version.id)}
            >
              <Check className="size-4" /> {t(`${K}.mapping.approveVersion`)}
            </Button>
          </div>
        ) : null}
        {version && version.status !== "draft" ? (
          <p className="text-xs text-muted-foreground">{t(`${K}.mapping.frozen`)}</p>
        ) : null}
      </Card>

      {!version ? (
        <Card className="p-6 text-sm text-muted-foreground">{t(`${K}.mapping.noVersion`)}</Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t(`${K}.mapping.mappingsTitle`)}
              </h2>
              {editable ? (
                <Button size="sm" onClick={() => setDraft(emptyDraft(defaultMethod))}>
                  <Plus className="size-4" /> {t(`${K}.mapping.addRow`)}
                </Button>
              ) : null}
            </div>

            {mappings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${K}.mapping.empty`)}</p>
            ) : (
              <Table>
                <caption className="sr-only">{t(`${K}.mapping.mappingsTitle`)}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t(`${K}.mapping.scope`)}</TableHead>
                    <TableHead scope="col">{t(`${K}.mapping.costCode`)}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t(`${K}.mapping.allocation`)}
                    </TableHead>
                    <TableHead scope="col">{t(`${K}.mapping.method`)}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t(`${K}.mapping.plannedUnits`)}
                    </TableHead>
                    <TableHead scope="col">{t(`${K}.mapping.actions`)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-foreground">
                        {taskLabel(m.schedule_task_id) ?? wbsLabel(m.wbs_item_id) ?? "—"}
                      </TableCell>
                      <TableCell>{codeLabel(m.cost_code_id) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.allocation_pct.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {t(`${K}.progressMethod.${m.progress_method}`, {
                          defaultValue: m.progress_method,
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.planned_units === null ? "—" : String(m.planned_units)}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={t(`${K}.mapping.edit`)}
                              onClick={() =>
                                setDraft({
                                  id: m.id,
                                  wbs_item_id: m.wbs_item_id,
                                  schedule_task_id: m.schedule_task_id,
                                  cost_code_id: m.cost_code_id,
                                  allocation_pct: m.allocation_pct,
                                  progress_method: m.progress_method,
                                  planned_units: m.planned_units ?? null,
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
                              onClick={() => onDelete(m.id)}
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
          </Card>

          {draft ? (
            <Card className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {draft.id ? t(`${K}.mapping.editRow`) : t(`${K}.mapping.addRow`)}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-wbs">{t(`${K}.mapping.scopeWbs`)}</Label>
                  <Select
                    value={draft.wbs_item_id ?? NONE}
                    onValueChange={(v) =>
                      setDraft({ ...draft, wbs_item_id: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger id="map-wbs">
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
                  <Label htmlFor="map-task">{t(`${K}.mapping.scopeTask`)}</Label>
                  <Select
                    value={draft.schedule_task_id ?? NONE}
                    onValueChange={(v) =>
                      setDraft({ ...draft, schedule_task_id: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger id="map-task">
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
                  <Label htmlFor="map-code">{t(`${K}.mapping.costCode`)}</Label>
                  <Select
                    value={draft.cost_code_id ?? NONE}
                    onValueChange={(v) =>
                      setDraft({ ...draft, cost_code_id: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger id="map-code">
                      <SelectValue placeholder={t(`${K}.mapping.selectCostCode`)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t(`${K}.mapping.none`)}</SelectItem>
                      {catalog.cost_codes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {`${c.code} ${c.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-alloc">{t(`${K}.mapping.allocation`)}</Label>
                  <Input
                    id="map-alloc"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={draft.allocation_pct}
                    onChange={(e) => setDraft({ ...draft, allocation_pct: Number(e.target.value) })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-method">{t(`${K}.mapping.method`)}</Label>
                  <Select
                    value={draft.progress_method}
                    onValueChange={(v) =>
                      setDraft({ ...draft, progress_method: v as ProgressMethod })
                    }
                  >
                    <SelectTrigger id="map-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROGRESS_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {t(`${K}.progressMethod.${m}`, { defaultValue: m })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="map-units">{t(`${K}.mapping.plannedUnits`)}</Label>
                  <Input
                    id="map-units"
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.planned_units ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        planned_units: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              {!draft.wbs_item_id && !draft.schedule_task_id ? (
                <p role="alert" className="text-xs text-destructive">
                  {t(`${K}.mapping.requiredScope`)}
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy || (!draft.wbs_item_id && !draft.schedule_task_id)}
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
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold text-foreground">
              {t(`${K}.mapping.reconTitle`)}
            </h2>
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${K}.mapping.reconOk`)}</p>
            ) : (
              <>
                <p className="text-sm text-warning">
                  {t(`${K}.mapping.reconIssue`, { count: issues.length })}
                </p>
                <Table>
                  <caption className="sr-only">{t(`${K}.mapping.reconTitle`)}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t(`${K}.mapping.reconScope`)}</TableHead>
                      <TableHead scope="col" className="text-right">
                        {t(`${K}.mapping.reconTotal`)}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.map((r) => (
                      <TableRow key={r.scope_key}>
                        <TableCell>
                          {taskLabel(r.scope_key.replace("task:", "")) ??
                            wbsLabel(r.scope_key.replace("wbs:", "")) ??
                            r.scope_key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.total_pct.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
