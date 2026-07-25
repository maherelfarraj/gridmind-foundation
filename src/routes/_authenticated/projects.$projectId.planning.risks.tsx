// P-074 — Risk register route.
import { useMemo, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  createRisk,
  deleteRisk,
  getRisksAccess,
  listProjectMembers,
  listRisks,
  updateRisk,
} from "@/lib/risks.functions";
import {
  projectMembersQueryOptions,
  riskErrorMessage,
  risksAccessQueryOptions,
  risksListQueryOptions,
} from "@/lib/risks.query";
import { registerAgeDays, sumContingency, riskWritableSchema } from "@/lib/risks.rules";
import { SectionHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldAlert } from "lucide-react";

import { RiskDrawer } from "@/components/planning/risk-drawer";
import { RiskKpiStrip } from "@/components/planning/risk-kpi-strip";
import { RiskMatrix } from "@/components/planning/risk-matrix";
import { RiskRegisterTable } from "@/components/planning/risk-register-table";

export const Route = createFileRoute("/_authenticated/projects/$projectId/planning/risks")({
  head: () => ({
    meta: [
      { title: "Risk Register — GridMind EPC" },
      {
        name: "description",
        content:
          "Project risk register with P×I heat matrix, mitigation plans, and register-age freshness KPI.",
      },
      { property: "og:title", content: "Risk Register — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Project risk register with P×I heat matrix, mitigation plans, and register-age freshness KPI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  pendingComponent: RisksPending,
  errorComponent: RisksError,
  component: RisksPage,
});

type FormValues = z.infer<typeof riskWritableSchema>;

function RisksPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const listFn = useServerFn(listRisks);
  const accessFn = useServerFn(getRisksAccess);
  const membersFn = useServerFn(listProjectMembers);

  const risksQuery = useSuspenseQuery(risksListQueryOptions(listFn, projectId));
  const accessQuery = useSuspenseQuery(risksAccessQueryOptions(accessFn));
  const membersQuery = useSuspenseQuery(projectMembersQueryOptions(membersFn, projectId));

  const risks = risksQuery.data;
  const canWrite = accessQuery.data.canWrite;

  const [tab, setTab] = useState<"matrix" | "register">("matrix");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");

  const selected = useMemo(
    () => (selectedId ? (risks.find((r) => r.id === selectedId) ?? null) : null),
    [risks, selectedId],
  );

  const openCount = useMemo(() => risks.filter((r) => r.status === "open").length, [risks]);
  const highCount = useMemo(() => risks.filter((r) => r.score >= 15).length, [risks]);
  const contingency = useMemo(() => sumContingency(risks), [risks]);
  const ageDays = useMemo(() => registerAgeDays(risks), [risks]);

  const createFn = useServerFn(createRisk);
  const updateFn = useServerFn(updateRisk);
  const deleteFn = useServerFn(deleteRisk);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["risks", "list", projectId],
    });

  const createMut = useMutation({
    mutationFn: (values: FormValues) => createFn({ data: { projectId, ...values } }),
    onSuccess: () => {
      toast.success("Risk logged");
      setDrawerOpen(false);
      setSelectedId(null);
      invalidate();
    },
    onError: (e) => toast.error(riskErrorMessage(e)),
  });

  const updateMut = useMutation({
    mutationFn: (values: FormValues) => updateFn({ data: { id: selectedId!, patch: values } }),
    onSuccess: () => {
      toast.success("Risk updated");
      setDrawerOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(riskErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { id: selectedId! } }),
    onSuccess: () => {
      toast.success("Risk deleted");
      setDrawerOpen(false);
      setSelectedId(null);
      invalidate();
    },
    onError: (e) => toast.error(riskErrorMessage(e)),
  });

  const handleNew = () => {
    setMode("create");
    setSelectedId(null);
    setDrawerOpen(true);
  };

  const handleSelect = (id: string) => {
    setMode("edit");
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const handleSubmit = (values: FormValues) => {
    if (mode === "create") createMut.mutate(values);
    else updateMut.mutate(values);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Risks"
        description="Probability × impact register with mitigation tracking."
      />

      {!canWrite && (
        <Card className="p-4 text-sm text-muted-foreground">
          You have read-only access to the risk register. Contact a project, HSE, finance, or
          company admin to log or edit risks.
        </Card>
      )}

      <RiskKpiStrip
        openCount={openCount}
        highCount={highCount}
        contingency={contingency}
        ageDays={ageDays}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="register">Register</TabsTrigger>
        </TabsList>
        <TabsContent value="matrix" className="mt-4">
          {risks.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={ShieldAlert}
                title="No risks logged yet"
                description="A stale register fails lender due diligence."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={handleNew}>
                      Log the first risk
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Card className="p-4">
              <RiskMatrix risks={risks} onSelect={handleSelect} />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="register" className="mt-4">
          <RiskRegisterTable
            risks={risks}
            canWrite={canWrite}
            onNew={handleNew}
            onSelect={handleSelect}
          />
        </TabsContent>
      </Tabs>

      <RiskDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={mode}
        risk={selected}
        members={membersQuery.data}
        canWrite={canWrite}
        saving={createMut.isPending || updateMut.isPending}
        onSubmit={handleSubmit}
        onDelete={mode === "edit" ? () => deleteMut.mutate() : undefined}
        deleting={deleteMut.isPending}
      />
    </div>
  );
}

function RisksPending() {
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

function RisksError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="border-destructive/40 bg-card p-4">
      <p className="text-sm text-foreground">Couldn't load risks: {error.message}</p>
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
