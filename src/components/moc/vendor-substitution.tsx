// P-191 — Vendor substitution workspace: old → new vendor, equivalence checklist,
// and the purchase packages the substitution will touch.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getVendorSubstitution, saveVendorSubstitution } from "@/lib/moc.exec.functions";
import {
  defaultEquivalence,
  equivalenceComplete,
  type EquivalenceRow,
} from "@/lib/moc.exec.rules";

interface Props {
  changeRequestId: string;
  editable: boolean;
}

export function VendorSubstitution({ changeRequestId, editable }: Props) {
  const queryClient = useQueryClient();
  const loadFn = useServerFn(getVendorSubstitution);
  const saveFn = useServerFn(saveVendorSubstitution);

  const state = useQuery({
    queryKey: ["moc", "substitution", changeRequestId],
    queryFn: () => loadFn({ data: { id: changeRequestId } }),
  });

  const [oldVendor, setOldVendor] = useState<string | null>(null);
  const [newVendor, setNewVendor] = useState<string | null>(null);
  const [rows, setRows] = useState<EquivalenceRow[]>(defaultEquivalence());

  useEffect(() => {
    if (state.data) {
      setOldVendor(state.data.old_vendor_id);
      setNewVendor(state.data.new_vendor_id);
      setRows(state.data.equivalence);
    }
  }, [state.data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: changeRequestId,
          old_vendor_id: oldVendor,
          new_vendor_id: newVendor,
          equivalence: rows,
        },
      }),
    onSuccess: () => {
      toast.success("Substitution saved");
      void queryClient.invalidateQueries({ queryKey: ["moc"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the substitution"),
  });

  if (state.isPending || !state.data) return <Skeleton className="h-64 w-full" />;
  const vendors = state.data.vendors;
  const complete = equivalenceComplete(rows);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Vendor substitution</h2>
        {editable ? (
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            Save substitution
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-end">
        <div className="space-y-1">
          <Label htmlFor="old-vendor">Current vendor</Label>
          <Select
            disabled={!editable}
            value={oldVendor ?? ""}
            onValueChange={(v) => setOldVendor(v || null)}
          >
            <SelectTrigger id="old-vendor">
              <SelectValue placeholder="Select the awarded vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground md:block" aria-hidden />
        <div className="space-y-1">
          <Label htmlFor="new-vendor">Replacement vendor</Label>
          <Select
            disabled={!editable}
            value={newVendor ?? ""}
            onValueChange={(v) => setNewVendor(v || null)}
          >
            <SelectTrigger id="new-vendor">
              <SelectValue placeholder="Select the replacement" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Technical equivalence</h3>
        {!complete ? (
          <p className="text-xs text-accent">
            All five checks must be confirmed before this change can be submitted.
          </p>
        ) : null}
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li key={row.item} className="flex flex-wrap items-center gap-3">
              <Checkbox
                id={`eq-${i}`}
                checked={row.checked}
                disabled={!editable}
                onCheckedChange={(checked) =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, checked: checked === true } : r)),
                  )
                }
              />
              <Label htmlFor={`eq-${i}`} className="min-w-56 text-sm font-normal">
                {row.item}
              </Label>
              <Input
                className="max-w-xs"
                disabled={!editable}
                value={row.note}
                placeholder="Note (optional)"
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, note: e.target.value } : r)),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Affected purchase packages</h3>
        {state.data.suggestedPackages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No orders or RFQs found for the current vendor on this project.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {state.data.suggestedPackages.map((pkg) => (
              <li key={`${pkg.kind}-${pkg.id}`} className="flex items-center gap-2">
                {pkg.kind === "purchase_order" ? (
                  <Link
                    to="/procurement/pos/$poId"
                    params={{ poId: pkg.id }}
                    className="underline underline-offset-2"
                  >
                    {pkg.label}
                  </Link>
                ) : (
                  <Link
                    to="/procurement/rfqs/$rfqId"
                    params={{ rfqId: pkg.id }}
                    className="underline underline-offset-2"
                  >
                    {pkg.label}
                  </Link>
                )}
                <StatusBadge status={pkg.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
