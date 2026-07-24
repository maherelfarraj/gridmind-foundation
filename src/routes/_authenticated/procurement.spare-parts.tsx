// P-070 — Spare parts catalog.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  AlertTriangle,
  Download,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  adjustStock,
  deleteSparePart,
  getSparePartsAccess,
  listSpareParts,
  listVendorsForParts,
  upsertSparePart,
  type SparePartRow,
} from "@/lib/spare-parts.functions";
import {
  errorMessage,
  sparePartsAccessQueryOptions,
  sparePartsListQueryOptions,
  sparePartsVendorsQueryOptions,
} from "@/lib/spare-parts-query";
import {
  isLowStock,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  type MaterialCategory,
  type SparePartInput,
} from "@/lib/procurement-extras-rules";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute(
  "/_authenticated/procurement/spare-parts",
)({
  head: () => ({
    meta: [
      { title: "Spare parts — GridMind EPC" },
      {
        name: "description",
        content:
          "Catalog of spare parts with reorder points, safety stock and preferred vendors for O&M operations.",
      },
      { property: "og:title", content: "Spare parts — GridMind EPC" },
      {
        property: "og:description",
        content: "Spare parts inventory for utility-scale renewable EPC O&M.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SparePartsPage,
  errorComponent: SparePartsError,
  pendingComponent: SparePartsPending,
});

function SparePartsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Failed to load spare parts</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}

function SparePartsPending() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function fmtMoney(v: number | null, currency: string | null): string {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(v);
  } catch {
    return `${v} ${currency ?? ""}`.trim();
  }
}

function SparePartsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSpareParts);
  const accessFn = useServerFn(getSparePartsAccess);
  const vendorsFn = useServerFn(listVendorsForParts);
  const upsertFn = useServerFn(upsertSparePart);
  const adjustFn = useServerFn(adjustStock);
  const delFn = useServerFn(deleteSparePart);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MaterialCategory | "all">("all");
  const [editingPart, setEditingPart] = useState<SparePartRow | "new" | null>(
    null,
  );
  const [adjustingPart, setAdjustingPart] = useState<SparePartRow | null>(null);

  const { data: access } = useSuspenseQuery(
    sparePartsAccessQueryOptions(accessFn),
  );
  const { data: rows } = useSuspenseQuery(
    sparePartsListQueryOptions(listFn, {
      search,
      category: category === "all" ? null : category,
    }),
  );
  const { data: vendors } = useSuspenseQuery(
    sparePartsVendorsQueryOptions(vendorsFn),
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["spare-parts"] });

  const lowStockCount = useMemo(
    () => rows.filter((r) => isLowStock(r.qty_on_hand, r.reorder_point)).length,
    [rows],
  );
  const totalValue = useMemo(() => {
    let sum = 0;
    for (const r of rows) if (r.unit_cost != null) sum += r.unit_cost * r.qty_on_hand;
    return sum;
  }, [rows]);

  const upsertMutation = useMutation({
    mutationFn: (vars: SparePartInput) => upsertFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Part saved");
      setEditingPart(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const adjustMutation = useMutation({
    mutationFn: (vars: { id: string; delta: number; reason: string }) =>
      adjustFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Stock adjusted");
      setAdjustingPart(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Part removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function exportCsv() {
    const headers = [
      "Part #",
      "Name",
      "Category",
      "Compatible equipment",
      "UOM",
      "Unit cost",
      "Currency",
      "Preferred vendor",
      "Qty on hand",
      "Reorder point",
      "Safety stock",
      "Lead time (days)",
      "Location",
    ];
    const data = rows.map((r) => [
      r.part_number,
      r.name,
      MATERIAL_CATEGORY_LABELS[r.category],
      r.compatible_equipment ?? "",
      r.uom,
      r.unit_cost ?? "",
      r.currency_code ?? "",
      r.preferred_vendor_name ?? "",
      r.qty_on_hand,
      r.reorder_point,
      r.safety_stock,
      r.lead_time_days ?? "",
      r.location ?? "",
    ]);
    downloadCsv(
      `spare-parts-${format(new Date(), "yyyyMMdd")}.csv`,
      toCsv(headers, data),
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Package className="h-3.5 w-3.5" /> Procurement · Spare parts
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Spare parts catalog
          </h1>
          <p className="text-sm text-muted-foreground">
            Track on-hand quantities, reorder points, and preferred vendors for
            O&amp;M consumables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          {access.canWrite ? (
            <Button size="sm" onClick={() => setEditingPart("new")}>
              <Plus className="mr-2 h-4 w-4" />
              Add part
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Parts tracked" value={String(rows.length)} hint="In catalog" />
        <Kpi
          label="Below reorder point"
          value={`${lowStockCount} part${lowStockCount === 1 ? "" : "s"}`}
          hint="Time to restock"
          tone={lowStockCount > 0 ? "destructive" : "muted"}
        />
        <Kpi
          label="On-hand value"
          value={totalValue === 0 ? "—" : fmtMoney(totalValue, rows[0]?.currency_code ?? "USD")}
          hint="Qty × unit cost"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search part #, name, equipment…"
          className="w-72"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as MaterialCategory | "all")}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {MATERIAL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {MATERIAL_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No spare parts found — add your first part to seed the catalog.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>On hand</TableHead>
                <TableHead>Reorder</TableHead>
                <TableHead>Safety</TableHead>
                <TableHead>Lead time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Unit cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const low = isLowStock(r.qty_on_hand, r.reorder_point);
                return (
                  <TableRow key={r.id} className={low ? "bg-destructive/5" : undefined}>
                    <TableCell className="font-mono text-xs">
                      {r.part_number}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.compatible_equipment ? (
                        <div className="text-xs text-muted-foreground">
                          {r.compatible_equipment}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {MATERIAL_CATEGORY_LABELS[r.category]}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.preferred_vendor_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.qty_on_hand}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.uom}
                        </span>
                        {low ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Low
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{r.reorder_point}</TableCell>
                    <TableCell>{r.safety_stock}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.lead_time_days == null ? "—" : `${r.lead_time_days}d`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.location ?? "—"}
                    </TableCell>
                    <TableCell>{fmtMoney(r.unit_cost, r.currency_code)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {access.canWrite ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAdjustingPart(r)}
                            >
                              Adjust
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Edit"
                              onClick={() => setEditingPart(r)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Delete"
                              onClick={() => {
                                if (confirm(`Remove ${r.part_number}?`))
                                  deleteMutation.mutate(r.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editingPart != null}
        onOpenChange={(o) => !o && setEditingPart(null)}
      >
        {editingPart != null ? (
          <PartFormDialog
            initial={editingPart === "new" ? null : editingPart}
            vendors={vendors}
            submitting={upsertMutation.isPending}
            onSubmit={(vars) => upsertMutation.mutate(vars)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={adjustingPart != null}
        onOpenChange={(o) => !o && setAdjustingPart(null)}
      >
        {adjustingPart ? (
          <AdjustStockDialog
            part={adjustingPart}
            submitting={adjustMutation.isPending}
            onSubmit={(vars) => adjustMutation.mutate(vars)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "muted" | "destructive";
}) {
  const valueClass =
    tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-semibold ${valueClass}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function PartFormDialog({
  initial,
  vendors,
  submitting,
  onSubmit,
}: {
  initial: SparePartRow | null;
  vendors: Array<{ id: string; name: string }>;
  submitting: boolean;
  onSubmit: (vars: SparePartInput) => void;
}) {
  const [f, setF] = useState<{
    part_number: string;
    name: string;
    description: string;
    category: MaterialCategory;
    compatible_equipment: string;
    uom: string;
    unit_cost: string;
    currency_code: string;
    preferred_vendor_id: string;
    reorder_point: string;
    safety_stock: string;
    lead_time_days: string;
    qty_on_hand: string;
    location: string;
  }>({
    part_number: initial?.part_number ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    category: (initial?.category as MaterialCategory) ?? "other",
    compatible_equipment: initial?.compatible_equipment ?? "",
    uom: initial?.uom ?? "ea",
    unit_cost: initial?.unit_cost == null ? "" : String(initial.unit_cost),
    currency_code: initial?.currency_code ?? "USD",
    preferred_vendor_id: initial?.preferred_vendor_id ?? "",
    reorder_point: String(initial?.reorder_point ?? 0),
    safety_stock: String(initial?.safety_stock ?? 0),
    lead_time_days:
      initial?.lead_time_days == null ? "" : String(initial.lead_time_days),
    qty_on_hand: String(initial?.qty_on_hand ?? 0),
    location: initial?.location ?? "",
  });

  const update = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{initial ? "Edit spare part" : "Add spare part"}</DialogTitle>
        <DialogDescription>
          Track stock levels, reorder points and preferred vendors.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Part number *</Label>
            <Input
              value={f.part_number}
              onChange={(e) => update("part_number", e.target.value)}
              disabled={!!initial}
            />
          </div>
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input
              value={f.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Description</Label>
          <Textarea
            rows={2}
            value={f.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Category</Label>
            <Select
              value={f.category}
              onValueChange={(v) => update("category", v as MaterialCategory)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {MATERIAL_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>UOM</Label>
            <Input
              value={f.uom}
              onChange={(e) => update("uom", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Compatible equipment</Label>
            <Input
              value={f.compatible_equipment}
              onChange={(e) => update("compatible_equipment", e.target.value)}
              placeholder="e.g. Sungrow SG3125 inverter"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Unit cost</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={f.unit_cost}
              onChange={(e) => update("unit_cost", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Input
              value={f.currency_code}
              maxLength={3}
              onChange={(e) =>
                update("currency_code", e.target.value.toUpperCase())
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Preferred vendor</Label>
            <Select
              value={f.preferred_vendor_id || "__none"}
              onValueChange={(v) =>
                update("preferred_vendor_id", v === "__none" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Qty on hand</Label>
            <Input
              type="number"
              min="0"
              value={f.qty_on_hand}
              onChange={(e) => update("qty_on_hand", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Reorder point</Label>
            <Input
              type="number"
              min="0"
              value={f.reorder_point}
              onChange={(e) => update("reorder_point", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Safety stock</Label>
            <Input
              type="number"
              min="0"
              value={f.safety_stock}
              onChange={(e) => update("safety_stock", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Lead time (d)</Label>
            <Input
              type="number"
              min="0"
              value={f.lead_time_days}
              onChange={(e) => update("lead_time_days", e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Location</Label>
          <Input
            value={f.location}
            onChange={(e) => update("location", e.target.value)}
            placeholder="e.g. Site A warehouse · Rack 3"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={submitting || !f.part_number || !f.name}
          onClick={() =>
            onSubmit({
              id: initial?.id,
              part_number: f.part_number,
              name: f.name,
              description: f.description || null,
              category: f.category,
              compatible_equipment: f.compatible_equipment || null,
              uom: f.uom || "ea",
              unit_cost: f.unit_cost === "" ? null : Number(f.unit_cost),
              currency_code: f.currency_code || null,
              preferred_vendor_id: f.preferred_vendor_id || null,
              reorder_point: Number(f.reorder_point || 0),
              safety_stock: Number(f.safety_stock || 0),
              lead_time_days:
                f.lead_time_days === "" ? null : Number(f.lead_time_days),
              qty_on_hand: Number(f.qty_on_hand || 0),
              location: f.location || null,
            })
          }
        >
          {submitting ? "Saving…" : initial ? "Save changes" : "Add part"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AdjustStockDialog({
  part,
  submitting,
  onSubmit,
}: {
  part: SparePartRow;
  submitting: boolean;
  onSubmit: (vars: { id: string; delta: number; reason: string }) => void;
}) {
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");
  const parsedDelta = Number(delta);
  const preview =
    Number.isFinite(parsedDelta) && parsedDelta !== 0
      ? Math.max(0, part.qty_on_hand + parsedDelta)
      : part.qty_on_hand;
  const valid =
    Number.isFinite(parsedDelta) && parsedDelta !== 0 && reason.trim().length >= 3;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Adjust stock · {part.part_number}</DialogTitle>
        <DialogDescription>
          {part.name} — current {part.qty_on_hand} {part.uom}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1 col-span-1">
            <Label>Delta (± {part.uom})</Label>
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>New qty on hand</Label>
            <div className="flex h-10 items-center rounded-md border border-border px-3 text-sm font-medium">
              {preview} {part.uom}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Reason *</Label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Received from Vestas RMA, or issued to Site B outage"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={submitting || !valid}
          onClick={() =>
            onSubmit({ id: part.id, delta: parsedDelta, reason: reason.trim() })
          }
        >
          {submitting ? "Saving…" : "Adjust stock"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
