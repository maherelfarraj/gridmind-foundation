import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { getWinConversionPrefill } from "@/lib/opportunity.functions";
import {
  useBuildKickoffPack,
  useConvertOpportunity,
  winConversionPrefillQueryOptions,
} from "@/lib/opportunity-query";

const ARCHETYPES = [
  { v: "utility_pv", l: "Utility PV" },
  { v: "standalone_bess", l: "Standalone BESS" },
  { v: "c_and_i_rooftop", l: "C&I Rooftop" },
  { v: "hybrid_pv_bess", l: "Hybrid PV + BESS" },
  { v: "onshore_wind", l: "Onshore Wind" },
  { v: "green_hydrogen", l: "Green Hydrogen" },
  { v: "transmission_substation", l: "Transmission & Substation" },
] as const;

interface Props {
  opportunityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (intakeId: string) => void;
}

export function WinConversionDialog({
  opportunityId,
  open,
  onOpenChange,
  onConverted,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open ? (
          <WinConversionForm
            opportunityId={opportunityId}
            onClose={() => onOpenChange(false)}
            onConverted={onConverted}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WinConversionForm({
  opportunityId,
  onClose,
  onConverted,
}: {
  opportunityId: string;
  onClose: () => void;
  onConverted?: (intakeId: string) => void;
}) {
  const prefillFn = useServerFn(getWinConversionPrefill);
  const { data } = useSuspenseQuery(
    winConversionPrefillQueryOptions(prefillFn, opportunityId),
  );

  const opp = data?.opportunity;
  const owners = data?.owners ?? [];

  const [name, setName] = useState(opp?.name ?? "");
  const [archetype, setArchetype] = useState<string>(
    (opp?.archetype && ARCHETYPES.some((a) => a.v === opp.archetype)
      ? opp.archetype
      : "utility_pv") as string,
  );
  const [capacity, setCapacity] = useState<string>(
    opp?.capacity_mw != null ? String(opp.capacity_mw) : "",
  );
  const [offtaker, setOfftaker] = useState<string>(opp?.account_name ?? "");
  const [targetCod, setTargetCod] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");

  const convert = useConvertOpportunity(opportunityId);
  const buildPack = useBuildKickoffPack(opportunityId);

  useEffect(() => {
    if (opp?.converted_intake_id) {
      // Already converted — surface and close.
      onConverted?.(opp.converted_intake_id);
      onClose();
    }
  }, [opp?.converted_intake_id, onClose, onConverted]);

  const submitting = convert.isPending || buildPack.isPending;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const cap = capacity.trim() === "" ? null : Number(capacity);
        const res = await convert.mutateAsync({
          opportunityId,
          name: name.trim(),
          archetype: archetype as any,
          capacity_mw: cap != null && Number.isFinite(cap) ? cap : null,
          offtaker: offtaker.trim() || null,
          target_cod: targetCod || null,
          owner_id: ownerId || null,
        });
        // Best-effort kick-off pack — failures are toasted but don't block success.
        try {
          await buildPack.mutateAsync({ intakeId: res.intake_id });
        } catch {
          /* handled via toast */
        }
        onConverted?.(res.intake_id);
        onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>Convert opportunity to project</DialogTitle>
        <DialogDescription>
          Marks this opportunity as won and creates a project intake record.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="wc-name">Project name</Label>
          <Input
            id="wc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wc-arch">Archetype</Label>
            <Select value={archetype} onValueChange={setArchetype}>
              <SelectTrigger id="wc-arch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARCHETYPES.map((a) => (
                  <SelectItem key={a.v} value={a.v}>
                    {a.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wc-cap">Capacity (MW)</Label>
            <Input
              id="wc-cap"
              type="number"
              step="0.01"
              min="0"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="wc-off">Offtaker</Label>
          <Input
            id="wc-off"
            value={offtaker}
            onChange={(e) => setOfftaker(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wc-cod">Target COD</Label>
            <Input
              id="wc-cod"
              type="date"
              value={targetCod}
              onChange={(e) => setTargetCod(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wc-owner">Project owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger id="wc-owner">
                <SelectValue placeholder="Assign later" />
              </SelectTrigger>
              <SelectContent>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.full_name || o.email || o.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 size={14} aria-hidden className="animate-spin" />
              Converting…
            </>
          ) : (
            "Mark as won"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
