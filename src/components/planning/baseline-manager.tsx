// P-073 — Baseline manager dialog.
import { format } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Trash2, History } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { deleteBaseline, lockBaseline, type BaselineRow } from "@/lib/schedule.functions";
import { scheduleErrorMessage } from "@/lib/schedule.query";

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baselines: BaselineRow[];
  canLock: boolean;
  canWrite: boolean;
}

export function BaselineManager({
  projectId,
  open,
  onOpenChange,
  baselines,
  canLock,
  canWrite,
}: Props) {
  const queryClient = useQueryClient();
  const lockFn = useServerFn(lockBaseline);
  const deleteFn = useServerFn(deleteBaseline);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["schedule", "baselines", projectId],
    });

  const lockMut = useMutation({
    mutationFn: (id: string) => lockFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Baseline locked 🔒");
      invalidate();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Baseline deleted");
      invalidate();
    },
    onError: (e) => toast.error(scheduleErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Baselines</DialogTitle>
          <DialogDescription>
            Locked baselines are immutable — they can never be edited or deleted.
          </DialogDescription>
        </DialogHeader>

        {baselines.length === 0 ? (
          <EmptyState
            icon={History}
            title="No baselines yet"
            description="Create one from the toolbar to snapshot the current schedule."
            compact
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {baselines.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded border border-border bg-card/40 p-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{b.name}</span>
                    {b.locked ? (
                      <Badge className="gap-1">
                        <Lock size={10} aria-hidden />
                        Locked
                      </Badge>
                    ) : (
                      <Badge variant="outline">Draft</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.snapshot.length} task
                    {b.snapshot.length === 1 ? "" : "s"} ·{" "}
                    {format(new Date(b.created_at), "dd MMM yyyy HH:mm")}
                    {b.locked && b.locked_at
                      ? ` · locked ${format(new Date(b.locked_at), "dd MMM yyyy")}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!b.locked && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canLock || lockMut.isPending}
                      onClick={() => lockMut.mutate(b.id)}
                    >
                      <Lock size={12} aria-hidden />
                      Lock
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive"
                    disabled={b.locked || !canWrite || deleteMut.isPending}
                    onClick={() => deleteMut.mutate(b.id)}
                    aria-label="Delete baseline"
                    title={b.locked ? "Locked baselines cannot be deleted" : "Delete baseline"}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
