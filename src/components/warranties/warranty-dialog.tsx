// P-108 — Warranty create/edit dialog.
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listWarrantyEquipment,
  listWarrantyProjects,
  listWarrantyVendors,
  upsertWarranty,
  type WarrantyRow,
} from "@/lib/warranties.functions";
import {
  warrantyContractUpsertSchema,
  WARRANTY_TYPES,
  type WarrantyContractUpsertInput,
} from "@/lib/warranties.rules";

interface Props {
  warranty?: WarrantyRow | null;
  trigger?: React.ReactNode;
}

export function WarrantyDialog({ warranty, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const projectsFn = useServerFn(listWarrantyProjects);
  const vendorsFn = useServerFn(listWarrantyVendors);
  const equipFn = useServerFn(listWarrantyEquipment);
  const upsertFn = useServerFn(upsertWarranty);

  const projects = useQuery({
    queryKey: ["warranty-projects"],
    queryFn: () => projectsFn(),
    enabled: open,
  });
  const vendors = useQuery({
    queryKey: ["warranty-vendors"],
    queryFn: () => vendorsFn(),
    enabled: open,
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<WarrantyContractUpsertInput>({
    resolver: zodResolver(warrantyContractUpsertSchema) as never,
    defaultValues: warranty
      ? {
          id: warranty.id,
          project_id: warranty.project_id,
          equipment_id: warranty.equipment_id,
          vendor_id: warranty.vendor_id,
          warranty_type: warranty.warranty_type,
          start_date: warranty.start_date,
          end_date: warranty.end_date,
          terms: warranty.terms ?? "",
          coverage_notes: warranty.coverage_notes ?? "",
        }
      : {
          project_id: "",
          equipment_id: null,
          vendor_id: null,
          warranty_type: "manufacturer",
          start_date: today,
          end_date: today,
          terms: "",
          coverage_notes: "",
        },
  });

  const projectId = form.watch("project_id");
  const equipment = useQuery({
    queryKey: ["warranty-equipment", projectId],
    queryFn: () => equipFn({ data: { project_id: projectId } }),
    enabled: !!projectId && open,
  });

  useEffect(() => {
    if (!warranty && projectId) {
      form.setValue("equipment_id", null);
    }
  }, [projectId, warranty, form]);

  const mut = useMutation({
    mutationFn: (v: WarrantyContractUpsertInput) => upsertFn({ data: v }),
    onSuccess: () => {
      toast.success(warranty ? "Warranty updated" : "Warranty registered");
      qc.invalidateQueries({ queryKey: ["warranties"] });
      qc.invalidateQueries({ queryKey: ["warranty-kpis"] });
      setOpen(false);
      if (!warranty) form.reset();
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to save warranty"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New warranty
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{warranty ? "Edit warranty" : "Register warranty"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(projects.data ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="equipment_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Equipment (optional)</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                      disabled={!projectId}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Project-wide" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— Project-wide —</SelectItem>
                        {(equipment.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.tag}
                            {e.manufacturer ? ` · ${e.manufacturer}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="warranty_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {WARRANTY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vendor_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vendor (optional)</FormLabel>
                    <Select
                      value={field.value ?? "none"}
                      onValueChange={(v) => field.onChange(v === "none" ? null : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {(vendors.data ?? []).map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="terms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terms</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={2}
                      placeholder="Key terms, exclusions"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="coverage_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Coverage notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                      placeholder="What is covered / not covered"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending}>
                {mut.isPending ? "Saving…" : warranty ? "Save" : "Register"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
