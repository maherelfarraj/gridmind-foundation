// P-181 — Materials tab on the DPR detail: consumption against the daily report.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/dpr-query";
import type { DprRow } from "@/lib/dpr.functions";
import { addMaterialConsumption, listMaterialConsumption } from "@/lib/field-exec.functions";

export function StepMaterials({ header, readOnly }: { header: DprRow; readOnly: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMaterialConsumption);
  const addFn = useServerFn(addMaterialConsumption);

  const key = ["dpr", "materials", header.id] as const;
  const rows = useQuery({ queryKey: key, queryFn: () => listFn({ data: { dprId: header.id } }) });

  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addFn({
        data: {
          dprId: header.id,
          material: material.trim(),
          qty: Number(qty),
          uom: uom.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Material recorded");
      setMaterial("");
      setQty("");
      setUom("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = rows.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4" aria-hidden /> Material consumption
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              compact
              icon={Boxes}
              title="No materials recorded"
              description="Log the quantities consumed on this shift."
            />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {list.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">{r.material}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {Number(r.qty)} {r.uom}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Record consumption</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="mat-name">Material</Label>
              <Input
                id="mat-name"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="PV module 580 Wp"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mat-qty">Quantity</Label>
              <Input
                id="mat-qty"
                type="number"
                min={0}
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mat-uom">Unit</Label>
              <Input
                id="mat-uom"
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                placeholder="pcs"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                className="h-11 w-full"
                disabled={!material.trim() || !uom.trim() || Number(qty) <= 0 || add.isPending}
                onClick={() => add.mutate()}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
