// P-210 — Rate library: CRUD table, validity chips and CSV paste import.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ClipboardPaste, Library, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableSearch,
  Num,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteRate, importRateLibrary, upsertRate } from "@/lib/estimating.functions";
import { estimatingErrorMessage, rateLibraryQueryOptions } from "@/lib/estimating.query";
import {
  ESTIMATE_RATE_TYPES,
  RATE_CSV_HEADERS,
  RATE_TYPE_LABELS,
  RateRowSchema,
  parseRateCsv,
  rateValidity,
  type EstimateRateType,
  type RateRow,
} from "@/lib/estimating.rules";
import type { RateRowRecord } from "@/lib/estimating.server";
import { formatDate, formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/estimating/rates")({
  head: () => ({
    meta: [
      { title: "Rate library — GridMind EPC" },
      {
        name: "description",
        content:
          "Company rate library for estimating: material, labour, plant and subcontract unit rates with validity windows.",
      },
      { property: "og:title", content: "Rate library — GridMind EPC" },
      {
        property: "og:description",
        content: "Unit rates by type, category and supplier, with expiry tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RateLibraryPage,
});

const ALL = "__all__";

const emptyRate: RateRow = {
  rate_type: "material",
  name: "",
  uom: "ea",
  unit_rate: 0,
  currency_code: "USD",
  category: null,
  supplier: null,
  valid_from: null,
  valid_to: null,
  notes: null,
};

function RateLibraryPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [editing, setEditing] = useState<{ id: string | null; row: RateRow } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState("");

  const query = useQuery(rateLibraryQueryOptions(q.trim() || null));
  const canWrite = query.data?.can_write ?? false;
  const today = query.data?.today ?? new Date().toISOString().slice(0, 10);

  const save = useServerFn(upsertRate);
  const remove = useServerFn(deleteRate);
  const importRates = useServerFn(importRateLibrary);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["estimating", "rates"] });

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string | null; row: RateRow }) =>
      save({ data: { id: payload.id, row: RateRowSchema.parse(payload.row) } }),
    onSuccess: () => {
      toast.success("Rate saved.");
      setEditing(null);
      void invalidate();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Rate deleted.");
      void invalidate();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const parsedCsv = useMemo(() => parseRateCsv(csvText), [csvText]);
  const validCsvRows = parsedCsv.filter((r) => r.row).map((r) => r.row as RateRow);

  const importMutation = useMutation({
    mutationFn: () => importRates({ data: { rows: validCsvRows } }),
    onSuccess: (res) => {
      toast.success(`${res.imported} rates imported.`);
      setCsvOpen(false);
      setCsvText("");
      void invalidate();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const categories = useMemo(
    () =>
      [...new Set((query.data?.rates ?? []).map((r) => r.category).filter(Boolean))] as string[],
    [query.data],
  );

  const rows = (query.data?.rates ?? []).filter(
    (r) =>
      (typeFilter === ALL || r.rate_type === typeFilter) &&
      (categoryFilter === ALL || r.category === categoryFilter),
  );

  const columns: DataTableColumn<RateRowRecord>[] = [
    {
      id: "type",
      header: "Type",
      cell: (r) => (
        <Badge variant="mutedOutline">
          {RATE_TYPE_LABELS[r.rate_type as EstimateRateType] ?? r.rate_type}
        </Badge>
      ),
    },
    { id: "name", header: "Name", cell: (r) => <span className="truncate">{r.name}</span> },
    {
      id: "category",
      header: "Category",
      hideBelow: "md",
      cell: (r) => r.category ?? "—",
    },
    { id: "supplier", header: "Supplier", hideBelow: "lg", cell: (r) => r.supplier ?? "—" },
    { id: "uom", header: "UoM", cell: (r) => r.uom },
    {
      id: "rate",
      header: "Unit rate",
      numeric: true,
      cell: (r) => (
        <Num>{formatMoney(r.unit_rate, r.currency_code, { maximumFractionDigits: 2 })}</Num>
      ),
    },
    {
      id: "validity",
      header: "Validity",
      cell: (r) => {
        const v = rateValidity(r.valid_to, today);
        return (
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {formatDate(r.valid_from)} → {formatDate(r.valid_to)}
            </span>
            {v === "expiring" ? (
              <Badge variant="warning">expiring</Badge>
            ) : v === "expired" ? (
              <Badge variant="mutedOutline">expired</Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        canWrite ? (
          <span className="flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Edit ${r.name}`}
              onClick={() =>
                setEditing({
                  id: r.id,
                  row: {
                    rate_type: r.rate_type as EstimateRateType,
                    name: r.name,
                    uom: r.uom,
                    unit_rate: r.unit_rate,
                    currency_code: r.currency_code,
                    category: r.category,
                    supplier: r.supplier,
                    valid_from: r.valid_from,
                    valid_to: r.valid_to,
                    notes: r.notes,
                  },
                })
              }
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${r.name}`}
              onClick={() => deleteMutation.mutate(r.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rate library"
        description="Shared unit rates used by the estimate line editor. Expiring rates are flagged 30 days ahead."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/estimating">
                <ArrowLeft className="mr-2 size-4" /> Estimates
              </Link>
            </Button>
            {canWrite ? (
              <>
                <Button variant="outline" onClick={() => setCsvOpen(true)}>
                  <ClipboardPaste className="mr-2 size-4" /> Import CSV
                </Button>
                <Button onClick={() => setEditing({ id: null, row: emptyRate })}>
                  <Plus className="mr-2 size-4" /> New rate
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {query.isError ? (
        <EmptyState
          icon={Library}
          title="Could not load the rate library"
          description={estimatingErrorMessage(query.error)}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={query.isLoading}
          toolbar={{
            search: (
              <DataTableSearch
                value={q}
                onChange={setQ}
                placeholder="Search name, supplier, category"
                label="Search rates"
              />
            ),
            filters: (
              <>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter by rate type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All types</SelectItem>
                    {ESTIMATE_RATE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {RATE_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]" aria-label="Filter by category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ),
          }}
          emptyState={
            <EmptyState
              icon={Library}
              title="No rates yet"
              description="Add a rate or paste a CSV to build your company rate library."
            />
          }
          mobileCard={(r) => ({
            primary: r.name,
            badge: (
              <Badge variant="mutedOutline">
                {RATE_TYPE_LABELS[r.rate_type as EstimateRateType] ?? r.rate_type}
              </Badge>
            ),
            fields: [
              {
                label: "Unit rate",
                value: `${formatMoney(r.unit_rate, r.currency_code, { maximumFractionDigits: 2 })} / ${r.uom}`,
              },
              { label: "Supplier", value: r.supplier ?? "—" },
              { label: "Valid to", value: formatDate(r.valid_to) },
            ],
          })}
        />
      )}

      {/* Edit / create dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit rate" : "New rate"}</DialogTitle>
            <DialogDescription>
              Rates are unique per type and name within your company.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <RateForm value={editing.row} onChange={(row) => setEditing({ ...editing, row })} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !editing ||
                !RateRowSchema.safeParse(editing.row).success ||
                saveMutation.isPending
              }
              onClick={() => editing && saveMutation.mutate(editing)}
            >
              Save rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV paste import */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import rates from CSV</DialogTitle>
            <DialogDescription>
              Paste rows as {RATE_CSV_HEADERS.join(",")}. Existing rates with the same type and name
              are updated.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="CSV rows"
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="material,PV module 580W,ea,168.50,USD,Modules,Trina,2026-01-01,2026-12-31"
            className="font-mono text-xs"
          />
          {parsedCsv.length > 0 ? (
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {parsedCsv.map((r) => (
                    <tr key={r.line} className="border-b border-border last:border-0">
                      <td className="w-10 px-2 py-1 text-muted-foreground tabular-nums">{r.line}</td>
                      <td className="px-2 py-1">{r.raw.join(" · ")}</td>
                      <td className="px-2 py-1 text-right">
                        {r.row ? (
                          <Badge variant="success">ok</Badge>
                        ) : (
                          <span className="text-destructive">{r.errors.join("; ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={validCsvRows.length === 0 || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              Import {validCsvRows.length} rows
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RateForm({ value, onChange }: { value: RateRow; onChange: (row: RateRow) => void }) {
  const set = (patch: Partial<RateRow>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="rate-type">Type</Label>
        <Select
          value={value.rate_type}
          onValueChange={(v) => set({ rate_type: v as EstimateRateType })}
        >
          <SelectTrigger id="rate-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ESTIMATE_RATE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {RATE_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-name">Name</Label>
        <Input id="rate-name" value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-uom">Unit</Label>
        <Input id="rate-uom" value={value.uom} onChange={(e) => set({ uom: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-value">Unit rate</Label>
        <Input
          id="rate-value"
          type="number"
          min={0}
          step="any"
          value={value.unit_rate}
          onChange={(e) => set({ unit_rate: Number(e.target.value) })}
          className="text-right tabular-nums"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-currency">Currency</Label>
        <Input
          id="rate-currency"
          maxLength={3}
          value={value.currency_code}
          onChange={(e) => set({ currency_code: e.target.value.toUpperCase() })}
          className="font-mono uppercase"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-category">Category</Label>
        <Input
          id="rate-category"
          value={value.category ?? ""}
          onChange={(e) => set({ category: e.target.value || null })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rate-supplier">Supplier</Label>
        <Input
          id="rate-supplier"
          value={value.supplier ?? ""}
          onChange={(e) => set({ supplier: e.target.value || null })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="rate-from">Valid from</Label>
          <Input
            id="rate-from"
            type="date"
            value={value.valid_from ?? ""}
            onChange={(e) => set({ valid_from: e.target.value || null })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rate-to">Valid to</Label>
          <Input
            id="rate-to"
            type="date"
            value={value.valid_to ?? ""}
            onChange={(e) => set({ valid_to: e.target.value || null })}
          />
        </div>
      </div>
      {!RateRowSchema.safeParse(value).success ? (
        <p className="sm:col-span-2 text-xs text-destructive">
          {RateRowSchema.safeParse(value).error?.issues[0]?.message}
        </p>
      ) : null}
    </div>
  );
}
