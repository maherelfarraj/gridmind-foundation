// P-108 — Claim create dialog with expired-warranty override.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClaim } from "@/lib/warranties.functions";
import {
  daysRemaining,
  warrantyClaimCreateSchema,
  type WarrantyClaimCreateInput,
} from "@/lib/warranties.rules";

interface Props {
  warrantyId: string;
  endDate: string;
  isOmAdmin: boolean;
}

export function ClaimDialog({ warrantyId, endDate, isOmAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const qc = useQueryClient();
  const createFn = useServerFn(createClaim);

  const expired = daysRemaining(endDate) < 0;

  const form = useForm<WarrantyClaimCreateInput>({
    resolver: zodResolver(warrantyClaimCreateSchema) as never,
    defaultValues: {
      warranty_id: warrantyId,
      title: "",
      description: "",
      claimed_amount: null,
      currency_code: null,
      override_note: null,
    },
  });

  const mut = useMutation({
    mutationFn: (v: WarrantyClaimCreateInput) => createFn({ data: v }),
    onSuccess: (row) => {
      toast.success(`Created ${row.claim_number}`);
      qc.invalidateQueries({ queryKey: ["claims", warrantyId] });
      qc.invalidateQueries({ queryKey: ["warranty-kpis"] });
      setOpen(false);
      form.reset();
      setShowOverride(false);
    },
    onError: (e: Error) => {
      if (e.message === "expired_warranty_no_override") {
        toast.error("Warranty is expired — an O&M admin must override.");
      } else if (e.message === "expired_override_note_required") {
        toast.error("Override note is required (≥3 chars).");
      } else {
        toast.error(e.message ?? "Failed to create claim");
      }
    },
  });

  const canCreate = !expired || (isOmAdmin && showOverride);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-3 w-3" /> New claim
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New warranty claim</DialogTitle>
        </DialogHeader>

        {expired ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warranty expired</AlertTitle>
            <AlertDescription>
              {isOmAdmin
                ? "You may override with a justification note."
                : "Only an O&M admin can override to file a claim after expiry."}
            </AlertDescription>
          </Alert>
        ) : null}

        {expired && isOmAdmin ? (
          <div className="flex items-center gap-2">
            <Switch checked={showOverride} onCheckedChange={setShowOverride} />
            <span className="text-sm">Override expiry (O&amp;M admin)</span>
          </div>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((v) =>
              mut.mutate({
                ...v,
                override_note: showOverride ? v.override_note : null,
              }),
            )}
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Inverter fan failure" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ""}
                      rows={3}
                      placeholder="Symptoms, dates, references"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="claimed_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claimed amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={3}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? null
                              : e.target.value.toUpperCase(),
                          )
                        }
                        placeholder="USD"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {expired && isOmAdmin && showOverride ? (
              <FormField
                control={form.control}
                name="override_note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Override justification</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={2}
                        placeholder="Why this claim is still valid"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mut.isPending || !canCreate}>
                {mut.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
