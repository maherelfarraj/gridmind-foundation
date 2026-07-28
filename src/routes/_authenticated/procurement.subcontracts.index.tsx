// P-258 — Subcontract register: list, KPIs and the create/edit dialog whose
// SOV editor must reconcile to the contract value before save is allowed.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardHat, Plus, Search, Trash2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PageHeader } from "@/components/ui/page-header";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyCell, Num } from "@/components/ui/num";
import { Progress } from "@/components/ui/progress";
import { money } from "@/lib/subcontracts-format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  getSubcontractAccess,
  listSubcontractPickers,
  listSubcontracts,
  type SubcontractRow,
} from "@/lib/subcontracts.functions";
import {
  subcontractAccessQueryOptions,
  subcontractListQueryOptions,
  subcontractPickersQueryOptions,
  useSaveSubcontract,
} from "@/lib/subcontracts-query";
import {
  SUBCONTRACT_STATUSES,
  progressPct,
  reconcileSov,
  sovLineAmount,
  type SovLineInput,
  type SubcontractStatus,
} from "@/lib/subcontracts.rules";

export const Route = createFileRoute("/_authenticated/procurement/subcontracts/")({
  head: () => ({
    meta: [
      { title: "Subcontracts — GridMind EPC" },
      {
        name: "description",
        content:
          "Subcontract register with schedule of values, retention ledger and certified progress claims.",
      },
      { property: "og:title", content: "Subcontracts — GridMind EPC" },
      {
        property: "og:description",
        content: "Track subcontract scope, retention and certified progress claims.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubcontractsIndex,
  errorComponent: SubcontractsError,
});

function SubcontractsError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <Button onClick={() => reset()}>{t("procurementMod.common.tryAgain")}</Button>
    </div>
  );
}

function SubcontractsIndex() {
  const { t } = useI18n();
  const listFn = useServerFn(listSubcontracts);
  const accessFn = useServerFn(getSubcontractAccess);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [editing, setEditing] = useState<SubcontractRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rows } = useSuspenseQuery(
    subcontractListQueryOptions(listFn, {
      search: search || null,
      status: status === "all" ? null : status,
    }),
  );
  const { data: access } = useQuery(subcontractAccessQueryOptions(accessFn));
  const canWrite = access?.canWrite ?? false;

  const totals = useMemo(() => {
    const currency = rows[0]?.currency_code ?? "USD";
    return {
      currency,
      count: rows.length,
      value: rows.reduce((a, r) => a + r.contract_value, 0),
      retention: rows.reduce((a, r) => a + (r.retention_held - r.retention_released), 0),
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("procurementMod.subcontracts.title")}
        description={t("procurementMod.subcontracts.subtitle")}
        actions={
          canWrite ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden />
              {t("procurementMod.subcontracts.newSubcontract")}
            </Button>
          ) : null
        }
      />

      <KpiGrid>
        <KpiTile
          label={t("procurementMod.subcontracts.kpiCount")}
          value={<Num>{totals.count}</Num>}
          icon={HardHat}
        />
        <KpiTile
          label={t("procurementMod.subcontracts.kpiValue")}
          value={<Num>{money(totals.value, totals.currency)}</Num>}
          icon={Wallet}
        />
        <KpiTile
          label={t("procurementMod.subcontracts.kpiRetention")}
          value={<Num>{money(totals.retention, totals.currency)}</Num>}
          icon={Wallet}
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("procurementMod.common.search")}
            className="ps-9"
            aria-label={t("procurementMod.common.search")}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48" aria-label={t("procurementMod.common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("procurementMod.common.allStatuses")}</SelectItem>
            {SUBCONTRACT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`procurementMod.subcontracts.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={t("procurementMod.subcontracts.empty")}
          description={t("procurementMod.subcontracts.emptyHint")}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("procurementMod.subcontracts.number")}</TableHead>
                <TableHead>{t("procurementMod.common.vendor")}</TableHead>
                <TableHead>{t("procurementMod.common.project")}</TableHead>
                <TableHead className="text-end">
                  {t("procurementMod.subcontracts.contractValue")}
                </TableHead>
                <TableHead className="min-w-40">
                  {t("procurementMod.subcontracts.certifiedToDate")}
                </TableHead>
                <TableHead className="text-end">
                  {t("procurementMod.subcontracts.retentionHeld")}
                </TableHead>
                <TableHead>{t("procurementMod.common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = progressPct(r.certified_to_date, r.contract_value);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/procurement/subcontracts/$subcontractId"
                        params={{ subcontractId: r.id }}
                        className="font-mono text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {r.subcontract_number ?? "—"}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{r.title}</div>
                    </TableCell>
                    <TableCell>{r.vendor_name ?? "—"}</TableCell>
                    <TableCell>{r.project_name ?? "—"}</TableCell>
                    <TableCell>
                      <MoneyCell>{money(r.contract_value, r.currency_code)}</MoneyCell>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <MoneyCell>{money(r.certified_to_date, r.currency_code)}</MoneyCell>
                        <Progress
                          value={pct}
                          aria-label={t("procurementMod.subcontracts.progress")}
                        />
                        <div className="text-end text-xs text-muted-foreground">
                          <Num>{pct.toFixed(1)}%</Num>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <MoneyCell>
                        {money(r.retention_held - r.retention_released, r.currency_code)}
                      </MoneyCell>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={r.status}
                        label={t(`procurementMod.subcontracts.status.${r.status}`)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canWrite ? (
        <SubcontractDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existing={editing}
          onSaved={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface DraftLine extends SovLineInput {
  key: string;
}

const emptyLine = (line_no: number): DraftLine => ({
  key: `${line_no}-${Math.random().toString(36).slice(2, 8)}`,
  line_no,
  description: "",
  uom: "",
  qty: 0,
  unit_price: 0,
  wbs_item_id: null,
});

export function SubcontractDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: SubcontractRow | null;
  onSaved: (id: string) => void;
}) {
  const { t } = useI18n();
  const pickersFn = useServerFn(listSubcontractPickers);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [vendorId, setVendorId] = useState(existing?.vendor_id ?? "");
  const [projectId, setProjectId] = useState(existing?.project_id ?? "");
  const [wbsItemId, setWbsItemId] = useState<string>(existing?.wbs_item_id ?? "none");
  const [scope, setScope] = useState(existing?.scope_summary ?? "");
  const [contractValue, setContractValue] = useState(String(existing?.contract_value ?? 0));
  const [currency, setCurrency] = useState(existing?.currency_code ?? "USD");
  const [retentionPct, setRetentionPct] = useState(String(existing?.retention_pct ?? 10));
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [status, setStatus] = useState<SubcontractStatus>(existing?.status ?? "draft");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(1)]);

  const { data: pickers } = useQuery(subcontractPickersQueryOptions(pickersFn, projectId || null));

  const value = Number(contractValue || 0);
  const recon = reconcileSov(lines, value);
  const valid =
    title.trim().length >= 2 &&
    !!vendorId &&
    !!projectId &&
    lines.every((l) => l.description.trim().length > 0) &&
    recon.reconciled;

  const save = useSaveSubcontract((id) => {
    onSaved(id);
  });

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? t("procurementMod.subcontracts.editSubcontract")
              : t("procurementMod.subcontracts.newSubcontract")}
          </DialogTitle>
          <DialogDescription>{t("procurementMod.subcontracts.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sc-title">{t("procurementMod.subcontracts.subcontract")}</Label>
            <Input id="sc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>{t("procurementMod.common.vendor")}</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder={t("procurementMod.common.vendor")} />
              </SelectTrigger>
              <SelectContent>
                {(pickers?.vendors ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {(pickers?.vendors ?? []).length === 0
                ? t("procurementMod.subcontracts.noVendors")
                : t("procurementMod.subcontracts.vendorPickerHint")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>{t("procurementMod.common.project")}</Label>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setWbsItemId("none");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("procurementMod.common.project")} />
              </SelectTrigger>
              <SelectContent>
                {(pickers?.projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("procurementMod.subcontracts.wbs")}</Label>
            <Select value={wbsItemId} onValueChange={setWbsItemId} disabled={!projectId}>
              <SelectTrigger>
                <SelectValue placeholder={t("procurementMod.subcontracts.wbs")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(pickers?.wbs ?? []).map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("procurementMod.common.status")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubcontractStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBCONTRACT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`procurementMod.subcontracts.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-value">{t("procurementMod.subcontracts.contractValue")}</Label>
            <Input
              id="sc-value"
              inputMode="decimal"
              dir="ltr"
              value={contractValue}
              onChange={(e) => setContractValue(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("procurementMod.subcontracts.currency")}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(pickers?.currencies?.length ? pickers.currencies : ["USD", "JOD", "EUR"]).map(
                  (c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-ret">{t("procurementMod.subcontracts.retentionPct")}</Label>
            <Input
              id="sc-ret"
              inputMode="decimal"
              dir="ltr"
              value={retentionPct}
              onChange={(e) => setRetentionPct(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-start">{t("procurementMod.subcontracts.startDate")}</Label>
            <Input
              id="sc-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sc-end">{t("procurementMod.subcontracts.endDate")}</Label>
            <Input
              id="sc-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="sc-scope">{t("procurementMod.subcontracts.scope")}</Label>
            <Textarea id="sc-scope" value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold">
              {t("procurementMod.subcontracts.sov")}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, emptyLine(prev.length + 1)])}
            >
              <Plus className="size-4" aria-hidden />
              {t("procurementMod.subcontracts.addLine")}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">{t("procurementMod.common.hash")}</TableHead>
                  <TableHead>{t("procurementMod.common.description")}</TableHead>
                  <TableHead className="w-24">{t("procurementMod.common.uom")}</TableHead>
                  <TableHead className="w-28">{t("procurementMod.common.qtyShort")}</TableHead>
                  <TableHead className="w-32">{t("procurementMod.common.unitPrice")}</TableHead>
                  <TableHead className="w-32 text-end">
                    {t("procurementMod.common.amount")}
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, idx) => (
                  <TableRow key={l.key}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <Input
                        value={l.description}
                        onChange={(e) => setLine(l.key, { description: e.target.value })}
                        aria-label={t("procurementMod.common.description")}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={l.uom ?? ""}
                        onChange={(e) => setLine(l.key, { uom: e.target.value })}
                        aria-label={t("procurementMod.common.uom")}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        value={String(l.qty)}
                        onChange={(e) => setLine(l.key, { qty: Number(e.target.value || 0) })}
                        aria-label={t("procurementMod.common.qtyShort")}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        value={String(l.unit_price)}
                        onChange={(e) =>
                          setLine(l.key, { unit_price: Number(e.target.value || 0) })
                        }
                        aria-label={t("procurementMod.common.unitPrice")}
                      />
                    </TableCell>
                    <TableCell>
                      <MoneyCell>{money(sovLineAmount(l), currency)}</MoneyCell>
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        aria-label={t("procurementMod.subcontracts.removeLine")}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-6 text-sm">
            <span className="text-muted-foreground">
              {t("procurementMod.subcontracts.sovTotal")}:{" "}
              <Num className="font-mono">{money(recon.total, currency)}</Num>
            </span>
            <span className={recon.reconciled ? "text-muted-foreground" : "text-destructive"}>
              {t("procurementMod.subcontracts.sovVariance")}:{" "}
              <Num className="font-mono">{money(recon.variance, currency)}</Num>
            </span>
          </div>
          {!recon.reconciled ? (
            <p role="alert" className="text-sm text-destructive">
              {t("procurementMod.subcontracts.sovMismatch")}
            </p>
          ) : null}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("procurementMod.subcontracts.cancel")}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate({
                id: existing?.id,
                title: title.trim(),
                vendor_id: vendorId,
                project_id: projectId,
                wbs_item_id: wbsItemId === "none" ? null : wbsItemId,
                scope_summary: scope.trim() || null,
                contract_value: value,
                currency_code: currency,
                retention_pct: Number(retentionPct || 0),
                start_date: startDate || null,
                end_date: endDate || null,
                status,
                notes: null,
                lines: lines.map((l, i) => ({
                  line_no: i + 1,
                  description: l.description.trim(),
                  uom: l.uom?.trim() || null,
                  qty: Number(l.qty || 0),
                  unit_price: Number(l.unit_price || 0),
                  wbs_item_id: l.wbs_item_id ?? null,
                })),
              })
            }
          >
            {t("procurementMod.subcontracts.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
