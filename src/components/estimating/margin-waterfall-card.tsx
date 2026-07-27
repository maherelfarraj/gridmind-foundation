// P-211 — Margin waterfall editor: four percentage inputs, a live staged bar
// chart and the staged build-up table. Draft estimates edit; everything else
// renders read-only.
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BadgeCheck, Lock, Save } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { markEstimatePriced, saveEstimateMargins } from "@/lib/estimating.functions";
import { estimatingErrorMessage } from "@/lib/estimating.query";
import {
  combinedMarginPct,
  computeEstimate,
  estimateMarginsSchema,
  type BuildupStage,
  type MarginInput,
} from "@/lib/estimating/buildup";
import { formatMoney } from "@/lib/format";

type Line = { qty: number; unit_rate: number };

const FIELDS = [
  { name: "escalation_pct", label: "Escalation %" },
  { name: "contingency_pct", label: "Contingency %" },
  { name: "overhead_pct", label: "Overhead %" },
  { name: "profit_pct", label: "Profit %" },
] as const;

const STAGE_COLORS: Record<BuildupStage["key"], string> = {
  direct: "hsl(var(--chart-1))",
  escalation: "hsl(var(--chart-2))",
  contingency: "hsl(var(--chart-3))",
  overhead: "hsl(var(--chart-4))",
  profit: "hsl(var(--chart-5))",
};

function money(v: number, currency: string) {
  return formatMoney(v, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v: number | null) {
  return v == null ? "—" : `${v.toFixed(3)}%`;
}

export function MarginWaterfallCard({
  estimateId,
  currency,
  status,
  lines,
  margins,
  canWrite,
}: {
  estimateId: string;
  currency: string;
  status: string;
  lines: Line[];
  margins: MarginInput;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const editable = canWrite && status === "draft";

  const form = useForm<MarginInput>({
    resolver: zodResolver(estimateMarginsSchema),
    mode: "onChange",
    defaultValues: margins,
  });

  useEffect(() => {
    form.reset(margins);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [margins.escalation_pct, margins.contingency_pct, margins.overhead_pct, margins.profit_pct]);

  const watched = form.watch();
  const safeMargins: MarginInput = useMemo(
    () => ({
      escalation_pct: Number(watched.escalation_pct) || 0,
      contingency_pct: Number(watched.contingency_pct) || 0,
      overhead_pct: Number(watched.overhead_pct) || 0,
      profit_pct: Number(watched.profit_pct) || 0,
    }),
    [watched.escalation_pct, watched.contingency_pct, watched.overhead_pct, watched.profit_pct],
  );

  const buildup = useMemo(() => computeEstimate(lines, safeMargins), [lines, safeMargins]);
  const combined = combinedMarginPct(safeMargins);

  const save = useServerFn(saveEstimateMargins);
  const price = useServerFn(markEstimatePriced);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["estimating"] });

  const saveMutation = useMutation({
    mutationFn: (values: MarginInput) => save({ data: { estimate_id: estimateId, ...values } }),
    onSuccess: (res) => {
      toast.success(`Margins saved — bid price ${money(res.total_price, currency)}.`);
      void invalidate();
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  const priceMutation = useMutation({
    mutationFn: () => price({ data: { estimate_id: estimateId } }),
    onSuccess: (res) => {
      toast.success(`Estimate priced at ${money(res.total_price, currency)}.`);
      void invalidate();
    },
    onError: (err) => {
      const issues = pricingIssues(err);
      toast.error(estimatingErrorMessage(err), {
        description: issues.length
          ? issues.map((i) => `${i.description}: ${i.reason}`).join(" · ")
          : undefined,
      });
    },
  });

  const chartData = buildup.stages.map((s) => ({
    name: s.label,
    value: s.key === "direct" ? s.amount : s.amount,
    stage: s,
  }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          Cost build-up &amp; margins
          {!editable ? (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Lock className="size-3" aria-hidden /> read-only
            </span>
          ) : null}
        </CardTitle>
        {editable ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!form.formState.isValid || saveMutation.isPending}
              onClick={form.handleSubmit((v) => saveMutation.mutate(v))}
            >
              <Save className="mr-2 size-4" aria-hidden /> Save margins
            </Button>
            <Button
              size="sm"
              disabled={priceMutation.isPending || form.formState.isDirty}
              title={
                form.formState.isDirty ? "Save your margin changes first" : "Lock in the bid price"
              }
              onClick={() => priceMutation.mutate()}
            >
              <BadgeCheck className="mr-2 size-4" aria-hidden /> Save as priced
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => {
            const error = form.formState.errors[f.name];
            return (
              <div key={f.name} className="space-y-2">
                <Label htmlFor={f.name}>{f.label}</Label>
                <Input
                  id={f.name}
                  type="number"
                  min={0}
                  max={50}
                  step="0.001"
                  disabled={!editable}
                  className="text-right tabular-nums"
                  aria-invalid={error ? true : undefined}
                  {...form.register(f.name, { valueAsNumber: true })}
                />
                {error ? (
                  <p className="text-xs text-destructive">
                    Must be between 0% and 50% — {error.message}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {buildup.warnings.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>Margin check</AlertTitle>
            <AlertDescription>
              {buildup.warnings.join(" · ")} (combined {combined.toFixed(3)}%).
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                className="text-xs"
                stroke="currentColor"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={72}
                className="text-xs"
                stroke="currentColor"
                tickFormatter={(v: number) =>
                  formatMoney(v, currency, { maximumFractionDigits: 0 }) ?? ""
                }
              />
              <Tooltip
                cursor={{ className: "fill-muted/40" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const stage = (payload[0].payload as { stage: BuildupStage }).stage;
                  return (
                    <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                      <p className="font-medium">{stage.label}</p>
                      <p className="mt-1 text-muted-foreground">{stage.formula}</p>
                      <p className="mt-1 tabular-nums">{money(stage.amount, currency)}</p>
                      <p className="text-muted-foreground tabular-nums">
                        Running total {money(stage.running_total, currency)}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((d) => (
                  <Cell key={d.stage.key} fill={STAGE_COLORS[d.stage.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <Separator />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Running total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildup.stages.map((s) => (
              <TableRow key={s.key} title={s.formula}>
                <TableCell>{s.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.key === "direct" ? "—" : money(s.base, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pct(s.pct)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(s.amount, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(s.running_total, currency)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-border">
              <TableCell colSpan={4} className="font-medium">
                Cost subtotal (before profit)
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {money(buildup.subtotal, currency)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} className="text-base font-semibold">
                Bid price
              </TableCell>
              <TableCell className="text-right text-base font-semibold tabular-nums">
                {money(buildup.total_price, currency)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Pull the typed 422 line issues out of a server-fn error envelope. */
function pricingIssues(err: unknown): { description: string; reason: string }[] {
  const body = (err as { body?: unknown })?.body;
  if (typeof body !== "string") return [];
  try {
    const parsed = JSON.parse(body) as {
      issues?: { description: string; reason: string }[];
    };
    return parsed.issues ?? [];
  } catch {
    return [];
  }
}
