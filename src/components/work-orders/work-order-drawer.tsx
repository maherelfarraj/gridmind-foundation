// P-106 — Work order detail drawer: assign, parts, labor, close.
import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listSpareParts } from "@/lib/spare-parts.functions";
import {
  assignWorkOrder,
  captureLabor,
  captureParts,
  closeWorkOrder,
  getWorkOrder,
  listAssignees,
  updateWorkOrderStatus,
  type WorkOrderRow,
} from "@/lib/work-orders.functions";
import {
  capturePartsSchema,
  captureLaborSchema,
  workOrderCloseSchema,
  WORK_ORDER_STATUSES,
} from "@/lib/work-orders.rules";
import type { LaborLine, PartLine, WorkOrderStatus } from "@/lib/work-orders.rules";

interface Props {
  workOrderId: string | null;
  onOpenChange: (open: boolean) => void;
}

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);

function priorityCls(p: string) {
  return p === "emergency"
    ? "bg-destructive text-destructive-foreground"
    : p === "high"
      ? "bg-warning text-warning-foreground"
      : p === "medium"
        ? "bg-secondary text-secondary-foreground"
        : "bg-muted text-muted-foreground";
}

export function WorkOrderDrawer({ workOrderId, onOpenChange }: Props) {
  const qc = useQueryClient();
  const getFn = useServerFn(getWorkOrder);
  const query = useQuery({
    queryKey: ["work-order", workOrderId],
    queryFn: () => getFn({ data: { id: workOrderId! } }),
    enabled: !!workOrderId,
  });
  const wo = query.data;

  return (
    <Sheet open={!!workOrderId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!wo ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {query.isLoading ? "Loading…" : "Not found."}
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <SheetTitle className="font-mono text-base">{wo.wo_number}</SheetTitle>
                <Badge className={priorityCls(wo.priority)}>{wo.priority}</Badge>
                <Badge variant="outline">{wo.type}</Badge>
                <Badge variant="secondary">{wo.status}</Badge>
              </div>
              <SheetTitle className="text-xl">{wo.title}</SheetTitle>
              <SheetDescription>
                {wo.project_name ?? "—"}
                {wo.equipment_tag ? ` · ${wo.equipment_tag}` : ""}
                {wo.due_date ? ` · due ${wo.due_date}` : ""}
              </SheetDescription>
              {wo.description ? (
                <p className="text-sm text-muted-foreground">{wo.description}</p>
              ) : null}
              <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total cost</span>
                <span className="font-mono">{money(wo.total_cost)}</span>
              </div>
            </SheetHeader>

            <Separator className="my-4" />

            <Tabs defaultValue="assign" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="assign">Assign</TabsTrigger>
                <TabsTrigger value="parts">Parts</TabsTrigger>
                <TabsTrigger value="labor">Labor</TabsTrigger>
                <TabsTrigger value="close">Close</TabsTrigger>
              </TabsList>

              <TabsContent value="assign" className="pt-4">
                <AssignPanel
                  wo={wo}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["work-order", wo.id] });
                    qc.invalidateQueries({ queryKey: ["work-orders"] });
                  }}
                />
              </TabsContent>
              <TabsContent value="parts" className="pt-4">
                <PartsPanel
                  wo={wo}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["work-order", wo.id] });
                    qc.invalidateQueries({ queryKey: ["work-orders"] });
                    qc.invalidateQueries({ queryKey: ["wo-kpis"] });
                  }}
                />
              </TabsContent>
              <TabsContent value="labor" className="pt-4">
                <LaborPanel
                  wo={wo}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["work-order", wo.id] });
                    qc.invalidateQueries({ queryKey: ["work-orders"] });
                    qc.invalidateQueries({ queryKey: ["wo-kpis"] });
                  }}
                />
              </TabsContent>
              <TabsContent value="close" className="pt-4">
                <ClosePanel
                  wo={wo}
                  onSaved={() => {
                    qc.invalidateQueries({ queryKey: ["work-order", wo.id] });
                    qc.invalidateQueries({ queryKey: ["work-orders"] });
                    qc.invalidateQueries({ queryKey: ["wo-kpis"] });
                    onOpenChange(false);
                  }}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---- Assign ---------------------------------------------------------------
function AssignPanel({ wo, onSaved }: { wo: WorkOrderRow; onSaved: () => void }) {
  const assigneesFn = useServerFn(listAssignees);
  const assignFn = useServerFn(assignWorkOrder);
  const statusFn = useServerFn(updateWorkOrderStatus);
  const assignees = useQuery({ queryKey: ["wo-assignees"], queryFn: () => assigneesFn() });
  const [assigneeId, setAssigneeId] = useState<string>(wo.assigned_to ?? "none");
  const [status, setStatus] = useState<WorkOrderStatus>(wo.status);
  useEffect(() => {
    setAssigneeId(wo.assigned_to ?? "none");
    setStatus(wo.status);
  }, [wo.id, wo.assigned_to, wo.status]);

  const assignMut = useMutation({
    mutationFn: () =>
      assignFn({
        data: { id: wo.id, assigned_to: assigneeId === "none" ? null : assigneeId },
      }),
    onSuccess: () => {
      toast.success("Assignee updated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });
  const statusMut = useMutation({
    mutationFn: () => statusFn({ data: { id: wo.id, status } }),
    onSuccess: () => {
      toast.success(`Status → ${status}`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Assignee</label>
        <Select value={assigneeId} onValueChange={setAssigneeId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— Unassigned —</SelectItem>
            {(assignees.data ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.full_name ?? a.email ?? a.id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => assignMut.mutate()} disabled={assignMut.isPending}>
          {assignMut.isPending ? "Saving…" : "Update assignee"}
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <label className="text-sm font-medium">Status</label>
        <Select value={status} onValueChange={(v) => setStatus(v as WorkOrderStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORK_ORDER_STATUSES.filter((s) => s !== "closed").map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          To close, use the <span className="font-medium">Close</span> tab.
        </p>
        <Button
          size="sm"
          onClick={() => statusMut.mutate()}
          disabled={statusMut.isPending || status === wo.status}
        >
          {statusMut.isPending ? "Saving…" : "Update status"}
        </Button>
      </div>
    </div>
  );
}

// ---- Parts ----------------------------------------------------------------
type PartsForm = { id: string; parts: PartLine[] };
function PartsPanel({ wo, onSaved }: { wo: WorkOrderRow; onSaved: () => void }) {
  const captureFn = useServerFn(captureParts);
  const partsListFn = useServerFn(listSpareParts);
  const partsList = useQuery({
    queryKey: ["spare-parts-all"],
    queryFn: () => partsListFn({ data: {} }),
  });

  const form = useForm<PartsForm>({
    resolver: zodResolver(capturePartsSchema) as never,
    defaultValues: { id: wo.id, parts: wo.parts.length ? wo.parts : [] },
  });
  useEffect(() => {
    form.reset({ id: wo.id, parts: wo.parts });
  }, [wo.id, wo.parts, form]);
  const fa = useFieldArray({ control: form.control, name: "parts" });
  const watched = form.watch("parts");
  const subtotal = useMemo(
    () => watched.reduce((acc, p) => acc + (Number(p.qty) || 0) * (Number(p.unit_cost) || 0), 0),
    [watched],
  );

  const mut = useMutation({
    mutationFn: (v: PartsForm) => captureFn({ data: v }),
    onSuccess: () => {
      toast.success("Parts saved");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });

  return (
    <form className="space-y-3" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
      {fa.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parts recorded.</p>
      ) : null}
      {fa.fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-12 gap-2">
          <div className="col-span-5">
            <Select
              value={form.getValues(`parts.${i}.spare_part_id`) ?? "custom"}
              onValueChange={(v) => {
                if (v === "custom") {
                  form.setValue(`parts.${i}.spare_part_id`, null);
                  return;
                }
                const found = (partsList.data ?? []).find((p) => p.id === v);
                if (found) {
                  form.setValue(`parts.${i}.spare_part_id`, found.id);
                  form.setValue(`parts.${i}.description`, `${found.part_number} · ${found.name}`);
                  if (found.unit_cost != null)
                    form.setValue(`parts.${i}.unit_cost`, found.unit_cost);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick spare or type custom" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">— Custom description —</SelectItem>
                {(partsList.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.part_number} · {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            className="col-span-4"
            placeholder="Description"
            {...form.register(`parts.${i}.description`)}
          />
          <Input
            className="col-span-1"
            type="number"
            step="0.01"
            placeholder="Qty"
            {...form.register(`parts.${i}.qty`, { valueAsNumber: true })}
          />
          <Input
            className="col-span-1"
            type="number"
            step="0.01"
            placeholder="Unit $"
            {...form.register(`parts.${i}.unit_cost`, { valueAsNumber: true })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="col-span-1"
            onClick={() => fa.remove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            fa.append({
              spare_part_id: null,
              description: "",
              qty: 1,
              unit_cost: 0,
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add line
        </Button>
        <div className="text-sm">
          Parts subtotal: <span className="font-mono">{money(subtotal)}</span>
        </div>
      </div>
      <Button type="submit" disabled={mut.isPending}>
        {mut.isPending ? "Saving…" : "Save parts"}
      </Button>
    </form>
  );
}

// ---- Labor ----------------------------------------------------------------
type LaborForm = { id: string; labor: LaborLine[] };
function LaborPanel({ wo, onSaved }: { wo: WorkOrderRow; onSaved: () => void }) {
  const captureFn = useServerFn(captureLabor);
  const assigneesFn = useServerFn(listAssignees);
  const assignees = useQuery({ queryKey: ["wo-assignees"], queryFn: () => assigneesFn() });

  const form = useForm<LaborForm>({
    resolver: zodResolver(captureLaborSchema) as never,
    defaultValues: { id: wo.id, labor: wo.labor },
  });
  useEffect(() => {
    form.reset({ id: wo.id, labor: wo.labor });
  }, [wo.id, wo.labor, form]);
  const fa = useFieldArray({ control: form.control, name: "labor" });
  const watched = form.watch("labor");
  const subtotal = useMemo(
    () => watched.reduce((acc, l) => acc + (Number(l.hours) || 0) * (Number(l.rate) || 0), 0),
    [watched],
  );

  const mut = useMutation({
    mutationFn: (v: LaborForm) => captureFn({ data: v }),
    onSuccess: () => {
      toast.success("Labor saved");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed"),
  });

  return (
    <form className="space-y-3" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
      {fa.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">No labor recorded.</p>
      ) : null}
      {fa.fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-12 gap-2">
          <Select
            value={form.getValues(`labor.${i}.user_id`) ?? "none"}
            onValueChange={(v) => {
              if (v === "none") {
                form.setValue(`labor.${i}.user_id`, null);
                return;
              }
              const found = (assignees.data ?? []).find((a) => a.id === v);
              form.setValue(`labor.${i}.user_id`, v);
              if (found) form.setValue(`labor.${i}.name`, found.full_name ?? found.email ?? "");
            }}
          >
            <SelectTrigger className="col-span-4">
              <SelectValue placeholder="Tech" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— External / other —</SelectItem>
              {(assignees.data ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.full_name ?? a.email ?? a.id.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="col-span-3" type="date" {...form.register(`labor.${i}.date`)} />
          <Input
            className="col-span-2"
            type="number"
            step="0.25"
            placeholder="Hours"
            {...form.register(`labor.${i}.hours`, { valueAsNumber: true })}
          />
          <Input
            className="col-span-2"
            type="number"
            step="0.01"
            placeholder="Rate/hr"
            {...form.register(`labor.${i}.rate`, { valueAsNumber: true })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="col-span-1"
            onClick={() => fa.remove(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            fa.append({
              user_id: null,
              name: "",
              hours: 1,
              rate: 0,
              date: new Date().toISOString().slice(0, 10),
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" /> Add line
        </Button>
        <div className="text-sm">
          Labor subtotal: <span className="font-mono">{money(subtotal)}</span>
        </div>
      </div>
      <Button type="submit" disabled={mut.isPending}>
        {mut.isPending ? "Saving…" : "Save labor"}
      </Button>
    </form>
  );
}

// ---- Close ---------------------------------------------------------------
type CloseForm = {
  id: string;
  resolution_notes: string;
  failure_cause?: string | null;
  is_corrective: boolean;
};
function ClosePanel({ wo, onSaved }: { wo: WorkOrderRow; onSaved: () => void }) {
  const closeFn = useServerFn(closeWorkOrder);
  const form = useForm<CloseForm>({
    resolver: zodResolver(workOrderCloseSchema) as never,
    defaultValues: {
      id: wo.id,
      resolution_notes: wo.resolution_notes ?? "",
      failure_cause: wo.failure_cause ?? "",
      is_corrective: wo.type === "corrective",
    },
  });
  useEffect(() => {
    form.reset({
      id: wo.id,
      resolution_notes: wo.resolution_notes ?? "",
      failure_cause: wo.failure_cause ?? "",
      is_corrective: wo.type === "corrective",
    });
  }, [wo.id, wo.type, wo.resolution_notes, wo.failure_cause, form]);
  const mut = useMutation({
    mutationFn: (v: CloseForm) => closeFn({ data: v }),
    onSuccess: () => {
      toast.success(`Closed ${wo.wo_number}`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to close"),
  });

  const disabled = wo.status === "closed" || wo.status === "cancelled";

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
      {disabled ? (
        <p className="text-sm text-muted-foreground">
          This work order is already <span className="font-medium">{wo.status}</span>.
        </p>
      ) : null}
      <div className="space-y-2">
        <label className="text-sm font-medium">Resolution notes *</label>
        <Textarea rows={4} disabled={disabled} {...form.register("resolution_notes")} />
        {form.formState.errors.resolution_notes ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.resolution_notes.message}
          </p>
        ) : null}
      </div>
      {wo.type === "corrective" ? (
        <div className="space-y-2">
          <label className="text-sm font-medium">Failure cause *</label>
          <Textarea rows={3} disabled={disabled} {...form.register("failure_cause")} />
          {form.formState.errors.failure_cause ? (
            <p className="text-xs text-destructive">
              {form.formState.errors.failure_cause.message as string}
            </p>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" disabled={disabled || mut.isPending}>
        {mut.isPending ? "Closing…" : "Close work order"}
      </Button>
    </form>
  );
}
