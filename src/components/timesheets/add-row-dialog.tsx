// P-228 — Add-row dialog: project, optional CWP (42P01-guarded), activity.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listTimesheetCwps } from "@/lib/timesheets.functions";
import { ACTIVITY_LABELS, TIMESHEET_ACTIVITIES } from "@/lib/timesheets/policy";

export interface ProjectOption {
  id: string;
  name: string;
  code: string | null;
}

export function AddRowDialog({
  projects,
  disabled,
  onAdd,
}: {
  projects: ProjectOption[];
  disabled?: boolean;
  onAdd: (row: { project_id: string; cwp_id: string | null; activity: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [cwpId, setCwpId] = useState<string>("none");
  const [activity, setActivity] = useState<string>("regular");

  useEffect(() => {
    setCwpId("none");
  }, [projectId]);

  const cwpFn = useServerFn(listTimesheetCwps);
  const cwps = useQuery({
    queryKey: ["timesheets", "cwps", projectId],
    queryFn: () => cwpFn({ data: { projectId } }),
    enabled: open && Boolean(projectId),
    staleTime: 60_000,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <Plus className="mr-1 h-4 w-4" />
          Add row
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a timesheet row</DialogTitle>
          <DialogDescription>Pick the project, work package and activity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ${p.name}` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {cwps.data && cwps.data.available === false ? (
            <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
              Work packages aren&apos;t enabled yet — hours will be booked at project level.
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label>Work package (optional)</Label>
              <Select value={cwpId} onValueChange={setCwpId} disabled={!projectId}>
                <SelectTrigger>
                  <SelectValue placeholder="No work package" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No work package</SelectItem>
                  {(cwps.data?.rows ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cwp_number} — {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Activity</Label>
            <Select value={activity} onValueChange={setActivity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMESHEET_ACTIVITIES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTIVITY_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!projectId}
            onClick={() => {
              onAdd({ project_id: projectId, cwp_id: cwpId === "none" ? null : cwpId, activity });
              setOpen(false);
              setProjectId("");
              setActivity("regular");
            }}
          >
            Add row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
