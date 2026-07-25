// P-075 — Cost code create/edit dialog.
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { COST_CODE_REGEX } from "@/lib/budget.rules";
import type { CostCodeRow } from "@/lib/budget.functions";

const NONE = "__none";

const formSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Required")
    .max(60)
    .regex(COST_CODE_REGEX, "Use letters/numbers with '-' or '.'"),
  name: z.string().trim().min(1, "Required").max(160),
  description: z.string().trim().max(1000).optional(),
  parent_id: z.string().nullable().optional(),
  wbs_item_id: z.string().nullable().optional(),
  is_active: z.boolean(),
});
export type CostCodeFormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  costCode: CostCodeRow | null;
  costCodeOptions: Array<{ id: string; code: string; name: string }>;
  wbsOptions: Array<{ id: string; code: string; name: string }>;
  saving: boolean;
  onSubmit: (values: CostCodeFormValues) => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export function CostCodeDialog({
  open,
  onOpenChange,
  mode,
  costCode,
  costCodeOptions,
  wbsOptions,
  saving,
  onSubmit,
  onDelete,
  deleting,
}: Props) {
  const form = useForm<CostCodeFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      parent_id: null,
      wbs_item_id: null,
      is_active: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && costCode) {
      form.reset({
        code: costCode.code,
        name: costCode.name,
        description: costCode.description ?? "",
        parent_id: costCode.parent_id,
        wbs_item_id: costCode.wbs_item_id,
        is_active: costCode.is_active,
      });
    } else {
      form.reset({
        code: "",
        name: "",
        description: "",
        parent_id: null,
        wbs_item_id: null,
        is_active: true,
      });
    }
  }, [open, mode, costCode, form]);

  const parentOptions =
    mode === "edit" ? costCodeOptions.filter((c) => c.id !== costCode?.id) : costCodeOptions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New cost code" : `Edit ${costCode?.code}`}
          </DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <Label htmlFor="cc-code">Code</Label>
              <Input id="cc-code" placeholder="01-1000" {...form.register("code")} />
              {form.formState.errors.code && (
                <p className="mt-1 text-xs text-destructive">
                  {form.formState.errors.code.message}
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label htmlFor="cc-name">Name</Label>
              <Input id="cc-name" placeholder="Engineering" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="cc-desc">Description</Label>
            <Textarea id="cc-desc" rows={2} {...form.register("description")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Parent</Label>
              <Select
                value={form.watch("parent_id") ?? NONE}
                onValueChange={(v) => form.setValue("parent_id", v === NONE ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None (root)</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Mapped WBS</Label>
              <Select
                value={form.watch("wbs_item_id") ?? NONE}
                onValueChange={(v) => form.setValue("wbs_item_id", v === NONE ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {wbsOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="cc-active"
              checked={form.watch("is_active")}
              onCheckedChange={(v) => form.setValue("is_active", !!v)}
            />
            <Label htmlFor="cc-active" className="cursor-pointer">
              Active
            </Label>
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <div>
              {mode === "edit" && onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  disabled={deleting}
                  className="text-destructive"
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
