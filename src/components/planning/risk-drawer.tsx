// P-074 — Risk create/edit drawer (Sheet + react-hook-form + zod).
import { useEffect, useMemo } from "react";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  allowedStatusTransitions,
  bandForScore,
  IMPACT_LABELS,
  PROBABILITY_LABELS,
  RISK_CATEGORIES,
  RISK_CATEGORY_LABEL,
  RISK_STATUS_LABEL,
  RISK_STATUSES,
  riskWritableSchema,
  SCORE_BAND_LABEL,
  SCORE_BAND_TEXT,
  scoreOf,
  type RiskCategory,
  type RiskStatus,
} from "@/lib/risks.rules";
import type { ProjectMember, RiskRow } from "@/lib/risks.functions";

type FormValues = z.infer<typeof riskWritableSchema>;

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "INR", "JPY"] as const;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  risk: RiskRow | null;
  members: ProjectMember[];
  canWrite: boolean;
  saving: boolean;
  onSubmit: (values: FormValues) => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export function RiskDrawer({
  open,
  onOpenChange,
  mode,
  risk,
  members,
  canWrite,
  saving,
  onSubmit,
  onDelete,
  deleting,
}: Props) {
  const defaults = useMemo<FormValues>(
    () => ({
      title: risk?.title ?? "",
      description: risk?.description ?? "",
      category: (risk?.category as RiskCategory) ?? "schedule",
      probability: risk?.probability ?? 3,
      impact: risk?.impact ?? 3,
      status: (risk?.status as RiskStatus) ?? "open",
      owner_id: risk?.owner_id ?? null,
      mitigation: risk?.mitigation ?? "",
      contingency_amount: risk?.contingency_amount ?? null,
      currency_code: risk?.currency_code ?? "USD",
      target_close_date: risk?.target_close_date ?? null,
      identified_at:
        risk?.identified_at ?? format(new Date(), "yyyy-MM-dd"),
    }),
    [risk],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(riskWritableSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const probability = form.watch("probability");
  const impact = form.watch("impact");
  const currentStatus = form.watch("status");
  const score = scoreOf(probability, impact);
  const band = bandForScore(score);

  const statusOptions =
    mode === "create"
      ? RISK_STATUSES
      : allowedStatusTransitions((risk?.status as RiskStatus) ?? "open");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "New risk" : "Edit risk"}</SheetTitle>
          <SheetDescription>
            Track probability, impact, mitigation, and contingency exposure.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...form.register("title")}
              disabled={!canWrite}
            />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select
                value={form.watch("category")}
                onValueChange={(v) =>
                  form.setValue("category", v as RiskCategory, {
                    shouldDirty: true,
                  })
                }
                disabled={!canWrite}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {RISK_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select
                value={currentStatus}
                onValueChange={(v) =>
                  form.setValue("status", v as RiskStatus, {
                    shouldDirty: true,
                  })
                }
                disabled={!canWrite}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {RISK_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={3}
              {...form.register("description")}
              disabled={!canWrite}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
            <SliderField
              label={`Probability: ${PROBABILITY_LABELS[probability]}`}
              value={probability}
              onChange={(v) =>
                form.setValue("probability", v, { shouldDirty: true })
              }
              disabled={!canWrite}
            />
            <SliderField
              label={`Impact: ${IMPACT_LABELS[impact]}`}
              value={impact}
              onChange={(v) =>
                form.setValue("impact", v, { shouldDirty: true })
              }
              disabled={!canWrite}
            />
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Score</span>
                <span
                  className={cn(
                    "font-semibold",
                    SCORE_BAND_TEXT[band],
                  )}
                >
                  {score} · {SCORE_BAND_LABEL[band]}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Owner</Label>
            <Select
              value={form.watch("owner_id") ?? "none"}
              onValueChange={(v) =>
                form.setValue("owner_id", v === "none" ? null : v, {
                  shouldDirty: true,
                })
              }
              disabled={!canWrite}
            >
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name || m.email || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mitigation">Mitigation plan</Label>
            <Textarea
              id="mitigation"
              rows={3}
              {...form.register("mitigation")}
              disabled={!canWrite}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contingency_amount">Contingency amount</Label>
              <Input
                id="contingency_amount"
                type="number"
                min={0}
                step="0.01"
                {...form.register("contingency_amount", {
                  setValueAs: (v) =>
                    v === "" || v == null ? null : Number(v),
                })}
                disabled={!canWrite}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Currency</Label>
              <Select
                value={form.watch("currency_code") ?? "USD"}
                onValueChange={(v) =>
                  form.setValue("currency_code", v, { shouldDirty: true })
                }
                disabled={!canWrite}
              >
                <SelectTrigger>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="Identified"
              value={form.watch("identified_at") ?? null}
              onChange={(v) =>
                form.setValue("identified_at", v ?? undefined, {
                  shouldDirty: true,
                })
              }
              disabled={!canWrite}
            />
            <DateField
              label="Target close"
              value={form.watch("target_close_date") ?? null}
              onChange={(v) =>
                form.setValue("target_close_date", v, { shouldDirty: true })
              }
              disabled={!canWrite}
            />
          </div>

          <SheetFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {mode === "edit" && onDelete && canWrite ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={onDelete}
                disabled={deleting}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canWrite || saving}>
                {saving ? "Saving…" : mode === "create" ? "Create risk" : "Save"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SliderField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Slider
        min={1}
        max={5}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? 1)}
        disabled={disabled}
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const date = value ? new Date(value) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon size={14} className="mr-2" />
            {date ? format(date, "PPP") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) =>
              onChange(d ? format(d, "yyyy-MM-dd") : null)
            }
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
