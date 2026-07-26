// P-150 — Add / edit drawer for PV equipment library entries.
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import {
  DEGRADATION_FIELDS,
  DIMENSION_FIELDS,
  LIMIT_FIELDS,
  TEMP_COEFF_FIELDS,
  electricalFields,
  type NumField,
} from "@/components/engineering/pv-field-specs";
import { parseServerError, useSavePvEquipment } from "@/lib/pv-library-query";
import {
  PV_CATEGORIES,
  PV_CATEGORY_LABELS,
  pvEquipmentSchema,
  type PvCategory,
  type PvEquipmentInput,
  type PvEquipmentRow,
} from "@/lib/pv-library.schemas";

function numbersFrom(record: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    if (typeof v === "number" || typeof v === "string") out[k] = Number(v);
  }
  return out;
}

function defaultsFor(row: PvEquipmentRow | null, category: PvCategory): PvEquipmentInput {
  return {
    id: row?.id ?? null,
    category: row?.category ?? category,
    manufacturer: row?.manufacturer ?? "",
    model: row?.model ?? "",
    is_active: row?.is_active ?? true,
    electrical: numbersFrom(row?.electrical),
    temp_coefficients: numbersFrom(row?.temp_coefficients),
    degradation: numbersFrom(row?.degradation),
    dimensions: numbersFrom(row?.dimensions),
    limits: numbersFrom(row?.limits),
    warranties: {
      product_years: (row?.warranties?.product_years as number) ?? null,
      performance_years: (row?.warranties?.performance_years as number) ?? null,
      performance_terms: (row?.warranties?.performance_terms as any[]) ?? [],
    },
    certifications: (row?.certifications ?? []) as any,
  } as PvEquipmentInput;
}

export function PvEquipmentFormDrawer({
  open,
  onOpenChange,
  row,
  category,
  onSaved,
  onEditExisting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PvEquipmentRow | null;
  category: PvCategory;
  onSaved: (id: string) => void;
  onEditExisting: (id: string) => void;
}) {
  const save = useSavePvEquipment();
  const form = useForm<PvEquipmentInput>({
    resolver: zodResolver(pvEquipmentSchema) as any,
    defaultValues: defaultsFor(row, category),
  });

  useEffect(() => {
    if (open) form.reset(defaultsFor(row, category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id, category]);

  const certs = useFieldArray({ control: form.control, name: "certifications" as never });
  const terms = useFieldArray({
    control: form.control,
    name: "warranties.performance_terms" as never,
  });

  const currentCategory = form.watch("category");
  const errors = form.formState.errors as any;

  const numberField = (group: string, f: NumField) => {
    const name = `${group}.${f.key}` as any;
    const err = errors?.[group]?.[f.key]?.message as string | undefined;
    return (
      <div key={name} className="space-y-1.5">
        <Label htmlFor={name} className="text-xs">
          {f.label}
          {f.unit ? <span className="text-muted-foreground"> ({f.unit})</span> : null}
        </Label>
        <Input
          id={name}
          type="number"
          step={f.step ?? "1"}
          {...form.register(name, {
            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
          })}
        />
        {err ? <p className="text-xs text-destructive">{err}</p> : null}
      </div>
    );
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await save.mutateAsync(values);
      onSaved(res.id);
      onOpenChange(false);
    } catch (err) {
      const parsed = parseServerError(err);
      if (parsed.code === "duplicate_model" && parsed.extra?.existingId) {
        toast.error(parsed.message, {
          action: {
            label: "Edit existing",
            onClick: () => {
              onOpenChange(false);
              onEditExisting(parsed.extra.existingId);
            },
          },
        });
        return;
      }
      toast.error(parsed.message);
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{row ? "Edit equipment" : "Add equipment"}</SheetTitle>
          <SheetDescription>
            Manufacturer specifications drive stringing, yield and BOM calculations.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="space-y-6 py-4">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select
                value={currentCategory}
                onValueChange={(v) => form.setValue("category", v as PvCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PV_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {PV_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="pv-active"
                  checked={form.watch("is_active")}
                  onCheckedChange={(v) => form.setValue("is_active", v)}
                />
                <Label htmlFor="pv-active" className="text-xs">
                  Active in library
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manufacturer" className="text-xs">
                Manufacturer
              </Label>
              <Input id="manufacturer" {...form.register("manufacturer")} />
              {errors.manufacturer ? (
                <p className="text-xs text-destructive">{errors.manufacturer.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model" className="text-xs">
                Model
              </Label>
              <Input id="model" {...form.register("model")} />
              {errors.model ? (
                <p className="text-xs text-destructive">{errors.model.message}</p>
              ) : null}
            </div>
          </section>

          <Separator />
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Electrical</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {electricalFields(currentCategory).map((f) => numberField("electrical", f))}
            </div>
          </section>

          {currentCategory === "module" ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Temperature coefficients</h3>
              <div className="grid gap-4 sm:grid-cols-4">
                {TEMP_COEFF_FIELDS.map((f) => numberField("temp_coefficients", f))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Degradation</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {DEGRADATION_FIELDS.map((f) => numberField("degradation", f))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Limits</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              {LIMIT_FIELDS.map((f) => numberField("limits", f))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Dimensions &amp; weight</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              {DIMENSION_FIELDS.map((f) => numberField("dimensions", f))}
            </div>
          </section>

          <Separator />
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Warranty</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField("warranties", { key: "product_years", label: "Product", unit: "years" })}
              {numberField("warranties", {
                key: "performance_years",
                label: "Performance",
                unit: "years",
              })}
            </div>
            <div className="space-y-2">
              {terms.fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Year</Label>
                    <Input
                      type="number"
                      {...form.register(`warranties.performance_terms.${i}.year` as any, {
                        setValueAs: (v) => (v === "" ? null : Number(v)),
                      })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Min output (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      {...form.register(`warranties.performance_terms.${i}.min_output_pct` as any, {
                        setValueAs: (v) => (v === "" ? null : Number(v)),
                      })}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => terms.remove(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => terms.append({ year: 25, min_output_pct: 84.8 } as never)}
              >
                <Plus className="mr-2 h-4 w-4" /> Add performance term
              </Button>
            </div>
          </section>

          <Separator />
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Certifications</h3>
            {certs.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Standard</Label>
                  <Input {...form.register(`certifications.${i}.standard` as const)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Certificate no.</Label>
                  <Input {...form.register(`certifications.${i}.certificate_no` as const)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Valid until</Label>
                  <Input
                    type="date"
                    {...form.register(`certifications.${i}.valid_until` as const)}
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => certs.remove(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                certs.append({ standard: "", certificate_no: "", valid_until: null } as never)
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add certification
            </Button>
          </section>

          <div className="flex justify-end gap-2 pb-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save equipment"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
