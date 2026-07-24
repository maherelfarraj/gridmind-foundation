import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSaveProposalHeader } from "@/lib/proposal-query";
import type { ProposalDetail } from "@/lib/proposal.functions";

const CURRENCIES = ["USD", "EUR", "AED", "JOD", "MAD", "CNY"];

const schema = z.object({
  title: z.string().min(1, "Required").max(200),
  currency_code: z.string().min(3).max(3),
  contingency_pct: z.coerce.number().min(0).max(100),
  margin_pct: z.coerce.number().min(0).max(100),
  valid_until: z.string().nullable(),
  notes: z.string().nullable(),
});

type FormValues = z.infer<typeof schema>;

export function ProposalHeaderForm({
  proposal,
  readOnly,
}: {
  proposal: ProposalDetail;
  readOnly: boolean;
}) {
  const save = useSaveProposalHeader(proposal.id);
  const [dirty, setDirty] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: proposal.title ?? "",
      currency_code: proposal.currency_code,
      contingency_pct: proposal.contingency_pct,
      margin_pct: proposal.margin_pct,
      valid_until: proposal.valid_until,
      notes: proposal.notes,
    },
  });
  const currency = watch("currency_code");

  const onSubmit = (v: FormValues) => {
    save.mutate(v, {
      onSuccess: () => {
        setDirty(false);
        reset(v);
      },
    });
  };

  return (
    <Card className="p-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        onChange={() => setDirty(true)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Label htmlFor="title">Proposal title</Label>
          <Input id="title" disabled={readOnly} {...register("title")} />
          {errors.title && (
            <p className="mt-1 text-xs text-destructive">
              {errors.title.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="currency">Currency</Label>
          <Select
            value={currency}
            onValueChange={(v) => {
              setValue("currency_code", v, { shouldDirty: true });
              setDirty(true);
            }}
            disabled={readOnly}
          >
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="valid_until">Valid until</Label>
          <Input
            id="valid_until"
            type="date"
            disabled={readOnly}
            defaultValue={
              proposal.valid_until
                ? format(new Date(proposal.valid_until), "yyyy-MM-dd")
                : ""
            }
            {...register("valid_until", {
              setValueAs: (v) => (v ? v : null),
            })}
          />
        </div>

        <div>
          <Label htmlFor="contingency">Contingency %</Label>
          <Input
            id="contingency"
            type="number"
            step="0.1"
            min="0"
            max="100"
            disabled={readOnly}
            {...register("contingency_pct")}
          />
        </div>

        <div>
          <Label htmlFor="margin">Margin %</Label>
          <Input
            id="margin"
            type="number"
            step="0.1"
            min="0"
            max="100"
            disabled={readOnly}
            {...register("margin_pct")}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            rows={3}
            disabled={readOnly}
            {...register("notes", {
              setValueAs: (v) => (v ? v : null),
            })}
          />
        </div>

        {!readOnly && (
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? "Saving…" : "Save header"}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
