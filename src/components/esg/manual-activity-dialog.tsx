// P-216 — Manual ESG activity entry / edit dialog.
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerFn } from "@tanstack/react-start";
import { Leaf, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/dpr-query";
import {
  ESG_CATEGORIES,
  ESG_CATEGORY_LABEL,
  evidenceError,
  evidencePath,
  type EsgCategory,
  type ResolvedFactor,
} from "@/lib/esg/activity.rules";
import {
  createEsgActivity,
  setEsgActivityEvidence,
  updateEsgActivity,
} from "@/lib/esg/activity.functions";

const formSchema = z.object({
  category: z.enum(ESG_CATEGORIES),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().trim().min(1, "Unit is required").max(24),
  notes: z.string().trim().max(1000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

export type EditableActivity = {
  id: string;
  category: EsgCategory;
  quantity: number;
  unit: string;
  notes: string | null;
};

export function ManualActivityDialog({
  open,
  onOpenChange,
  projectId,
  companyId,
  month,
  factors,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  companyId: string;
  month: string;
  factors: Record<string, ResolvedFactor>;
  editing: EditableActivity | null;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createEsgActivity);
  const updateFn = useServerFn(updateEsgActivity);
  const evidenceFn = useServerFn(setEsgActivityEvidence);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { category: "fuel_diesel", quantity: 0, unit: "L", notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        category: editing.category,
        quantity: Number(editing.quantity),
        unit: editing.unit,
        notes: editing.notes ?? "",
      });
    } else {
      const first = factors.fuel_diesel;
      form.reset({ category: "fuel_diesel", quantity: 0, unit: first?.unit ?? "L", notes: "" });
    }
  }, [open, editing, factors, form]);

  const category = form.watch("category");
  const factor = useMemo(() => factors[category], [factors, category]);

  useEffect(() => {
    if (!open || !factor) return;
    form.setValue("unit", factor.unit, { shouldValidate: true });
  }, [factor, open, form]);

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      const file = fileRef.current?.files?.[0] ?? null;
      if (file) {
        const problem = evidenceError(file);
        if (problem) {
          toast.error(problem);
          setSaving(false);
          return;
        }
      }
      let activityId = editing?.id ?? "";
      if (editing) {
        await updateFn({
          data: {
            id: editing.id,
            category: values.category,
            quantity: values.quantity,
            unit: values.unit,
            notes: values.notes || null,
          },
        });
      } else {
        const row = (await createFn({
          data: {
            projectId,
            month,
            category: values.category,
            quantity: values.quantity,
            unit: values.unit,
            notes: values.notes || null,
          },
        })) as { id: string };
        activityId = row.id;
      }
      if (file && activityId) {
        const path = evidencePath({
          companyId,
          projectId,
          activityId,
          fileName: file.name,
        });
        const up = await supabase.storage
          .from("documents")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (up.error) throw up.error;
        await evidenceFn({ data: { id: activityId, path } });
      }
      toast.success(editing ? "Activity updated" : "Activity recorded");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit activity" : "Record activity"}</DialogTitle>
          <DialogDescription>
            Manual entry for {month}. Units follow the resolved emission factor.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ESG_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {ESG_CATEGORY_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription className="flex items-center gap-1">
                      <Leaf className="size-3" aria-hidden />
                      {factor
                        ? `${factor.factorSource} · ${factor.scope === "company" ? "company override" : "global default"}`
                        : "No factor found — enter a unit manually"}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground" htmlFor="esg-evidence">
                Evidence (optional)
              </label>
              <Input
                id="esg-evidence"
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
              />
              <p className="text-xs text-muted-foreground">PDF, JPG or PNG up to 10 MB.</p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {editing ? "Save changes" : "Record activity"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
