// P-054 — SLD configuration form.
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  BUS_CONFIGS,
  VOLTAGE_TYPES,
  type BusConfig,
  type SldConfigRow,
} from "@/lib/sld.functions";
import { useSaveSldConfig } from "@/lib/sld-query";
import { SldHierarchyPreview } from "./sld-hierarchy-preview";

const formSchema = z.object({
  bus_config: z.enum(BUS_CONFIGS),
  voltage_levels: z
    .array(
      z.object({
        kv: z
          .number({ invalid_type_error: "kV must be a number" })
          .positive("kV must be > 0")
          .max(500, "kV must be ≤ 500"),
        type: z.enum(VOLTAGE_TYPES),
      }),
    )
    .min(1, "At least one voltage level is required"),
  metering_points: z.array(
    z.object({
      location: z.string().trim().min(1, "Required").max(120),
      purpose: z.string().trim().min(1, "Required").max(120),
    }),
  ),
  protection_scheme: z.string().trim().max(2000).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

const BUS_LABELS: Record<BusConfig, string> = {
  single: "Single bus",
  single_sectionalized: "Single sectionalized",
  double: "Double bus",
  ring: "Ring bus",
};

export function SldConfigForm({
  projectId,
  initial,
  canWrite,
}: {
  projectId: string;
  initial: SldConfigRow;
  canWrite: boolean;
}) {
  const save = useSaveSldConfig(projectId);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      bus_config: initial.bus_config,
      voltage_levels:
        initial.voltage_levels.length > 0 ? initial.voltage_levels : [],
      metering_points: initial.metering_points,
      protection_scheme: initial.protection_scheme ?? "",
      notes: initial.notes ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      bus_config: initial.bus_config,
      voltage_levels: initial.voltage_levels,
      metering_points: initial.metering_points,
      protection_scheme: initial.protection_scheme ?? "",
      notes: initial.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.updated_at]);

  const voltages = useFieldArray({ control: form.control, name: "voltage_levels" });
  const meters = useFieldArray({ control: form.control, name: "metering_points" });

  const values = form.watch();

  const onSubmit = form.handleSubmit((v) => {
    save.mutate({
      bus_config: v.bus_config,
      voltage_levels: v.voltage_levels,
      metering_points: v.metering_points,
      protection_scheme: v.protection_scheme?.trim() || null,
      notes: v.notes?.trim() || null,
    });
  });

  const disabled = !canWrite;

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bus configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="bus_config">Configuration</Label>
            <Select
              value={form.watch("bus_config")}
              onValueChange={(v) => form.setValue("bus_config", v as BusConfig)}
              disabled={disabled}
            >
              <SelectTrigger id="bus_config" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUS_CONFIGS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {BUS_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Voltage levels</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => voltages.append({ kv: 33, type: "collection" })}
              disabled={disabled}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add level
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {voltages.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No voltage levels defined.
              </p>
            )}
            {voltages.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <div>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="kV"
                    disabled={disabled}
                    {...form.register(`voltage_levels.${i}.kv` as const, {
                      valueAsNumber: true,
                    })}
                  />
                  {form.formState.errors.voltage_levels?.[i]?.kv && (
                    <p className="mt-1 text-xs text-destructive">
                      {form.formState.errors.voltage_levels[i]?.kv?.message}
                    </p>
                  )}
                </div>
                <Select
                  value={form.watch(`voltage_levels.${i}.type`)}
                  onValueChange={(v) =>
                    form.setValue(`voltage_levels.${i}.type`, v as any)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOLTAGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => voltages.remove(i)}
                  disabled={disabled}
                  aria-label="Remove voltage level"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {form.formState.errors.voltage_levels?.message && (
              <p className="text-xs text-destructive">
                {form.formState.errors.voltage_levels.message as string}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Metering points</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => meters.append({ location: "", purpose: "" })}
              disabled={disabled}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add meter
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {meters.fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No metering points defined.
              </p>
            )}
            {meters.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  placeholder="Location"
                  disabled={disabled}
                  {...form.register(`metering_points.${i}.location` as const)}
                />
                <Input
                  placeholder="Purpose (revenue, check, etc.)"
                  disabled={disabled}
                  {...form.register(`metering_points.${i}.purpose` as const)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => meters.remove(i)}
                  disabled={disabled}
                  aria-label="Remove metering point"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Protection & notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="protection_scheme">Protection scheme</Label>
              <Textarea
                id="protection_scheme"
                rows={3}
                disabled={disabled}
                {...form.register("protection_scheme")}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                disabled={disabled}
                {...form.register("notes")}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={disabled || save.isPending}>
            {save.isPending ? "Saving…" : "Save configuration"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <SldHierarchyPreview levels={values.voltage_levels ?? []} />
      </div>
    </form>
  );
}
