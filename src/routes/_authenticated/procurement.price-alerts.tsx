// P-070 — Material price alerts workbench.
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
  BellRing,
  CheckCircle2,
  Download,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  acknowledgePriceAlert,
  deletePriceAlert,
  getPriceAlertAccess,
  listPriceAlerts,
  recordPriceObservation,
  upsertPriceAlertSubscription,
  type PriceAlertRow,
} from "@/lib/price-alerts.functions";
import {
  errorMessage,
  priceAlertsAccessQueryOptions,
  priceAlertsListQueryOptions,
} from "@/lib/price-alerts-query";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  type MaterialCategory,
} from "@/lib/procurement-extras-rules";
import { downloadCsv, toCsv } from "@/lib/csv";

export const Route = createFileRoute(
  "/_authenticated/procurement/price-alerts",
)({
  head: () => ({
    meta: [
      { title: "Material price alerts — GridMind EPC" },
      {
        name: "description",
        content:
          "Track commodity price indices for modules, cells, transformers and cables. Get alerts when prices move beyond your threshold.",
      },
      { property: "og:title", content: "Material price alerts — GridMind EPC" },
      {
        property: "og:description",
        content: "Threshold-based commodity price watchers for EPC procurement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PriceAlertsPage,
  errorComponent: PriceAlertsError,
  pendingComponent: PriceAlertsPending,
});

function PriceAlertsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Failed to load price alerts</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}

function PriceAlertsPending() {
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

function fmtPrice(row: PriceAlertRow): string {
  if (row.index_price == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: row.currency_code || "USD",
      maximumFractionDigits: 4,
    }).format(row.index_price);
  } catch {
    return `${row.index_price} ${row.currency_code}`;
  }
}

function PriceAlertsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPriceAlerts);
  const accessFn = useServerFn(getPriceAlertAccess);
  const subscribeFn = useServerFn(upsertPriceAlertSubscription);
  const observeFn = useServerFn(recordPriceObservation);
  const ackFn = useServerFn(acknowledgePriceAlert);
  const delFn = useServerFn(deletePriceAlert);

  const { data: access } = useSuspenseQuery(
    priceAlertsAccessQueryOptions(accessFn),
  );
  const { data: rows } = useSuspenseQuery(priceAlertsListQueryOptions(listFn));

  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [observeFor, setObserveFor] = useState<PriceAlertRow | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["price-alerts"] });

  const triggeredCount = rows.filter((r) => r.triggered).length;
  const avgChange = useMemo(() => {
    const known = rows
      .map((r) => r.change_pct)
      .filter((v): v is number => v != null);
    if (known.length === 0) return null;
    return known.reduce((a, b) => a + b, 0) / known.length;
  }, [rows]);

  const subscribeMutation = useMutation({
    mutationFn: (vars: Parameters<typeof subscribeFn>[0]["data"]) =>
      subscribeFn({ data: vars }),
    onSuccess: () => {
      invalidate();
      toast.success("Subscription saved");
      setSubscribeOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const observeMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      index_price: number;
      source?: string | null;
    }) => observeFn({ data: vars }),
    onSuccess: (res) => {
      invalidate();
      if (res.triggered) {
        toast.warning(
          `Threshold crossed · ${res.changePct?.toFixed(2) ?? "?"}% change`,
        );
      } else {
        toast.success("Observation recorded");
      }
      setObserveFor(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => ackFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Alert acknowledged");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Subscription removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function exportCsv() {
    const headers = [
      "Category",
      "Region",
      "Unit",
      "Latest price",
      "Currency",
      "Previous price",
      "Change %",
      "Threshold %",
      "Triggered",
      "Observed at",
      "Source",
    ];
    const data = rows.map((r) => [
      MATERIAL_CATEGORY_LABELS[r.category],
      r.region,
      r.unit,
      r.index_price ?? "",
      r.currency_code,
      r.previous_price ?? "",
      r.change_pct ?? "",
      r.alert_threshold_pct,
      r.triggered ? "yes" : "no",
      r.observed_at,
      r.source ?? "",
    ]);
    downloadCsv(
      `price-alerts-${format(new Date(), "yyyyMMdd")}.csv`,
      toCsv(headers, data),
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Procurement · Price alerts
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Material price alerts
          </h1>
          <p className="text-sm text-muted-foreground">
            Watch commodity indices per category and region. Log observations
            and get flagged when moves exceed your threshold.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          {access.canWrite ? (
            <Dialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Subscribe
                </Button>
              </DialogTrigger>
              <SubscribeDialog
                submitting={subscribeMutation.isPending}
                onSubmit={(vars) => subscribeMutation.mutate(vars)}
              />
            </Dialog>
          ) : null}
        </div>
      </header>

      {triggeredCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <BellRing className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <div className="font-medium text-destructive">
              {triggeredCount} price alert
              {triggeredCount === 1 ? "" : "s"} triggered
            </div>
            <div className="text-muted-foreground">
              Review triggered rows below and acknowledge once actioned.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Subscriptions" value={String(rows.length)} hint="Active watchers" />
        <Kpi
          label="Triggered"
          value={String(triggeredCount)}
          hint="Moves ≥ threshold"
          tone={triggeredCount > 0 ? "destructive" : "muted"}
        />
        <Kpi
          label="Avg change"
          value={avgChange == null ? "—" : `${avgChange.toFixed(2)}%`}
          hint="Across watched indices"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No price alerts yet — subscribe to a material category to start
          tracking prices.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Latest price</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className={r.triggered ? "bg-destructive/5" : undefined}
                >
                  <TableCell className="font-medium">
                    {MATERIAL_CATEGORY_LABELS[r.category]}
                  </TableCell>
                  <TableCell className="capitalize">{r.region}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.unit}
                  </TableCell>
                  <TableCell>{fmtPrice(r)}</TableCell>
                  <TableCell>
                    <ChangeChip value={r.change_pct} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    ±{Number(r.alert_threshold_pct).toFixed(2)}%
                  </TableCell>
                  <TableCell>
                    {r.triggered ? (
                      <Badge variant="destructive">Triggered</Badge>
                    ) : r.index_price == null ? (
                      <Badge variant="outline">No data</Badge>
                    ) : (
                      <Badge variant="secondary">Watching</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.observed_at}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {access.canWrite ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setObserveFor(r)}
                          >
                            Record
                          </Button>
                          {r.triggered ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => ackMutation.mutate(r.id)}
                            >
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              Ack
                            </Button>
                          ) : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete subscription"
                            onClick={() => {
                              if (confirm("Remove this price alert?"))
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={observeFor != null}
        onOpenChange={(o) => !o && setObserveFor(null)}
      >
        {observeFor ? (
          <ObserveDialog
            row={observeFor}
            submitting={observeMutation.isPending}
            onSubmit={(vars) => observeMutation.mutate(vars)}
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

function ChangeChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const up = value > 0;
  const down = value < 0;
  const cls = up
    ? "text-destructive"
    : down
      ? "text-primary"
      : "text-muted-foreground";
  const Icon = up ? TrendingUp : down ? TrendingDown : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------
function SubscribeDialog({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (vars: {
    category: MaterialCategory;
    region: string;
    unit: string;
    currency_code: string;
    alert_threshold_pct: number;
    source?: string | null;
  }) => void;
}) {
  const [category, setCategory] = useState<MaterialCategory>("module");
  const [region, setRegion] = useState("global");
  const [unit, setUnit] = useState("USD/Wp");
  const [currency, setCurrency] = useState("USD");
  const [threshold, setThreshold] = useState("5");
  const [source, setSource] = useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Subscribe to a material index</DialogTitle>
        <DialogDescription>
          Watch prices for a category & region. One subscription per unique
          (category, region).
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MaterialCategory)}
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
            <Label>Region</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. global, EU, MENA"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Unit</Label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="USD/Wp"
            />
          </div>
          <div className="space-y-1">
            <Label>Currency</Label>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </div>
          <div className="space-y-1">
            <Label>Threshold %</Label>
            <Input
              type="number"
              step="0.1"
              min="0.1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Source (optional)</Label>
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. PV InfoLink weekly report"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={submitting}
          onClick={() =>
            onSubmit({
              category,
              region: region.trim() || "global",
              unit,
              currency_code: currency,
              alert_threshold_pct: Number(threshold),
              source: source.trim() || null,
            })
          }
        >
          {submitting ? "Saving…" : "Save subscription"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ObserveDialog({
  row,
  submitting,
  onSubmit,
}: {
  row: PriceAlertRow;
  submitting: boolean;
  onSubmit: (vars: {
    id: string;
    index_price: number;
    source?: string | null;
  }) => void;
}) {
  const [price, setPrice] = useState(
    row.index_price == null ? "" : String(row.index_price),
  );
  const [source, setSource] = useState(row.source ?? "");
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Record price observation</DialogTitle>
        <DialogDescription>
          {MATERIAL_CATEGORY_LABELS[row.category]} · {row.region} · {row.unit}
          {row.index_price != null ? (
            <> · previous {row.index_price} {row.currency_code}</>
          ) : null}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1">
          <Label>New price ({row.unit})</Label>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Source (optional)</Label>
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. market report Q4"
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={submitting || price === ""}
          onClick={() =>
            onSubmit({
              id: row.id,
              index_price: Number(price),
              source: source.trim() || null,
            })
          }
        >
          {submitting ? "Saving…" : "Record"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
