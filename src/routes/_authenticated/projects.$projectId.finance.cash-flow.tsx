// P-077 — Cash-flow workbench.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import {
  createCashFlow,
  voidCashFlow,
} from "@/lib/cash-flow.functions";
import {
  cashFlowAccessQueryOptions,
  cashFlowErrorMessage,
  cashFlowsQueryOptions,
} from "@/lib/cash-flow.query";
import { buildCashFlowCsv, downloadCashFlowCsv } from "@/lib/cash-flow.csv";
import {
  addMonths,
  buildPivot,
  monthRange,
  normalizePeriod,
  type CashFlowRow,
  type CreateCashFlowInput,
} from "@/lib/cash-flow.rules";
import { CashFlowCurve } from "@/components/finance/cash-flow-curve";
import { CashFlowKpi } from "@/components/finance/cash-flow-kpi";
import { CashFlowPivot } from "@/components/finance/cash-flow-pivot";
import { CashFlowEntryDialog } from "@/components/finance/cash-flow-entry-dialog";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/cash-flow",
)({
  head: () => ({
    meta: [
      { title: "Cash flow — GridMind EPC" },
      {
        name: "description",
        content:
          "Multi-currency cash-flow ledger: forecast vs actual, cumulative curve, peak funding requirement.",
      },
      { property: "og:title", content: "Cash flow — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Lender-ready cash-flow workspace with FX-at-entry immutability and audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: CashFlowPending,
  errorComponent: CashFlowError,
  component: CashFlowPage,
});

function todayMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function CashFlowPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState<string>(() => addMonths(todayMonthStart(), -2));
  const [to, setTo] = useState<string>(() => addMonths(todayMonthStart(), 11));
  const [showOriginal, setShowOriginal] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);

  const list = useSuspenseQuery(
    cashFlowsQueryOptions({ projectId, from, to }),
  );
  const access = useSuspenseQuery(cashFlowAccessQueryOptions());

  const months = useMemo(() => monthRange(from, to), [from, to]);
  const pivot = useMemo(
    () => buildPivot(list.data.rows, months),
    [list.data.rows, months],
  );

  const totals = useMemo(() => {
    let netF = 0;
    let netA = 0;
    for (const r of list.data.rows) {
      if (r.voided) continue;
      const v = Number(r.amount_base ?? 0);
      const signed = r.direction === "inflow" ? v : -v;
      if (r.kind === "forecast") netF += signed;
      else netA += signed;
    }
    return { netF, netA };
  }, [list.data.rows]);

  const createFn = useServerFn(createCashFlow);
  const voidFn = useServerFn(voidCashFlow);

  const createMut = useMutation({
    mutationFn: (input: CreateCashFlowInput) => createFn({ data: input }),
    onSuccess: () => {
      toast.success("Cash-flow entry added");
      setEntryOpen(false);
      queryClient.invalidateQueries({ queryKey: ["cash-flow", "list", projectId] });
    },
    onError: (e) => toast.error(cashFlowErrorMessage(e)),
  });

  const voidMut = useMutation({
    mutationFn: (row: CashFlowRow) => voidFn({ data: { id: row.id } }),
    onSuccess: () => {
      toast.success("Entry voided");
      queryClient.invalidateQueries({ queryKey: ["cash-flow", "list", projectId] });
    },
    onError: (e) => toast.error(cashFlowErrorMessage(e)),
  });

  const canWrite = access.data.canWrite;
  const canVoid = access.data.canVoid;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Cash flow</h1>
          <p className="text-sm text-muted-foreground">
            Forecast vs actual by month, in {list.data.baseCurrency}. FX rates are
            captured at entry time — historical rows never restate.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="cf-from" className="text-xs">
              From
            </Label>
            <Input
              id="cf-from"
              type="month"
              value={from.slice(0, 7)}
              onChange={(e) => setFrom(normalizePeriod(`${e.target.value}-01`))}
              className="w-36"
            />
          </div>
          <div>
            <Label htmlFor="cf-to" className="text-xs">
              To
            </Label>
            <Input
              id="cf-to"
              type="month"
              value={to.slice(0, 7)}
              onChange={(e) => setTo(normalizePeriod(`${e.target.value}-01`))}
              className="w-36"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="cf-orig"
              checked={showOriginal}
              onCheckedChange={setShowOriginal}
            />
            <Label htmlFor="cf-orig" className="text-xs">
              Show original currency
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCashFlowCsv(
                `cash-flow-${projectId}.csv`,
                buildCashFlowCsv(list.data.rows),
              )
            }
          >
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button
            size="sm"
            onClick={() => setEntryOpen(true)}
            disabled={!canWrite}
            title={canWrite ? undefined : "Requires finance_admin or company_admin"}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add entry
          </Button>
        </div>
      </header>

      <CashFlowKpi
        peak={pivot.peakFundingRequirement}
        peakPeriod={pivot.peakFundingPeriod}
        baseCurrency={list.data.baseCurrency}
        netForecast={totals.netF}
        netActual={totals.netA}
      />

      <Card className="p-4">
        <div className="mb-2 text-sm font-medium text-foreground">
          Cumulative net cash flow ({list.data.baseCurrency})
        </div>
        <CashFlowCurve pivot={pivot} baseCurrency={list.data.baseCurrency} />
      </Card>

      <CashFlowPivot
        pivot={pivot}
        rows={list.data.rows}
        baseCurrency={list.data.baseCurrency}
        showOriginal={showOriginal}
        canVoid={canVoid}
        onVoid={(row) => {
          if (window.confirm(`Void ${row.category} on ${row.period}?`)) {
            voidMut.mutate(row);
          }
        }}
      />

      <CashFlowEntryDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        projectId={projectId}
        baseCurrency={list.data.baseCurrency}
        submitting={createMut.isPending}
        onSubmit={async (input) => {
          await createMut.mutateAsync(input);
        }}
      />
    </div>
  );
}

function CashFlowPending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function CashFlowError({ reset }: { error: unknown; reset: () => void }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">Cash-flow workspace failed to load</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        The server returned an error. Try again — if it persists, check that this
        project has a base currency set in Finance settings.
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
        <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
      </Button>
    </Card>
  );
}
