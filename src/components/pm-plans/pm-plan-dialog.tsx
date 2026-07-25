// P-107 — Create/edit dialog for preventive maintenance plans.
import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertPmPlan, type PmPlanRow } from "@/lib/pm-plans.functions";
import {
  FREQUENCY_DEFAULT_DAYS,
  PM_FREQUENCIES,
  pmPlanUpsertSchema,
  type PmPlanUpsertInput,
} from "@/lib/pm-plans.rules";
import {
  listAssignees,
  listEquipmentForProject,
  listWorkOrderProjects,
} from "@/lib/work-orders.functions";

interface Props {
  plan?: PmPlanRow | null;
  trigger?: React.ReactNode;
}

export function PmPlanDialog({ plan, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const projectsFn = useServerFn(listWorkOrderProjects);
  const assigneesFn = useServerFn(listAssignees);
  const equipFn = useServerFn(listEquipmentForProject);
  const upsertFn = useServerFn(upsertPmPlan);

  const projects = useQuery({
    queryKey: ["wo-projects"],
    queryFn: () => projectsFn(),
    enabled: open,
  });
  const assignees = useQuery({
    queryKey: ["wo-assignees"],
    queryFn: () => assigneesFn(),
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<PmPlanUpsertInput>({
    resolver: zodResolver(pmPlanUpsertSchema) as never,
    defaultValues: plan
      ? {
          id: plan.id,
          project_id: plan.project_id,
          equipment_id: plan.equipment_id,
          title: plan.title,
          description: plan.description ?? "",
          frequency: plan.frequency,
          interval_days: plan.interval_days,
          next_due_date: plan.next_due_date,
          checklist: plan.checklist,
          estimated_hours: plan.estimated_hours,
          default_assignee: plan.default_assignee,
          auto_generate: plan.auto_generate,
          active: plan.active,
        }
      : {
          project_id: "",
          equipment_id: null,
          title: "",
          description: "",
          frequency: "quarterly",
          interval_days: 90,
          next_due_date: today,
          checklist: [{ step: "", required: true }],
          estimated_hours: null,
          default_assignee: null,
          auto_generate: true,
          active: true,
        },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "checklist",
  });

  const projectId = form.watch("project_id");
  const equipment = useQuery({
    queryKey: ["wo-equipment", projectId],
    queryFn: () => equipFn({ data: { project_id: projectId } }),
    enabled: !!projectId,
  });

  const frequency = form.watch("frequency");
  useEffect(() => {
    if (!plan) {
      form.setValue("interval_days", FREQUENCY_DEFAULT_DAYS[frequency]);
    }
  }, [frequency, form, plan]);

  const mut = useMutation({
    mutationFn: (v: PmPlanUpsertInput) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success(plan ? "Plan updated" : "Plan created");
      qc.invalidateQueries({ queryKey: ["pm-plans"] });
      setOpen(false);
      if (!plan) form.reset();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to save plan"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New plan
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? "Edit PM plan" : "Create PM plan"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((v) => mut.mutate(v))}
          >
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(projects.data ?? []).map((p) => (
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
              <FormField
                control={form.control}
                name="equipment_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment (optional)</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      disabled={!projectId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Project-wide" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— Project-wide —</SelectItem>
                        {(equipment.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.tag}
                            {e.manufacturer ? ` · ${e.manufacturer}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Inverter quarterly inspection" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={2}
                      placeholder="Purpose, scope, references"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PM_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="interval_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Interval (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="next_due_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Next due</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="estimated_hours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated hours</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.25"
                        min={0}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="default_assignee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default assignee</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— Unassigned —</SelectItem>
                        {(assignees.data ?? []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.full_name ?? a.email ?? a.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Checklist</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => append({ step: "", required: true })}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add step
                </Button>
              </div>
              {fields.length === 0 ? (
                <div className="text-xs text-muted-foreground">No steps yet.</div>
              ) : (
                fields.map((f, idx) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      placeholder={`Step ${idx + 1}`}
                      {...form.register(`checklist.${idx}.step` as const)}
                    />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={form.watch(`checklist.${idx}.required`)}
                        onCheckedChange={(v) =>
                          form.setValue(`checklist.${idx}.required`, Boolean(v))
                        }
                      />
                      Required
                    </label>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-6">
              <FormField
                control={form.control}
                name="auto_generate"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Auto-generate</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Saving…" : plan ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
