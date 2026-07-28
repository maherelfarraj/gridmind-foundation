// P-107 — Preventive maintenance plans workspace.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { CalendarClock, Pencil, Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PmPlanDialog } from "@/components/pm-plans/pm-plan-dialog";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  deletePmPlan,
  generatePmNow,
  listPmPlans,
  togglePmPlan,
  type PmPlanRow,
} from "@/lib/pm-plans.functions";

export const Route = createFileRoute("/_authenticated/om/maintenance-plans")({
  head: () => ({
    meta: [
      { title: "Preventive maintenance plans · GridMind EPC" },
      {
        name: "description",
        content: "Schedule recurring maintenance plans that auto-generate preventive work orders.",
      },
    ],
  }),
  component: MaintenancePlansPage,
  errorComponent: MaintenancePlansError,
});

function MaintenancePlansError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="p-6">
      <div className="text-sm text-destructive">
        {t("omMod.maintenancePlans.loadFailed", { message: error.message })}
      </div>
      <Button className="mt-2" size="sm" onClick={reset}>
        {t("omMod.common.retry")}
      </Button>
    </div>
  );
}

function DueChip({ dateISO }: { dateISO: string }) {
  const { t } = useI18n();
  const diff = differenceInCalendarDays(parseISO(dateISO), new Date());
  if (diff < 0)
    return (
      <Badge variant="destructive">
        {t("omMod.maintenancePlans.overdueBy", { days: Math.abs(diff) })}
      </Badge>
    );
  if (diff === 0) return <Badge>{t("omMod.maintenancePlans.dueToday")}</Badge>;
  if (diff <= 7)
    return <Badge variant="secondary">{t("omMod.maintenancePlans.inDays", { days: diff })}</Badge>;
  return (
    <span className="text-sm text-muted-foreground">
      {t("omMod.maintenancePlans.inDays", { days: diff })}
    </span>
  );
}

function MaintenancePlansPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listPmPlans);
  const toggleFn = useServerFn(togglePmPlan);
  const deleteFn = useServerFn(deletePmPlan);
  const genFn = useServerFn(generatePmNow);

  const plansQ = useQuery({ queryKey: ["pm-plans"], queryFn: () => listFn() });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active?: boolean; auto_generate?: boolean }) =>
      toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pm-plans"] }),
    onError: (e: Error) => toast.error(e.message || t("omMod.maintenancePlans.toggleFailed")),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(t("omMod.maintenancePlans.planDeleted"));
      qc.invalidateQueries({ queryKey: ["pm-plans"] });
    },
    onError: (e: Error) => toast.error(e.message || t("omMod.maintenancePlans.deleteFailed")),
  });

  const gen = useMutation({
    mutationFn: (planId?: string) => genFn({ data: { plan_id: planId } }),
    onSuccess: (s) => {
      toast.success(
        t("omMod.maintenancePlans.generatedCount", {
          count: s.generated,
          plural: s.generated === 1 ? "" : "s",
          skipped: s.skipped ? t("omMod.maintenancePlans.skippedSuffix", { count: s.skipped }) : "",
        }),
      );
      qc.invalidateQueries({ queryKey: ["pm-plans"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["wo-kpis"] });
    },
    onError: (e: Error) => toast.error(e.message || t("omMod.maintenancePlans.generationFailed")),
  });

  const plans = (plansQ.data ?? []) as PmPlanRow[];

  return (
    <div className="page-shell">
      <PageHeader
        title={t("omMod.maintenancePlans.title")}
        description={t("omMod.maintenancePlans.description")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => gen.mutate(undefined)}
              disabled={gen.isPending}
            >
              <Play className="me-2 h-4 w-4" />
              {t("omMod.maintenancePlans.generateAllNow")}
            </Button>
            <PmPlanDialog />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("omMod.maintenancePlans.plansTitle")}</CardTitle>
          <CardDescription>{t("omMod.maintenancePlans.plansHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {plansQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t("omMod.maintenancePlans.noPlansTitle")}
              description={t("omMod.maintenancePlans.noPlansDescription")}
              action={<PmPlanDialog />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("omMod.maintenancePlans.colPlan")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colTarget")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colFrequency")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colNextDue")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colLastGenerated")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colAuto")}</TableHead>
                  <TableHead>{t("omMod.maintenancePlans.colActive")}</TableHead>
                  <TableHead className="text-end">
                    {t("omMod.maintenancePlans.colActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{p.project_name}</div>
                    </TableCell>
                    <TableCell>
                      {p.equipment_tag ? (
                        <Badge variant="outline">{p.equipment_tag}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("omMod.common.projectWide")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="capitalize">
                      {p.frequency}
                      <div className="text-xs text-muted-foreground">
                        {t("omMod.maintenancePlans.everyDays", { days: p.interval_days })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">{p.next_due_date}</span>
                        <DueChip dateISO={p.next_due_date} />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.last_generated_at ? new Date(p.last_generated_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.auto_generate}
                        onCheckedChange={(v) => toggle.mutate({ id: p.id, auto_generate: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={p.active}
                        onCheckedChange={(v) => toggle.mutate({ id: p.id, active: v })}
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => gen.mutate(p.id)}
                          disabled={gen.isPending}
                          title={t("omMod.maintenancePlans.generateNow")}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <PmPlanDialog
                          plan={p}
                          trigger={
                            <Button size="sm" variant="ghost" title={t("omMod.common.edit")}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              confirm(t("omMod.maintenancePlans.deleteConfirm", { title: p.title }))
                            )
                              del.mutate(p.id);
                          }}
                          title={t("omMod.common.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
