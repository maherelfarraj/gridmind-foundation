// P-228 — Profile default hourly-rate card (side panel).
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Info, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { updateDefaultHourlyRate } from "@/lib/timesheets.functions";

const currency = new Intl.NumberFormat("en-JO", {
  style: "currency",
  currency: "JOD",
  maximumFractionDigits: 2,
});

export function HourlyRateCard({
  loading,
  error,
  userId,
  rate,
  canEdit,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  userId: string | null;
  rate: number | null;
  canEdit: boolean;
  onRetry: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string>(rate == null ? "" : String(rate));
  useEffect(() => {
    setValue(rate == null ? "" : String(rate));
  }, [rate]);

  const updateFn = useServerFn(updateDefaultHourlyRate);
  const save = useMutation({
    mutationFn: async () => {
      if (!userId) return null;
      const parsed = value.trim() === "" ? null : Number(value);
      if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
        throw new Error("Enter a valid rate");
      }
      return updateFn({ data: { user_id: userId, rate: parsed } });
    },
    onSuccess: () => {
      toast.success("Default hourly rate updated");
      void qc.invalidateQueries({ queryKey: ["timesheets", "rate"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message || "Could not update rate"),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Default hourly rate
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Used for labor costing when an entry has no explicit rate
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : error ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Could not load your rate.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : canEdit ? (
          <div className="space-y-2">
            <Label htmlFor="default-rate" className="text-xs text-muted-foreground">
              Rate per hour
            </Label>
            <div className="flex gap-2">
              <Input
                id="default-rate"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0.00"
              />
              <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {rate == null ? "—" : currency.format(rate)}
            </p>
            <p className="text-xs text-muted-foreground">
              Read-only — ask a project or company admin to change it.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
