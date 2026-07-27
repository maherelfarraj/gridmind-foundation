// P-210 — New estimate dialog: title, project, optional opportunity, currency
// and an optional BOM snapshot to import as material lines.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Plus } from "lucide-react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { createEstimate } from "@/lib/estimating.functions";
import { estimatingErrorMessage } from "@/lib/estimating.query";
import { CreateEstimateSchema } from "@/lib/estimating.rules";
import type { EstimatingRegister } from "@/lib/estimating.functions";
import { formatDate } from "@/lib/format";

const NONE = "__none__";

export function NewEstimateDialog({ register }: { register: EstimatingRegister }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useServerFn(createEstimate);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [opportunityId, setOpportunityId] = useState(NONE);
  const [snapshotId, setSnapshotId] = useState(NONE);
  const [currency, setCurrency] = useState("USD");

  const snapshots = useMemo(
    () =>
      register.snapshots
        .filter((s) => s.project_id === projectId)
        .sort((a, b) => (a.status === "released" ? -1 : 0) - (b.status === "released" ? -1 : 0)),
    [register.snapshots, projectId],
  );

  const payload = {
    title,
    project_id: projectId,
    opportunity_id: opportunityId === NONE ? null : opportunityId,
    bom_snapshot_id: snapshotId === NONE ? null : snapshotId,
    currency_code: currency,
  };
  const valid = CreateEstimateSchema.safeParse(payload).success;

  const mutation = useMutation({
    mutationFn: () => create({ data: CreateEstimateSchema.parse(payload) }),
    onSuccess: (res) => {
      toast.success(
        res.lines_imported > 0
          ? `Estimate created with ${res.lines_imported} imported BOM lines.`
          : "Draft estimate created.",
      );
      void queryClient.invalidateQueries({ queryKey: ["estimating"] });
      setOpen(false);
      void navigate({ to: "/estimating/$id", params: { id: res.id } });
    },
    onError: (err) => toast.error(estimatingErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" /> New estimate
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New estimate</DialogTitle>
          <DialogDescription>
            Start blank, or import a BOM snapshot to seed the material lines.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="est-title">Title</Label>
            <Input
              id="est-title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="50 MW PV — EPC cost estimate"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="est-project">Project</Label>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setSnapshotId(NONE);
              }}
            >
              <SelectTrigger id="est-project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {register.projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ${p.name}` : p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="est-opp">Opportunity (optional)</Label>
              <Select value={opportunityId} onValueChange={setOpportunityId}>
                <SelectTrigger id="est-opp">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {register.opportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="est-currency">Currency</Label>
              <Input
                id="est-currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="font-mono uppercase"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="est-bom">BOM snapshot (optional)</Label>
            <Select value={snapshotId} onValueChange={setSnapshotId} disabled={!projectId}>
              <SelectTrigger id="est-bom">
                <SelectValue placeholder={projectId ? "Start blank" : "Pick a project first"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Start blank</SelectItem>
                {snapshots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <Layers className="size-3.5 text-muted-foreground" />v{s.version} ·{" "}
                      {formatDate(s.created_at)} · {s.status}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {snapshots.length > 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Released snapshots are preferred{" "}
                <StatusBadge status="released" className="align-middle" />
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            Create estimate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
