import { useState, useEffect } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2 } from "lucide-react";

import { getTenantDetail, updateTenantPlan, type PlanTier } from "@/lib/tenants.functions";
import { ModuleAccessTable } from "@/components/module-access-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/tenants/$companyId")({
  head: ({ params }) => ({
    meta: [
      { title: "Tenant detail | GridMind EPC Admin" },
      { name: "description", content: `Manage tenant ${params.companyId}.` },
      { property: "og:title", content: "Tenant detail | GridMind EPC Admin" },
      { property: "og:description", content: "Super admin view of a single GridMind tenant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TenantDetailPage,
  errorComponent: TenantDetailError,
  notFoundComponent: () => (
    <div className="p-8 text-sm text-muted-foreground">Tenant not found.</div>
  ),
});

const PLAN_LABELS: Record<PlanTier, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

function PlanBadge({ tier }: { tier: PlanTier }) {
  const variant = tier === "enterprise" ? "default" : tier === "growth" ? "secondary" : "outline";
  return <Badge variant={variant}>{PLAN_LABELS[tier]}</Badge>;
}

function TenantDetailError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <Card className="m-6">
      <CardHeader>
        <CardTitle>Couldn't load tenant</CardTitle>
        <CardDescription>{error.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function TenantDetailPage() {
  const { companyId } = Route.useParams();
  const qc = useQueryClient();
  const detailFn = useServerFn(getTenantDetail);
  const updatePlanFn = useServerFn(updateTenantPlan);

  const query = useQuery({
    queryKey: ["admin", "tenants", "detail", companyId],
    queryFn: () => detailFn({ data: { companyId } }),
  });

  const [planDraft, setPlanDraft] = useState<PlanTier | null>(null);
  useEffect(() => {
    if (query.data && planDraft === null) setPlanDraft(query.data.plan_tier);
  }, [query.data, planDraft]);

  const mutation = useMutation({
    mutationFn: (tier: PlanTier) => updatePlanFn({ data: { companyId, planTier: tier } }),
    onSuccess: (res) => {
      if (res.changed) toast.success(`Plan updated to ${PLAN_LABELS[res.to as PlanTier]}`);
      else toast.info("Plan unchanged");
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["modules", companyId] });
    },

    onError: (err: Error) => toast.error(err.message || "Failed to update plan"),
  });

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(companyId);
      toast.success("Tenant ID copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{(query.error as Error)?.message ?? "Not found"}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const t = query.data;
  const currentPlan = t.plan_tier;
  const draft = planDraft ?? currentPlan;
  const dirty = draft !== currentPlan;

  return (
    <div className="page-shell max-w-4xl">
      <div>
        <Link
          to="/admin/tenants"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All tenants
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {t.legal_name ?? t.name}
            <PlanBadge tier={currentPlan} />
          </span>
        }
        description={
          <>
            Short name <span className="font-mono">{t.name}</span>
            {t.contact_email ? <> · {t.contact_email}</> : null}
          </>
        }
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="modules">Modules</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tenant ID</CardTitle>
              <CardDescription>
                Use this UUID when opening a support or debugging ticket.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
                {t.id}
              </code>
              <Button variant="outline" size="sm" onClick={copyId}>
                <Copy className="mr-2 h-3 w-3" /> Copy
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan tier</CardTitle>
              <CardDescription>
                Changing the plan is audit-logged. Downgrading from Enterprise auto-disables Green
                H₂.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-end gap-3">
              <div className="flex-1">
                <Select value={draft} onValueChange={(v) => setPlanDraft(v as PlanTier)}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!dirty || mutation.isPending}
                onClick={() => mutation.mutate(draft)}
              >
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Members" value={t.member_count} />
            <StatCard label="Admins" value={t.admin_count} />
            <StatCard label="Pending invites" value={t.invite_count} />
          </div>
        </TabsContent>

        <TabsContent value="modules" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Toggle module access for this tenant. Each change is audit-logged as{" "}
            <span className="font-mono">module_access.changed</span>.
          </p>
          <ModuleAccessTable companyId={companyId} canEdit />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}
