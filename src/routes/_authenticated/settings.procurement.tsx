// P-064 — Procurement settings (company-admin only): PO approval threshold.
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPoApprovalThreshold, getPoWriteAccess } from "@/lib/po.functions";
import {
  poApprovalThresholdQueryOptions,
  poWriteAccessQueryOptions,
  useSetPoThreshold,
} from "@/lib/po-query";

export const Route = createFileRoute("/_authenticated/settings/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement Settings — GridMind EPC" },
      {
        name: "description",
        content: "Configure the PO approval threshold and other procurement policies.",
      },
    ],
  }),
  component: ProcurementSettings,
});

function ProcurementSettings() {
  const accessFn = useServerFn(getPoWriteAccess);
  const thresholdFn = useServerFn(getPoApprovalThreshold);
  const accessQ = useSuspenseQuery(poWriteAccessQueryOptions(accessFn));
  const thresholdQ = useSuspenseQuery(poApprovalThresholdQueryOptions(thresholdFn));
  const setThreshold = useSetPoThreshold();

  const [value, setValue] = useState<string>(String(thresholdQ.data.threshold));
  useEffect(() => {
    setValue(String(thresholdQ.data.threshold));
  }, [thresholdQ.data.threshold]);

  const canEdit = accessQ.data.canEditThreshold;
  const parsed = Number(value);
  const isValid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Settings2 className="h-3.5 w-3.5" /> Settings · Procurement
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Procurement policy</h1>
        <p className="text-sm text-muted-foreground">
          Purchase orders above this total require finance-admin (CFO) or company-admin approval
          before they can be issued.
        </p>
      </header>

      <section className="rounded-md border border-border p-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="threshold">PO approval threshold</Label>
          <Input
            id="threshold"
            type="number"
            min={0}
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canEdit || setThreshold.isPending}
          />
          <p className="text-xs text-muted-foreground">
            In your default company currency. Currently{" "}
            <span className="font-medium">{thresholdQ.data.threshold.toLocaleString()}</span>.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => setThreshold.mutate(parsed)}
            disabled={
              !canEdit || !isValid || parsed === thresholdQ.data.threshold || setThreshold.isPending
            }
          >
            {setThreshold.isPending ? "Saving…" : "Save threshold"}
          </Button>
        </div>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">
            Only company admins can change this value.
          </p>
        )}
      </section>
    </div>
  );
}
