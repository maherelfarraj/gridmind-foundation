// P-181 — Equipment tab on the DPR detail: daily plant log per equipment tag.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/dpr-query";
import type { DprRow } from "@/lib/dpr.functions";
import {
  deleteEquipmentRecord,
  listEquipmentRecords,
  upsertEquipmentRecord,
} from "@/lib/field-exec.functions";
import {
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUSES,
  equipmentUtilization,
  type EquipmentStatus,
} from "@/lib/field-exec.rules";

export function StepEquipment({ header, readOnly }: { header: DprRow; readOnly: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listEquipmentRecords);
  const saveFn = useServerFn(upsertEquipmentRecord);
  const delFn = useServerFn(deleteEquipmentRecord);

  const key = ["dpr", "equipment", header.id] as const;
  const rows = useQuery({ queryKey: key, queryFn: () => listFn({ data: { dprId: header.id } }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [tag, setTag] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<EquipmentStatus>("on_site");
  const [hours, setHours] = useState("8");
  const [operator, setOperator] = useState("");
  const [fuel, setFuel] = useState("");

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          dprId: header.id,
          equipmentTag: tag.trim(),
          description: description.trim() || null,
          status,
          hours: Number(hours) || 0,
          operatorName: operator.trim() || null,
          fuelLitres: fuel.trim() ? Number(fuel) : null,
        },
      }),
    onSuccess: () => {
      toast.success("Equipment logged");
      setTag("");
      setDescription("");
      setOperator("");
      setFuel("");
      setHours("8");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id, dprId: header.id } }),
    onSuccess: () => {
      toast.success("Entry removed");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = rows.data ?? [];
  const utilization = equipmentUtilization(list);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Truck className="h-4 w-4" aria-hidden /> Equipment on site
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {list.length} units · {utilization}% utilization
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              compact
              icon={Truck}
              title="No equipment logged"
              description="Record plant and equipment hours for this shift."
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {list.map((r) => (
                <li key={r.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.equipment_tag}
                      {r.description ? (
                        <span className="text-muted-foreground"> · {r.description}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {EQUIPMENT_STATUS_LABELS[r.status as EquipmentStatus] ?? r.status} ·{" "}
                      {Number(r.hours)} h{r.operator_name ? ` · ${r.operator_name}` : ""}
                      {r.fuel_litres !== null && r.fuel_litres !== undefined
                        ? ` · ${Number(r.fuel_litres)} L`
                        : ""}
                    </p>
                  </div>
                  {!readOnly && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.equipment_tag}`}
                      onClick={() => remove.mutate(r.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Log equipment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="eq-tag">Equipment tag</Label>
              <Input
                id="eq-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="CRN-002"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-desc">Description</Label>
              <Input
                id="eq-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="25 t mobile crane"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as EquipmentStatus)}>
                <SelectTrigger id="eq-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {EQUIPMENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-hours">Hours (0–24)</Label>
              <Input
                id="eq-hours"
                type="number"
                min={0}
                max={24}
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-op">Operator</Label>
              <Input id="eq-op" value={operator} onChange={(e) => setOperator(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-fuel">Fuel (litres)</Label>
              <Input
                id="eq-fuel"
                type="number"
                min={0}
                step="1"
                value={fuel}
                onChange={(e) => setFuel(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                type="button"
                className="h-11 w-full"
                disabled={!tag.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Add equipment log
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
