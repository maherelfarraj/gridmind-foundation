// P-053 — Revision timeline + status transition control.
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DRAWING_STATUSES,
  getMyDrawingRoles,
  listDrawingSignoffs,
  type DrawingStatus,
  type RevisionRow,
} from "@/lib/drawings.functions";
import {
  drawingRolesQueryOptions,
  drawingSignoffsQueryOptions,
  useDownloadRevision,
  useTransitionDrawingStatus,
} from "@/lib/drawings-query";
import { statusBadgeClass } from "./drawing-register-table";

const STATUS_LABEL: Record<DrawingStatus, string> = {
  draft: "Draft",
  IFD: "IFD",
  IFC: "IFC",
  as_built: "As-built",
  superseded: "Superseded",
};

const TRANSITIONS: Record<DrawingStatus, DrawingStatus[]> = {
  draft: ["IFD", "superseded"],
  IFD: ["IFC", "draft", "superseded"],
  IFC: ["as_built", "superseded"],
  as_built: ["superseded"],
  superseded: [],
};

interface Props {
  drawingId: string;
  projectId: string;
  revisions: RevisionRow[];
  currentRevisionId: string | null;
}

export function RevisionTimeline({ drawingId, projectId, revisions, currentRevisionId }: Props) {
  const rolesFn = useServerFn(getMyDrawingRoles);
  const { data: roles } = useSuspenseQuery(drawingRolesQueryOptions(rolesFn, projectId));

  if (revisions.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No revisions yet. Upload one to begin the review workflow.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {revisions.map((rev) => (
        <RevisionRow
          key={rev.id}
          rev={rev}
          isCurrent={rev.id === currentRevisionId}
          drawingId={drawingId}
          projectId={projectId}
          canTransition={roles.canTransition}
        />
      ))}
    </div>
  );
}

function RevisionRow({
  rev,
  isCurrent,
  drawingId,
  projectId,
  canTransition,
}: {
  rev: RevisionRow;
  isCurrent: boolean;
  drawingId: string;
  projectId: string;
  canTransition: boolean;
}) {
  const download = useDownloadRevision();
  const who = rev.issued_by_profile ?? rev.created_by_profile;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            Rev {rev.revision_code}
          </span>
          <Badge className={statusBadgeClass(rev.status)}>{STATUS_LABEL[rev.status]}</Badge>
          {isCurrent && <Badge variant="outline">Current</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {rev.issue_reason ?? "—"} · uploaded {new Date(rev.created_at).toLocaleString()}
          {who && ` · ${who.full_name ?? who.email ?? "member"}`}
        </p>
        {rev.file_name && (
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{rev.file_name}</span>
            {rev.file_size_bytes != null && (
              <> · {(rev.file_size_bytes / 1024 / 1024).toFixed(2)} MB</>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => download.mutate(rev.id)}
          disabled={download.isPending}
        >
          <Download size={14} aria-hidden />
          Download
        </Button>
        {canTransition && TRANSITIONS[rev.status].length > 0 && (
          <TransitionDialog drawingId={drawingId} projectId={projectId} rev={rev} />
        )}
      </div>
    </Card>
  );
}

function TransitionDialog({
  drawingId,
  projectId,
  rev,
}: {
  drawingId: string;
  projectId: string;
  rev: RevisionRow;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<DrawingStatus | "">("");
  const transition = useTransitionDrawingStatus(drawingId, projectId);
  const signoffsFn = useServerFn(listDrawingSignoffs);
  const { data: signoffs } = useSuspenseQuery(drawingSignoffsQueryOptions(signoffsFn, drawingId));
  const options = TRANSITIONS[rev.status];
  const hasApprovedSignoff = signoffs.some((s) => s.status === "approved");

  const onConfirm = () => {
    if (!target) return;
    transition.mutate(
      { revisionId: rev.id, toStatus: target as DrawingStatus },
      {
        onSuccess: () => {
          setOpen(false);
          setTarget("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change revision status</DialogTitle>
          <DialogDescription>
            Rev {rev.revision_code} is currently{" "}
            <span className="font-mono">{STATUS_LABEL[rev.status]}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Select value={target} onValueChange={(v) => setTarget(v as DrawingStatus)}>
            <SelectTrigger>
              <SelectValue placeholder="Select target status" />
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target === "IFC" && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
              <p className="mb-2 font-semibold text-foreground">
                <ShieldCheck size={14} className="mr-1 inline" />
                IFC governance checklist (enforced server-side)
              </p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• At least one IFD revision on record.</li>
                <li>• All markups on this drawing resolved or accepted.</li>
                <li>
                  • Engineering sign-off approved{" "}
                  {hasApprovedSignoff ? (
                    <Badge className="ml-1 bg-primary/15 text-primary border-primary/40">
                      ✓ approved
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-1">
                      pending
                    </Badge>
                  )}
                </li>
              </ul>
              <p className="mt-2 text-muted-foreground">
                A missing item returns HTTP 409; the request is not applied.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!target || transition.isPending}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
