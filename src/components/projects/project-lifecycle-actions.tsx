import { useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/locale-provider";
import { completeProject, reopenProject } from "@/lib/project-status.functions";
import { getProjectLifecycleActionState } from "@/lib/project-status.rules";
import type { ProjectDetail } from "@/lib/projects.functions";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ProjectLifecycleActions({ project }: { project: ProjectDetail }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const completeFn = useServerFn(completeProject);
  const reopenFn = useServerFn(reopenProject);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const handoverGate = project.gates.find((gate) => gate.phase === "handover");
  const state = getProjectLifecycleActionState({
    roles: project.caller_roles,
    projectStatus: project.status,
    projectPhase: project.phase,
    handoverGateStatus: handoverGate?.status,
  });

  const refreshProject = async () => {
    await queryClient.invalidateQueries({ queryKey: ["project-detail", project.id] });
  };

  const completeMutation = useMutation({
    mutationFn: () => completeFn({ data: { projectId: project.id } }),
    onSuccess: async () => {
      setCompleteOpen(false);
      await refreshProject();
      toast.success(t("engMod.projectDetail.lifecycle.completeSuccess"));
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, t("engMod.projectDetail.lifecycle.completeFailed"))),
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      reopenFn({
        data: {
          projectId: project.id,
          reason: reopenReason,
        },
      }),
    onSuccess: async () => {
      setReopenOpen(false);
      setReopenReason("");
      await refreshProject();
      toast.success(t("engMod.projectDetail.lifecycle.reopenSuccess"));
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, t("engMod.projectDetail.lifecycle.reopenFailed"))),
  });

  const isProjectAdmin = project.caller_roles.includes("project_admin");
  const isCompanyAdmin = project.caller_roles.includes("company_admin");
  const showComplete = isProjectAdmin && project.status !== "completed";
  const showReopen = isCompanyAdmin && project.status === "completed";

  if (!showComplete && !showReopen) return null;

  const blockerKey = state.completionBlocker
    ? `engMod.projectDetail.lifecycle.blockers.${state.completionBlocker}`
    : null;

  const setReopenDialogOpen = (open: boolean) => {
    setReopenOpen(open);
    if (!open && !reopenMutation.isPending) setReopenReason("");
  };

  return (
    <>
      {showComplete ? (
        <Button
          type="button"
          size="sm"
          disabled={!state.canComplete || completeMutation.isPending}
          title={blockerKey ? t(blockerKey) : undefined}
          onClick={() => setCompleteOpen(true)}
        >
          <CheckCircle2 aria-hidden />
          {completeMutation.isPending
            ? t("engMod.projectDetail.lifecycle.completing")
            : t("engMod.projectDetail.lifecycle.complete")}
        </Button>
      ) : null}

      {showReopen ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reopenMutation.isPending}
          onClick={() => setReopenOpen(true)}
        >
          <RotateCcw aria-hidden />
          {t("engMod.projectDetail.lifecycle.reopen")}
        </Button>
      ) : null}

      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("engMod.projectDetail.lifecycle.completeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("engMod.projectDetail.lifecycle.completeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completeMutation.isPending}>
              {t("engMod.projectDetail.lifecycle.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              {t("engMod.projectDetail.lifecycle.confirmComplete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("engMod.projectDetail.lifecycle.reopenTitle")}</DialogTitle>
            <DialogDescription>
              {t("engMod.projectDetail.lifecycle.reopenDescription")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reopenReason}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setReopenReason(event.target.value)
            }
            rows={4}
            maxLength={2000}
            placeholder={t("engMod.projectDetail.lifecycle.reopenPlaceholder")}
          />
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reopenMutation.isPending}
              onClick={() => setReopenDialogOpen(false)}
            >
              {t("engMod.projectDetail.lifecycle.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reopenReason.trim().length === 0 || reopenMutation.isPending}
              onClick={() => reopenMutation.mutate()}
            >
              {reopenMutation.isPending
                ? t("engMod.projectDetail.lifecycle.reopening")
                : t("engMod.projectDetail.lifecycle.confirmReopen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
