// P-210 — Estimate detail: header totals + draft-only line grid editor.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ChevronDown, ChevronUp, Lock, Plus, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EstimateApprovalCard } from "@/components/estimating/approval-actions-card";
import { MarginWaterfallCard } from "@/components/estimating/margin-waterfall-card";
import { RatePickerButton } from "@/components/estimating/rate-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteEstimateLine,
  reorderEstimateLines,
  upsertEstimateLine,
  type EstimateDetail,
} from "@/lib/estimating.functions";
import { estimateDetailQueryOptions, estimatingErrorMessage } from "@/lib/estimating.query";
import {
  ESTIMATE_RATE_TYPES,
  RATE_TYPE_LABELS,
  UpsertEstimateLineSchema,
  isEstimateEditable,
  lineAmount,
  sumAmounts,
  type EstimateRateType,
} from "@/lib/estimating.rules";
import type { EstimateLineRow } from "@/lib/estimating.server";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/estimating/$id")({
  head: () => ({
    meta: [
      { title: "Estimate detail — GridMind EPC" },
      {
        name: "description",
        content:
          "Edit estimate lines, apply rate-library rates and watch the direct cost recompute line by line.",
      },
      { property: "og:title", content: "Estimate detail — GridMind EPC" },
      {
        property: "og:description",
        content: "Line-by-line cost build-up for a GridMind EPC estimate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EstimateDetailPage,
});

function EstimateDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery(estimateDetailQueryOptions(id));

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={Table2}
        title="Could not load this estimate"
        description={estimatingErrorMessage(query.error)}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <EstimateBody
      detail={query.data}
      queryKey={estimateDetailQueryOptions(id).queryKey}
      onDone={() => queryClient.invalidateQueries({ queryKey: ["estimating"] })}
    />
  );
}

function EstimateBody({
  detail,
  queryKey,
  onDone,
}: {
  detail: EstimateDetail;
  queryKey: readonly unknown[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { estimate, project, opportunity } = detail;
  const editable = isEstimateEditable(estimate.status) && detail.can_write;
  const currency = estimate.currency_code;

  const [lines, setLines] = useState<EstimateLineRow[]>(detail.lines);
  useEffect(() => setLines(detail.lines), [detail.lines]);

  const directCost = useMemo(() => sumAmounts(lines), [lines]);

  const save = useServerFn(upsertEstimateLine);
  const remove = useServerFn(deleteEstimateLine);
  const reorder = useServerFn(reorderEstimateLines);

  const settle = () => {
    void queryClient.invalidateQueries({ queryKey });
    onDone();
  };
  const rollback = (err: unknown, snapshot: EstimateLineRow[]) => {
    setLines(snapshot);
    toast.error(estimatingErrorMessage(err));
  };

  const saveLine = useMutation({
    mutationFn: (line: EstimateLineRow) =>
      save({
        data: UpsertEstimateLineSchema.parse({
          id: line.id.startsWith("new-") ? null : line.id,
          estimate_id: estimate.id,
          line_type: line.line_type as EstimateRateType,
          description: line.description,
          qty: line.qty,
          uom: line.uom,
          unit_rate: line.unit_rate,
          rate_library_id: line.rate_library_id,
          notes: line.notes,
        }),
      }),
    onSuccess: () => {
      toast.success("Line saved.");
      settle();
    },
    onError: (err) => rollback(err, detail.lines),
  });

  const deleteLine = useMutation({
    mutationFn: (lineId: string) => remove({ data: { estimate_id: estimate.id, line_id: lineId } }),
    onMutate: (lineId: string) => {
      const snapshot = lines;
      setLines((prev) => prev.filter((l) => l.id !== lineId));
      return { snapshot };
    },
    onSuccess: () => settle(),
    onError: (err, _v, ctx) => rollback(err, ctx?.snapshot ?? detail.lines),
  });

  const reorderLines = useMutation({
    mutationFn: (ids: string[]) => reorder({ data: { estimate_id: estimate.id, line_ids: ids } }),
    onSuccess: () => settle(),
    onError: (err) => rollback(err, detail.lines),
  });

  function patchLine(lineId: string, patch: Partial<EstimateLineRow>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const next = { ...l, ...patch };
        return { ...next, amount: lineAmount(next.qty, next.unit_rate) };
      }),
    );
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    setLines(next);
    reorderLines.mutate(next.map((l) => l.id));
  }

  function addLine() {
    const draft: EstimateLineRow = {
      id: `new-${Date.now()}`,
      estimate_id: estimate.id,
      line_type: "material",
      description: "",
      qty: 0,
      uom: "ea",
      unit_rate: 0,
      amount: 0,
      rate_library_id: null,
      source_bom_line_id: null,
      sort_order: lines.length,
      notes: null,
    };
    setLines((prev) => [...prev, draft]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{estimate.estimate_number ?? "Draft"}</span>
            <Badge variant="mutedOutline">R{estimate.revision}</Badge>
            <StatusBadge status={estimate.status} />
          </span>
        }
        description={estimate.title}
        actions={
          <Button variant="outline" asChild>
            <Link to="/estimating">
              <ArrowLeft className="mr-2 size-4" /> Back to register
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Project">
            {project ? (
              <Link
                to="/projects/$projectId"
                params={{ projectId: estimate.project_id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                {project.code ?? project.name}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Opportunity">
            {opportunity ? (
              <Link
                to="/crm/opportunities/$opportunityId"
                params={{ opportunityId: opportunity.id }}
                className="text-primary underline-offset-4 hover:underline"
              >
                {opportunity.name}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Currency">
            <span className="font-mono">{currency}</span>
          </Field>
          <Field label="Direct cost">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {formatMoney(directCost, currency, { maximumFractionDigits: 2 })}
            </span>
          </Field>
          <Field label="Bid price">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {formatMoney(estimate.total_price, currency, { maximumFractionDigits: 2 })}
            </span>
          </Field>
        </CardContent>
      </Card>

      <EstimateApprovalCard detail={detail} />

      {!editable ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          {detail.can_write
            ? "This estimate is no longer a draft — lines are read-only."
            : "You have read-only access to estimates."}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState
          icon={Table2}
          title="No lines yet"
          description="Add your first line or import a BOM snapshot."
          action={
            editable ? (
              <Button onClick={addLine}>
                <Plus className="mr-2 size-4" /> Add line
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                <TableHead className="w-20">UoM</TableHead>
                <TableHead className="w-40 text-right">Unit rate</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id}>
                  <TableCell>
                    {editable ? (
                      <Select
                        value={line.line_type}
                        onValueChange={(v) => patchLine(line.id, { line_type: v })}
                      >
                        <SelectTrigger aria-label="Line type" className="h-9">
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
                    ) : (
                      <Badge variant="mutedOutline">
                        {RATE_TYPE_LABELS[line.line_type as EstimateRateType] ?? line.line_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Input
                        aria-label="Description"
                        value={line.description}
                        onChange={(e) => patchLine(line.id, { description: e.target.value })}
                      />
                    ) : (
                      line.description
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Input
                        aria-label="Quantity"
                        type="number"
                        min={0}
                        step="any"
                        value={line.qty}
                        onChange={(e) => patchLine(line.id, { qty: Number(e.target.value) })}
                        className="text-right tabular-nums"
                      />
                    ) : (
                      <span className="tabular-nums">{line.qty}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Input
                        aria-label="Unit of measure"
                        value={line.uom}
                        onChange={(e) => patchLine(line.id, { uom: e.target.value })}
                      />
                    ) : (
                      line.uom
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          aria-label="Unit rate"
                          type="number"
                          min={0}
                          step="any"
                          value={line.unit_rate}
                          onChange={(e) =>
                            patchLine(line.id, {
                              unit_rate: Number(e.target.value),
                              rate_library_id: null,
                            })
                          }
                          className="text-right tabular-nums"
                        />
                        <RatePickerButton
                          onApply={(rate) => {
                            patchLine(line.id, {
                              unit_rate: rate.unit_rate,
                              uom: rate.uom,
                              rate_library_id: rate.id,
                            });
                            const next = lines.find((l) => l.id === line.id);
                            if (next) {
                              saveLine.mutate({
                                ...next,
                                unit_rate: rate.unit_rate,
                                uom: rate.uom,
                                rate_library_id: rate.id,
                              });
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <span className="tabular-nums">
                        {formatMoney(line.unit_rate, currency, { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(lineAmount(line.qty, line.unit_rate), currency, {
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move line up"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ChevronUp className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Move line down"
                          disabled={index === lines.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ChevronDown className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={saveLine.isPending}
                          onClick={() => saveLine.mutate(line)}
                        >
                          Save
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete line"
                          disabled={deleteLine.isPending}
                          onClick={() =>
                            line.id.startsWith("new-")
                              ? setLines((prev) => prev.filter((l) => l.id !== line.id))
                              : deleteLine.mutate(line.id)
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            {editable ? (
              <Button variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 size-4" /> Add line
              </Button>
            ) : (
              <span />
            )}
            <p className="text-sm text-muted-foreground">
              Direct cost{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(directCost, currency, { maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
        </div>
      )}

      <MarginWaterfallCard
        estimateId={estimate.id}
        currency={currency}
        status={estimate.status}
        canWrite={detail.can_write}
        lines={lines.map((l) => ({ qty: l.qty, unit_rate: l.unit_rate }))}
        margins={{
          escalation_pct: Number(estimate.escalation_pct) || 0,
          contingency_pct: Number(estimate.contingency_pct) || 0,
          overhead_pct: Number(estimate.overhead_pct) || 0,
          profit_pct: Number(estimate.profit_pct) || 0,
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}
