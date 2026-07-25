// P-075 — Budget workspace: cost codes tree + PO commitment import.
import { useMemo, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, Download, Import, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  createCostCode,
  deleteCostCode,
  getBudgetAccess,
  importPoCommitments,
  listBudgets,
  listCostCodes,
  listProjectPurchaseOrders,
  updateCostCode,
  upsertBudget,
  type EligiblePoRow,
} from "@/lib/budget.functions";
import {
  budgetAccessQueryOptions,
  budgetErrorMessage,
  budgetsQueryOptions,
  costCodesQueryOptions,
  eligiblePosQueryOptions,
} from "@/lib/budget.query";
import { buildBudgetCsv, downloadCsv } from "@/lib/budget.csv";
import { listWbsTree } from "@/lib/wbs.functions";
import { wbsTreeQueryOptions } from "@/lib/wbs-query";

import { BudgetKpiStrip } from "@/components/finance/budget-kpi-strip";
import { BudgetTreeTable } from "@/components/finance/budget-tree-table";
import { CostCodeDialog, type CostCodeFormValues } from "@/components/finance/cost-code-dialog";
import { ImportCommitmentsDialog } from "@/components/finance/import-commitments-dialog";

export const Route = createFileRoute("/_authenticated/projects/$projectId/finance/budget")({
  head: () => ({
    meta: [
      { title: "Budget — GridMind EPC" },
      {
        name: "description",
        content:
          "Project budget: cost codes mapped to WBS, PO commitments, and live variance against forecast.",
      },
      { property: "og:title", content: "Budget — GridMind EPC" },
      {
        property: "og:description",
        content: "Project budget: cost codes mapped to WBS, PO commitments, and live variance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: BudgetPending,
  errorComponent: BudgetError,
  component: BudgetPage,
});

function BudgetPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const listCcFn = useServerFn(listCostCodes);
  const listBudgetsFn = useServerFn(listBudgets);
  const accessFn = useServerFn(getBudgetAccess);
  const eligibleFn = useServerFn(listProjectPurchaseOrders);
  const wbsFn = useServerFn(listWbsTree);

  const ccQuery = useSuspenseQuery(costCodesQueryOptions(listCcFn, projectId));
  const budgetsQuery = useSuspenseQuery(budgetsQueryOptions(listBudgetsFn, projectId));
  const accessQuery = useSuspenseQuery(budgetAccessQueryOptions(accessFn));
  const wbsQuery = useSuspenseQuery(wbsTreeQueryOptions(wbsFn, projectId));

  const [ccDialogOpen, setCcDialogOpen] = useState(false);
  const [ccMode, setCcMode] = useState<"create" | "edit">("create");
  const [ccSelectedId, setCcSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [posLoaded, setPosLoaded] = useState(false);
  const [savingBudgetCode, setSavingBudgetCode] = useState<string | null>(null);

  const eligibleQuery = useSuspenseQuery({
    ...eligiblePosQueryOptions(eligibleFn, projectId),
    enabled: posLoaded,
  } as any);

  const costCodes = ccQuery.data;
  const budgets = budgetsQuery.data;
  const access = accessQuery.data;

  const wbsOptions = useMemo(
    () =>
      wbsQuery.data.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
      })),
    [wbsQuery.data],
  );

  const ccOptions = useMemo(
    () => costCodes.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    [costCodes],
  );

  const defaultCurrency = useMemo(() => {
    const first = budgets[0]?.currency_code;
    return first ?? "USD";
  }, [budgets]);

  const selectedCc = useMemo(
    () => costCodes.find((c) => c.id === ccSelectedId) ?? null,
    [ccSelectedId, costCodes],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["budget"] });
  };

  const createCcFn = useServerFn(createCostCode);
  const updateCcFn = useServerFn(updateCostCode);
  const deleteCcFn = useServerFn(deleteCostCode);
  const upsertBudgetFn = useServerFn(upsertBudget);
  const importFn = useServerFn(importPoCommitments);

  const createCcMut = useMutation({
    mutationFn: (values: CostCodeFormValues) =>
      createCcFn({
        data: {
          projectId,
          code: values.code,
          name: values.name,
          description: values.description ?? null,
          parent_id: values.parent_id ?? null,
          wbs_item_id: values.wbs_item_id ?? null,
          is_active: values.is_active,
        },
      }),
    onSuccess: () => {
      toast.success("Cost code created");
      setCcDialogOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(budgetErrorMessage(e)),
  });

  const updateCcMut = useMutation({
    mutationFn: (values: CostCodeFormValues) =>
      updateCcFn({
        data: {
          id: ccSelectedId!,
          patch: {
            code: values.code,
            name: values.name,
            description: values.description ?? null,
            parent_id: values.parent_id ?? null,
            wbs_item_id: values.wbs_item_id ?? null,
            is_active: values.is_active,
          },
        },
      }),
    onSuccess: () => {
      toast.success("Cost code updated");
      setCcDialogOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(budgetErrorMessage(e)),
  });

  const deleteCcMut = useMutation({
    mutationFn: () => deleteCcFn({ data: { id: ccSelectedId! } }),
    onSuccess: () => {
      toast.success("Cost code deleted");
      setCcDialogOpen(false);
      setCcSelectedId(null);
      invalidate();
    },
    onError: (e) => toast.error(budgetErrorMessage(e)),
  });

  const upsertBudgetMut = useMutation({
    mutationFn: (input: { cost_code_id: string; original_amount: number; currency_code: string }) =>
      upsertBudgetFn({
        data: {
          projectId,
          cost_code_id: input.cost_code_id,
          original_amount: input.original_amount,
          currency_code: input.currency_code,
        },
      }),
    onMutate: (v) => setSavingBudgetCode(v.cost_code_id),
    onSettled: () => setSavingBudgetCode(null),
    onSuccess: () => {
      toast.success("Budget saved");
      invalidate();
    },
    onError: (e) => toast.error(budgetErrorMessage(e)),
  });

  const importMut = useMutation({
    mutationFn: (assignments: Array<{ po_id: string; cost_code_id: string | null }>) =>
      importFn({ data: { projectId, assignments } }),
    onSuccess: (res) => {
      toast.success(
        `Commitments imported (${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ""})`,
      );
      setImportOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(budgetErrorMessage(e)),
  });

  const handleNewCc = () => {
    setCcMode("create");
    setCcSelectedId(null);
    setCcDialogOpen(true);
  };

  const handleEditCc = (id: string) => {
    setCcMode("edit");
    setCcSelectedId(id);
    setCcDialogOpen(true);
  };

  const handleOpenImport = () => {
    setPosLoaded(true);
    setImportOpen(true);
  };

  const handleCsvExport = () => {
    const csv = buildBudgetCsv(costCodes, budgets);
    downloadCsv(`budget-${projectId}.csv`, csv);
  };

  const eligiblePos: EligiblePoRow[] = posLoaded
    ? ((eligibleQuery.data as EligiblePoRow[]) ?? [])
    : [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Banknote size={18} aria-hidden className="text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold text-foreground">Budget</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {access.canWriteCostCodes && (
            <Button size="sm" onClick={handleNewCc}>
              <Plus size={14} className="mr-1" /> New cost code
            </Button>
          )}
          {access.canWriteBudgets && (
            <Button size="sm" variant="outline" onClick={handleOpenImport}>
              <Import size={14} className="mr-1" /> Import PO commitments
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={handleCsvExport}>
            <Download size={14} className="mr-1" /> Export CSV
          </Button>
        </div>
      </header>

      {!access.canWriteBudgets && (
        <Card className="p-3 text-sm text-muted-foreground">
          You have read-only access to budgets. Contact a finance or company admin to edit financial
          rows.
        </Card>
      )}

      <BudgetKpiStrip budgets={budgets} />

      <BudgetTreeTable
        costCodes={costCodes}
        budgets={budgets}
        defaultCurrency={defaultCurrency}
        canWriteBudgets={access.canWriteBudgets}
        canWriteCostCodes={access.canWriteCostCodes}
        onEditCostCode={handleEditCc}
        onEditBudget={handleEditCc}
        savingBudgetForCode={savingBudgetCode}
        onQuickSaveBudget={(cost_code_id, original_amount, currency_code) =>
          upsertBudgetMut.mutate({
            cost_code_id,
            original_amount,
            currency_code,
          })
        }
      />

      <CostCodeDialog
        open={ccDialogOpen}
        onOpenChange={setCcDialogOpen}
        mode={ccMode}
        costCode={selectedCc}
        costCodeOptions={ccOptions}
        wbsOptions={wbsOptions}
        saving={createCcMut.isPending || updateCcMut.isPending}
        onSubmit={(v) => (ccMode === "create" ? createCcMut.mutate(v) : updateCcMut.mutate(v))}
        onDelete={ccMode === "edit" ? () => deleteCcMut.mutate() : undefined}
        deleting={deleteCcMut.isPending}
      />

      <ImportCommitmentsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        loading={posLoaded && eligibleQuery.isFetching}
        pos={eligiblePos}
        costCodes={costCodes}
        saving={importMut.isPending}
        onSubmit={(assignments) => importMut.mutate(assignments)}
      />
    </div>
  );
}

function BudgetPending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function BudgetError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="border-destructive/40 bg-card p-4">
      <p className="text-sm text-foreground">Couldn't load budget: {error.message}</p>
      <Button
        size="sm"
        className="mt-3"
        onClick={() => {
          reset();
          router.invalidate();
        }}
      >
        Retry
      </Button>
    </Card>
  );
}
