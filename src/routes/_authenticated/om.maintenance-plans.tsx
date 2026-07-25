// P-107 — Preventive maintenance plans workspace.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Pencil, Play, Trash2 } from "lucide-react";

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
import { PmPlanDialog } from "@/components/pm-plans/pm-plan-dialog";
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
  errorComponent: ({ error, reset }) => (
    <div className="p-6">
      <div className="text-sm text-destructive">Failed to load PM plans: {error.message}</div>
      <Button className="mt-2" size="sm" onClick={reset}>
        Retry
      </Button>
    </div>
  ),
});

function DueChip({ dateISO }: { dateISO: string }) {
  const diff = differenceInCalendarDays(parseISO(dateISO), new Date());
  if (diff < 0) return <Badge variant="destructive">Overdue {Math.abs(diff)}d</Badge>;
  if (diff === 0) return <Badge>Due today</Badge>;
  if (diff <= 7) return <Badge variant="secondary">In {diff}d</Badge>;
  return <span className="text-sm text-muted-foreground">In {diff}d</span>;
}

function MaintenancePlansPage() {
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
    onError: (e: Error) => toast.error(e.message ?? "Toggle failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Plan deleted");
      qc.invalidateQueries({ queryKey: ["pm-plans"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Delete failed"),
  });

  const gen = useMutation({
    mutationFn: (planId?: string) => genFn({ data: { plan_id: planId } }),
    onSuccess: (s) => {
      toast.success(
        `Generated ${s.generated} work order${s.generated === 1 ? "" : "s"}` +
          (s.skipped ? ` (${s.skipped} skipped)` : ""),
      );
      qc.invalidateQueries({ queryKey: ["pm-plans"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["wo-kpis"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Generation failed"),
  });

  const plans = (plansQ.data ?? []) as PmPlanRow[];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Preventive maintenance plans</h1>
          <p className="text-sm text-muted-foreground">
            Schedule recurring work. Auto-generation creates a preventive work order the day a plan
            is due.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => gen.mutate(undefined)} disabled={gen.isPending}>
            <Play className="mr-2 h-4 w-4" />
            Generate all now
          </Button>
          <PmPlanDialog />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            PM:CM ratio improves whenever a preventive WO is generated ahead of a failure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {plansQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <div className="text-sm font-medium">No preventive plans</div>
              <div className="text-xs text-muted-foreground">
                Schedule your first plan to start generating preventive work orders.
              </div>
              <div className="mt-3 flex justify-center">
                <PmPlanDialog />
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Last generated</TableHead>
                  <TableHead>Auto</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                        <span className="text-xs text-muted-foreground">Project-wide</span>
                      )}
                    </TableCell>
                    <TableCell className="capitalize">
                      {p.frequency}
                      <div className="text-xs text-muted-foreground">every {p.interval_days}d</div>
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => gen.mutate(p.id)}
                          disabled={gen.isPending}
                          title="Generate now"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <PmPlanDialog
                          plan={p}
                          trigger={
                            <Button size="sm" variant="ghost" title="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete plan "${p.title}"?`)) del.mutate(p.id);
                          }}
                          title="Delete"
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
