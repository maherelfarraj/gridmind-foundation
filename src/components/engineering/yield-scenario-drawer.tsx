// P-056 — Yield scenario drawer (new / edit).
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  LOSS_KEYS,
  TRACKING_TYPES,
  type TrackingType,
  type YieldParams,
  type YieldScenarioRow,
} from "@/lib/yield.functions";
import { useSaveYieldScenario } from "@/lib/yield-query";

const formSchema = z.object({
  scenarioName: z.string().trim().min(1, "Name required").max(60, "Max 60 chars"),
  tilt_deg: z.number().min(0, "Min 0°").max(90, "Max 90°"),
  azimuth_deg: z.number().min(0).max(360),
  gcr: z.number().min(0.1, "Min 0.10").max(0.9, "Max 0.90"),
  tracking: z.enum(TRACKING_TYPES),
  bifacial: z.boolean(),
  dc_ac_ratio: z.number().min(0.8).max(1.6),
  soiling: z.number().min(0).max(40),
  temperature: z.number().min(0).max(40),
  mismatch: z.number().min(0).max(40),
  wiring: z.number().min(0).max(40),
  inverter: z.number().min(0).max(40),
  availability: z.number().min(0).max(40),
});
type FormValues = z.infer<typeof formSchema>;

const TRACKING_LABELS: Record<TrackingType, string> = {
  fixed: "Fixed tilt",
  "1p_tracker": "1P single-axis tracker",
  "2p_tracker": "2P single-axis tracker",
};

const DEFAULTS: FormValues = {
  scenarioName: "",
  tilt_deg: 25,
  azimuth_deg: 180,
  gcr: 0.4,
  tracking: "fixed",
  bifacial: false,
  dc_ac_ratio: 1.3,
  soiling: 2,
  temperature: 8,
  mismatch: 2,
  wiring: 2,
  inverter: 2,
  availability: 1,
};

export function YieldScenarioDrawer({
  projectId,
  open,
  onOpenChange,
  scenario,
  initialName,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scenario?: YieldScenarioRow;
  initialName?: string;
}) {
  const save = useSaveYieldScenario(projectId);
  const isEdit = !!scenario;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (!open) return;
    if (scenario) {
      const p = (scenario.params ?? {}) as Partial<YieldParams>;
      form.reset({
        scenarioName: scenario.scenario_name,
        tilt_deg: p.tilt_deg ?? 25,
        azimuth_deg: p.azimuth_deg ?? 180,
        gcr: p.gcr ?? 0.4,
        tracking: (p.tracking as TrackingType) ?? "fixed",
        bifacial: !!p.bifacial,
        dc_ac_ratio: p.dc_ac_ratio ?? 1.3,
        soiling: p.losses_pct?.soiling ?? 2,
        temperature: p.losses_pct?.temperature ?? 8,
        mismatch: p.losses_pct?.mismatch ?? 2,
        wiring: p.losses_pct?.wiring ?? 2,
        inverter: p.losses_pct?.inverter ?? 2,
        availability: p.losses_pct?.availability ?? 1,
      });
    } else {
      form.reset({ ...DEFAULTS, scenarioName: initialName ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scenario?.id, initialName]);

  const onSubmit = form.handleSubmit(async (v) => {
    const params: YieldParams = {
      tilt_deg: v.tilt_deg,
      azimuth_deg: v.azimuth_deg,
      gcr: v.gcr,
      tracking: v.tracking,
      bifacial: v.bifacial,
      dc_ac_ratio: v.dc_ac_ratio,
      losses_pct: {
        soiling: v.soiling,
        temperature: v.temperature,
        mismatch: v.mismatch,
        wiring: v.wiring,
        inverter: v.inverter,
        availability: v.availability,
      },
    };
    save.mutate(
      { id: scenario?.id, scenarioName: v.scenarioName, params },
      { onSuccess: () => onOpenChange(false) },
    );
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit scenario" : "New scenario"}</SheetTitle>
          <SheetDescription>
            Configure array parameters and losses. Run estimate afterwards.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <Field label="Scenario name" error={form.formState.errors.scenarioName?.message}>
            <Input {...form.register("scenarioName")} disabled={isEdit} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Tilt (°)"
              step="0.1"
              register={form.register("tilt_deg", { valueAsNumber: true })}
              error={form.formState.errors.tilt_deg?.message}
            />
            <NumberField
              label="Azimuth (°)"
              step="1"
              register={form.register("azimuth_deg", { valueAsNumber: true })}
              error={form.formState.errors.azimuth_deg?.message}
            />
            <NumberField
              label="GCR"
              step="0.01"
              register={form.register("gcr", { valueAsNumber: true })}
              error={form.formState.errors.gcr?.message}
            />
            <NumberField
              label="DC/AC ratio"
              step="0.01"
              register={form.register("dc_ac_ratio", { valueAsNumber: true })}
              error={form.formState.errors.dc_ac_ratio?.message}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <Field label="Tracking">
              <Select
                value={form.watch("tracking")}
                onValueChange={(v) => form.setValue("tracking", v as TrackingType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRACKING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRACKING_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                checked={form.watch("bifacial")}
                onCheckedChange={(v) => form.setValue("bifacial", v)}
                id="bifacial"
              />
              <Label htmlFor="bifacial" className="text-sm">
                Bifacial
              </Label>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Losses (%)</p>
            <div className="grid grid-cols-3 gap-3">
              {LOSS_KEYS.map((k) => (
                <NumberField
                  key={k}
                  label={k.charAt(0).toUpperCase() + k.slice(1)}
                  step="0.1"
                  register={form.register(k as keyof FormValues, { valueAsNumber: true })}
                  error={(form.formState.errors as any)[k]?.message}
                />
              ))}
            </div>
          </div>

          <SheetFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save scenario"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
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
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NumberField({
  label,
  step,
  register,
  error,
}: {
  label: string;
  step: string;
  register: ReturnType<ReturnType<typeof useForm<any>>["register"]>;
  error?: string;
}) {
  return (
    <Field label={label} error={error}>
      <Input type="number" step={step} {...register} />
    </Field>
  );
}
