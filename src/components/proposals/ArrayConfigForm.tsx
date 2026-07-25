import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSaveArrayConfig } from "@/lib/proposal-query";
import type { ProposalDetail } from "@/lib/proposal.functions";
import type { ArrayConfig } from "@/lib/yield/stub";

const schema = z.object({
  dc_capacity_kw: z.coerce.number().positive(),
  ac_capacity_kw: z.coerce.number().positive(),
  tilt: z.coerce.number().min(0).max(90),
  azimuth: z.coerce.number().min(0).max(360),
  gcr: z.coerce.number().min(0.1).max(1),
  tracking: z.enum(["fixed", "single_axis"]),
  latitude: z.coerce.number().min(-90).max(90),
  module_w: z.coerce.number().positive(),
  inverter: z.string().max(120),
  loss_soiling: z.coerce.number().min(0).max(0.5),
  loss_temperature: z.coerce.number().min(0).max(0.5),
  loss_mismatch: z.coerce.number().min(0).max(0.5),
  loss_wiring: z.coerce.number().min(0).max(0.5),
  loss_inverter: z.coerce.number().min(0).max(0.5),
  loss_availability: z.coerce.number().min(0).max(0.5),
  degradation_y1_pct: z.coerce.number().min(0).max(10),
  p90_sigma: z.coerce.number().min(0).max(0.3),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  dc_capacity_kw: 100000,
  ac_capacity_kw: 80000,
  tilt: 25,
  azimuth: 180,
  gcr: 0.4,
  tracking: "fixed",
  latitude: 31.9,
  module_w: 550,
  inverter: "",
  loss_soiling: 0.02,
  loss_temperature: 0.08,
  loss_mismatch: 0.02,
  loss_wiring: 0.02,
  loss_inverter: 0.02,
  loss_availability: 0.01,
  degradation_y1_pct: 2.0,
  p90_sigma: 0.04,
};

function fromConfig(c: ArrayConfig | null): FormValues {
  if (!c) return DEFAULTS;
  return {
    dc_capacity_kw: c.dc_capacity_kw,
    ac_capacity_kw: c.ac_capacity_kw,
    tilt: c.tilt,
    azimuth: c.azimuth,
    gcr: c.gcr,
    tracking: c.tracking,
    latitude: c.latitude,
    module_w: c.module_w,
    inverter: c.inverter ?? "",
    loss_soiling: c.losses.soiling,
    loss_temperature: c.losses.temperature,
    loss_mismatch: c.losses.mismatch,
    loss_wiring: c.losses.wiring,
    loss_inverter: c.losses.inverter,
    loss_availability: c.losses.availability,
    degradation_y1_pct: c.degradation_y1_pct,
    p90_sigma: c.p90_sigma,
  };
}

function toConfig(v: FormValues): ArrayConfig {
  return {
    dc_capacity_kw: v.dc_capacity_kw,
    ac_capacity_kw: v.ac_capacity_kw,
    tilt: v.tilt,
    azimuth: v.azimuth,
    gcr: v.gcr,
    tracking: v.tracking,
    latitude: v.latitude,
    module_w: v.module_w,
    inverter: v.inverter,
    losses: {
      soiling: v.loss_soiling,
      temperature: v.loss_temperature,
      mismatch: v.loss_mismatch,
      wiring: v.loss_wiring,
      inverter: v.loss_inverter,
      availability: v.loss_availability,
    },
    degradation_y1_pct: v.degradation_y1_pct,
    p90_sigma: v.p90_sigma,
  };
}

export function ArrayConfigForm({
  proposal,
  readOnly,
}: {
  proposal: ProposalDetail;
  readOnly: boolean;
}) {
  const save = useSaveArrayConfig(proposal.id);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: fromConfig(proposal.array_config),
  });
  useEffect(() => {
    reset(fromConfig(proposal.array_config));
  }, [proposal.id, proposal.array_config, reset]);

  const tracking = watch("tracking");

  const onSubmit = (v: FormValues) => save.mutate(toConfig(v), { onSuccess: () => reset(v) });

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Array configuration</h3>
          <p className="text-xs text-muted-foreground">Feeds the yield simulation engine</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-3">
        <Field label="DC capacity (kW)" error={errors.dc_capacity_kw?.message}>
          <Input type="number" step="1" disabled={readOnly} {...register("dc_capacity_kw")} />
        </Field>
        <Field label="AC capacity (kW)" error={errors.ac_capacity_kw?.message}>
          <Input type="number" step="1" disabled={readOnly} {...register("ac_capacity_kw")} />
        </Field>
        <Field label="Module (Wp)" error={errors.module_w?.message}>
          <Input type="number" step="1" disabled={readOnly} {...register("module_w")} />
        </Field>

        <Field label="Tilt (°)" error={errors.tilt?.message}>
          <Input type="number" step="0.1" disabled={readOnly} {...register("tilt")} />
        </Field>
        <Field label="Azimuth (°)" error={errors.azimuth?.message}>
          <Input type="number" step="1" disabled={readOnly} {...register("azimuth")} />
        </Field>
        <Field label="GCR" error={errors.gcr?.message}>
          <Input type="number" step="0.01" disabled={readOnly} {...register("gcr")} />
        </Field>

        <Field label="Tracking">
          <Select
            value={tracking}
            disabled={readOnly}
            onValueChange={(v) =>
              setValue("tracking", v as "fixed" | "single_axis", {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed tilt</SelectItem>
              <SelectItem value="single_axis">Single-axis tracker</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Latitude (°)" error={errors.latitude?.message}>
          <Input type="number" step="0.01" disabled={readOnly} {...register("latitude")} />
        </Field>
        <Field label="Inverter">
          <Input disabled={readOnly} {...register("inverter")} />
        </Field>

        <div className="sm:col-span-3 mt-2 border-t border-border pt-3">
          <h4 className="mb-2 text-sm font-semibold">Losses (fraction)</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Soiling">
              <Input type="number" step="0.01" disabled={readOnly} {...register("loss_soiling")} />
            </Field>
            <Field label="Temperature">
              <Input
                type="number"
                step="0.01"
                disabled={readOnly}
                {...register("loss_temperature")}
              />
            </Field>
            <Field label="Mismatch">
              <Input type="number" step="0.01" disabled={readOnly} {...register("loss_mismatch")} />
            </Field>
            <Field label="Wiring">
              <Input type="number" step="0.01" disabled={readOnly} {...register("loss_wiring")} />
            </Field>
            <Field label="Inverter">
              <Input type="number" step="0.01" disabled={readOnly} {...register("loss_inverter")} />
            </Field>
            <Field label="Availability">
              <Input
                type="number"
                step="0.01"
                disabled={readOnly}
                {...register("loss_availability")}
              />
            </Field>
          </div>
        </div>

        <Field label="Year-1 degradation %" error={errors.degradation_y1_pct?.message}>
          <Input type="number" step="0.1" disabled={readOnly} {...register("degradation_y1_pct")} />
        </Field>
        <Field label="P90 sigma" error={errors.p90_sigma?.message}>
          <Input type="number" step="0.01" disabled={readOnly} {...register("p90_sigma")} />
        </Field>

        {!readOnly && (
          <div className="sm:col-span-3 flex justify-end">
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save array config"}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
