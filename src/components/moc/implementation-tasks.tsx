// P-191 — Implementation tasks panel: owner-role badges, done/skip toggles, progress.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ListChecks, SkipForward, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { entityHref } from "@/components/moc/affected-systems";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  listImplementationTasks,
  updateImplementationTask,
} from "@/lib/moc.exec.functions";
import { ownerRoleLabel, taskProgress, type ImplementationTask } from "@/lib/moc.exec.rules";

interface Props {
  changeRequestId: string;
  canEdit: boolean;
}

export function ImplementationTasks({ changeRequestId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listImplementationTasks);
  const updateFn = useServerFn(updateImplementationTask);
  const [doneTask, setDoneTask] = useState<ImplementationTask | null>(null);
  const [note, setNote] = useState("");

  const tasks = useQuery({
    queryKey: ["moc", "tasks", changeRequestId],
    queryFn: () => listFn({ data: { id: changeRequestId } }),
  });

  const mutation = useMutation({
    mutationFn: (input: { task_id: string; status: "done" | "skipped" | "pending"; note: string }) =>
      updateFn({ data: input }),
    onSuccess: () => {
      toast.success("Task updated");
      setDoneTask(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["moc"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update the task"),
  });

  if (tasks.isPending) return <Skeleton className="h-40 w-full" />;

  const rows = tasks.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No implementation tasks yet"
        description="Tasks are generated automatically when the change is approved."
      />
    );
  }

  const progress = taskProgress(rows);

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Implementation progress</span>
          <span className="text-muted-foreground">
            {progress.resolved} of {progress.total} resolved
          </span>
        </div>
        <Progress value={progress.pct} aria-label="Implementation progress" />
      </Card>

      <ul className="space-y-2">
        {rows.map((task) => {
          const href = task.entity_type && task.entity_id
            ? entityHref(task.entity_type, task.entity_id)
            : null;
          return (
            <li key={task.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{task.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">{ownerRoleLabel(task.owner_role)}</Badge>
                    <StatusBadge status={task.status} />
                    {task.entity_type ? (
                      href ? (
                        <Link to={href} className="underline underline-offset-2">
                          {task.entity_type}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{task.entity_type}</span>
                      )
                    ) : null}
                  </div>
                  {task.evidence.length > 0 ? (
                    <ul className="list-inside list-disc text-xs text-muted-foreground">
                      {task.evidence.map((e, i) => (
                        <li key={`${task.id}-ev-${i}`}>{e.note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex gap-2">
                    {task.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDoneTask(task);
                            setNote("");
                          }}
                        >
                          <Check className="mr-1 size-4" aria-hidden />
                          Done
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              task_id: task.id,
                              status: "skipped",
                              note: "Skipped — not applicable.",
                            })
                          }
                        >
                          <SkipForward className="mr-1 size-4" aria-hidden />
                          Skip
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mutation.isPending}
                        onClick={() =>
                          mutation.mutate({ task_id: task.id, status: "pending", note: "" })
                        }
                      >
                        <Undo2 className="mr-1 size-4" aria-hidden />
                        Reopen
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={doneTask !== null} onOpenChange={(open) => !open && setDoneTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete task</DialogTitle>
            <DialogDescription>
              An evidence note is required so the closure trail is contract-grade.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done, and where is the proof?"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneTask(null)}>
              Cancel
            </Button>
            <Button
              disabled={note.trim().length === 0 || mutation.isPending}
              onClick={() =>
                mutation.mutate({ task_id: doneTask!.id, status: "done", note: note.trim() })
              }
            >
              Mark done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
