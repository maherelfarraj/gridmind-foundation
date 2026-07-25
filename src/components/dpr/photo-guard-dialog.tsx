// P-086 — Submit guard dialog with SHOULD banner + explicit ack checkbox.
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoCount: number;
  acknowledge: boolean;
  onAcknowledgeChange: (v: boolean) => void;
  onConfirm: () => void;
  submitting: boolean;
}

export function PhotoGuardDialog({
  open,
  onOpenChange,
  photoCount,
  acknowledge,
  onAcknowledgeChange,
  onConfirm,
  submitting,
}: Props) {
  const noPhotos = photoCount === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit daily report?</DialogTitle>
          <DialogDescription>
            Once submitted, this report becomes read-only. Only an admin can approve it.
          </DialogDescription>
        </DialogHeader>

        {noPhotos && (
          <div className="rounded-md border border-warning-foreground/30 bg-warning/15 p-3 text-sm text-warning-foreground">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                No photos attached — site photos <b>SHOULD</b> accompany every DPR.
              </div>
            </div>
          </div>
        )}

        {noPhotos && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="ack-no-photos"
              checked={acknowledge}
              onCheckedChange={(v) => onAcknowledgeChange(Boolean(v))}
            />
            <Label htmlFor="ack-no-photos" className="text-sm leading-tight">
              Submit without photos — I confirm site photos will be added later.
            </Label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11"
            disabled={submitting || (noPhotos && !acknowledge)}
            onClick={onConfirm}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
