import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateOpportunity } from "@/lib/crm-query";

const ARCHETYPE_OPTIONS = [
  { value: "utility_pv", label: "Utility PV" },
  { value: "standalone_bess", label: "Standalone BESS" },
  { value: "c_and_i_rooftop", label: "C&I Rooftop" },
  { value: "onshore_wind", label: "Onshore Wind" },
  { value: "hybrid_pv_bess", label: "Hybrid PV+BESS" },
  { value: "transmission_substation", label: "Transmission & Substation" },
  { value: "green_hydrogen", label: "Green H₂" },
] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  account_name: z.string().trim().max(200).optional().or(z.literal("")),
  archetype: z.string().optional(),
  capacity_mw: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Number(v)), "Must be a number"),
  estimated_value: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Number(v)), "Must be a number"),
  currency_code: z.string().trim().length(3).optional(),
  expected_decision_date: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date"),
});
type Form = z.infer<typeof schema>;

interface Props {
  trigger: React.ReactNode;
}

export function NewOpportunityDialog({ trigger }: Props) {
  const [open, setOpen] = useState(false);
  const mutation = useCreateOpportunity();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { currency_code: "USD" },
  });

  const archetype = watch("archetype");

  const onSubmit = handleSubmit(async (values) => {
    await mutation.mutateAsync({
      name: values.name,
      account_name: values.account_name || null,
      archetype: (values.archetype || null) as any,
      capacity_mw: values.capacity_mw ? Number(values.capacity_mw) : null,
      estimated_value: values.estimated_value ? Number(values.estimated_value) : null,
      currency_code: (values.currency_code || "USD").toUpperCase(),
      expected_decision_date: values.expected_decision_date || null,
    });
    reset({ currency_code: "USD" });
    setOpen(false);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="opp-name">Name</Label>
            <Input id="opp-name" {...register("name")} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-account">Account</Label>
            <Input id="opp-account" {...register("account_name")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Archetype</Label>
              <Select
                value={archetype ?? ""}
                onValueChange={(v) => setValue("archetype", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {ARCHETYPE_OPTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-cap">Capacity (MW)</Label>
              <Input id="opp-cap" type="number" step="0.1" {...register("capacity_mw")} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="opp-val">Estimated value</Label>
              <Input id="opp-val" type="number" step="1000" {...register("estimated_value")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-ccy">Currency</Label>
              <Input id="opp-ccy" maxLength={3} {...register("currency_code")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opp-date">Expected decision</Label>
            <Input id="opp-date" type="date" {...register("expected_decision_date")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || mutation.isPending}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
