// P-105 — Alarm rules CRUD UI.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  listAlarmRules,
  upsertAlarmRule,
  deleteAlarmRule,
  type AlarmRuleRow,
} from "@/lib/alarms.functions";
import { listOperationsPlants } from "@/lib/scada-dashboard.functions";
import {
  ALARM_CONDITIONS,
  ALARM_SEVERITIES,
  NOTIFY_ROLES,
  alarmRuleInputSchema,
  type AlarmRuleInput,
} from "@/lib/alarms.rules";
import { TELEMETRY_METRICS } from "@/lib/telemetry-ingest";

export const Route = createFileRoute("/_authenticated/om/scada/alarm-rules")({
  head: () => ({
    meta: [
      { title: "SCADA alarm rules · GridMind EPC" },
      {
        name: "description",
        content:
          "Configure alarm thresholds, dead-bands, duration guards, and escalation routes for SCADA telemetry.",
      },
      { property: "og:title", content: "SCADA alarm rules · GridMind EPC" },
      { property: "og:description", content: "Alarm rules configuration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlarmRulesPage,
});

const DEFAULTS: AlarmRuleInput = {
  project_id: null,
  name: "",
  metric: "ac_power_kw",
  condition: "lt",
  threshold: 0,
  dead_band: 0,
  duration_seconds: 0,
  severity: "warning",
  escalation_route: [],
  enabled: true,
};

function AlarmRulesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AlarmRuleRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const listFn = useServerFn(listAlarmRules);
  const query = useQuery({
    queryKey: ["alarm-rules"],
    queryFn: () => listFn({ data: {} }),
  });

  const plantsFn = useServerFn(listOperationsPlants);
  const plantsQ = useQuery({ queryKey: ["operations-plants"], queryFn: () => plantsFn() });

  const upsertFn = useServerFn(upsertAlarmRule);
  const deleteFn = useServerFn(deleteAlarmRule);

  const upsertMut = useMutation({
    mutationFn: (v: AlarmRuleInput & { id?: string }) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success("Rule saved");
      setSheetOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["alarm-rules"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to save"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Rule deleted");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["alarm-rules"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to delete"),
  });

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (row: AlarmRuleRow) => {
    setEditing(row);
    setSheetOpen(true);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Alarm rules"
        description="Threshold, dead-band, duration, and escalation for SCADA telemetry."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New rule
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Failed to load rules"
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (query.data ?? []).length === 0 ? (
            <EmptyState title="No rules yet" description='Click "New rule" to create your first alarm rule.' />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Dead-band</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(query.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.metric}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.condition} {r.threshold}
                    </TableCell>
                    <TableCell className="font-mono text-xs">±{r.dead_band}</TableCell>
                    <TableCell>{r.duration_seconds}s</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.severity}</Badge>
                    </TableCell>
                    <TableCell>{r.enabled ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RuleSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editing}
        projects={plantsQ.data?.projects ?? []}
        onSubmit={(v) => upsertMut.mutate({ ...v, id: editing?.id })}
        submitting={upsertMut.isPending}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing alarms raised by this rule stay in place; only future evaluations stop.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMut.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleSheet({
  open,
  onOpenChange,
  editing,
  projects,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: AlarmRuleRow | null;
  projects: { id: string; name: string }[];
  onSubmit: (v: AlarmRuleInput) => void;
  submitting: boolean;
}) {
  const form = useForm<AlarmRuleInput>({
    resolver: zodResolver(alarmRuleInputSchema) as never,
    values: editing
      ? ({
          project_id: editing.project_id,
          name: editing.name,
          metric: editing.metric as AlarmRuleInput["metric"],
          condition: editing.condition as AlarmRuleInput["condition"],
          threshold: Number(editing.threshold),
          dead_band: Number(editing.dead_band),
          duration_seconds: editing.duration_seconds,
          severity: editing.severity,
          escalation_route: (editing.escalation_route ?? []) as AlarmRuleInput["escalation_route"],
          enabled: editing.enabled,
        } satisfies AlarmRuleInput)
      : DEFAULTS,
  });
  const routeArr = useFieldArray({ control: form.control, name: "escalation_route" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit rule" : "New rule"}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="project_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project (leave blank for company-wide)</FormLabel>
                  <Select
                    value={field.value ?? "all"}
                    onValueChange={(v) => field.onChange(v === "all" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All projects</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="metric"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Metric</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TELEMETRY_METRICS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="condition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALARM_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="threshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Threshold</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dead_band"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dead-band</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="duration_seconds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (s)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severity</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALARM_SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <FormLabel className="m-0">Enabled</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FormLabel>
                  Escalation route
                  <span className="ml-2 text-xs text-muted-foreground">
                    {/* TODO(B13/P-123): escalation cron advances escalation_level and notifies notify_role */}
                    delivery lands in B13/P-123
                  </span>
                </FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => routeArr.append({ after_minutes: 30, notify_role: "om_admin" })}
                >
                  <Plus className="mr-1 h-3 w-3" /> Step
                </Button>
              </div>
              {routeArr.fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    className="w-28"
                    {...form.register(`escalation_route.${i}.after_minutes`, {
                      valueAsNumber: true,
                    })}
                  />
                  <span className="text-xs text-muted-foreground">min →</span>
                  <Select
                    value={form.watch(`escalation_route.${i}.notify_role`)}
                    onValueChange={(v) =>
                      form.setValue(
                        `escalation_route.${i}.notify_role`,
                        v as (typeof NOTIFY_ROLES)[number],
                      )
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTIFY_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => routeArr.remove(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
