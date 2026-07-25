// P-056 — Scenarios table + toolbar.
import { useMemo, useState } from "react";
import { Copy, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { YieldScenarioRow } from "@/lib/yield.functions";
import {
  useDeleteYieldScenario,
  useDuplicateYieldScenario,
  useEstimateYieldScenario,
} from "@/lib/yield-query";
import { YieldScenarioDrawer } from "./yield-scenario-drawer";

const num = (v: unknown, digits = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";

const TRACKING_SHORT: Record<string, string> = {
  fixed: "Fixed",
  "1p_tracker": "1P",
  "2p_tracker": "2P",
};

export function YieldScenariosTable({
  projectId,
  scenarios,
  canWrite,
}: {
  projectId: string;
  scenarios: YieldScenarioRow[];
  canWrite: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<YieldScenarioRow | undefined>();
  const [dupTarget, setDupTarget] = useState<YieldScenarioRow | undefined>();
  const [dupName, setDupName] = useState("");
  const [delTarget, setDelTarget] = useState<YieldScenarioRow | undefined>();

  const estimate = useEstimateYieldScenario(projectId);
  const duplicate = useDuplicateYieldScenario(projectId);
  const del = useDeleteYieldScenario(projectId);

  const sorted = useMemo(
    () =>
      [...scenarios].sort((a, b) => {
        if (a.scenario_name === "Base") return -1;
        if (b.scenario_name === "Base") return 1;
        return a.scenario_name.localeCompare(b.scenario_name);
      }),
    [scenarios],
  );

  const openCreate = () => {
    setEditing(undefined);
    setDrawerOpen(true);
  };
  const openEdit = (s: YieldScenarioRow) => {
    setEditing(s);
    setDrawerOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Scenarios</CardTitle>
        <Button size="sm" onClick={openCreate} disabled={!canWrite}>
          <Plus className="mr-1 h-4 w-4" /> New scenario
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Create your first scenario.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Tilt°</TableHead>
                  <TableHead className="text-right">GCR</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead className="text-right">DC/AC</TableHead>
                  <TableHead className="text-right">P50 (MWh)</TableHead>
                  <TableHead className="text-right">P90 (MWh)</TableHead>
                  <TableHead className="text-right">Spec. yield</TableHead>
                  <TableHead className="text-right">PR%</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((s) => {
                  const p = (s.params ?? {}) as any;
                  const r = s.results ?? {};
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {s.scenario_name}
                          {r.imported ? (
                            <Badge variant="secondary">Imported</Badge>
                          ) : r.stub_version ? (
                            <Badge
                              variant="outline"
                              title="Preliminary estimate — replace with PVsyst import"
                            >
                              Estimate
                            </Badge>
                          ) : null}
                          {s.scenario_name === "Proposal" && (
                            <Badge variant="outline">Locked</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{num(p.tilt_deg, 0)}</TableCell>
                      <TableCell className="text-right">{num(p.gcr, 2)}</TableCell>
                      <TableCell>{TRACKING_SHORT[p.tracking] ?? "—"}</TableCell>
                      <TableCell className="text-right">{num(p.dc_ac_ratio, 2)}</TableCell>
                      <TableCell className="text-right">{num(r.p50_mwh, 0)}</TableCell>
                      <TableCell className="text-right">{num(r.p90_mwh, 0)}</TableCell>
                      <TableCell className="text-right">
                        {num(r.specific_yield_kwh_kwp, 0)}
                      </TableCell>
                      <TableCell className="text-right">{num(r.pr_pct, 1)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Row actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!canWrite || estimate.isPending}
                              onClick={() => estimate.mutate({ id: s.id })}
                            >
                              <Play className="mr-2 h-4 w-4" /> Run estimate
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!canWrite} onClick={() => openEdit(s)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canWrite}
                              onClick={() => {
                                setDupTarget(s);
                                setDupName(`${s.scenario_name} copy`);
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canWrite || s.scenario_name === "Proposal"}
                              onClick={() => setDelTarget(s)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Estimates are labelled <strong>Preliminary estimate — replace with PVsyst import</strong>.
        </p>
      </CardContent>

      <YieldScenarioDrawer
        projectId={projectId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        scenario={editing}
      />

      <Dialog open={!!dupTarget} onOpenChange={(v) => !v && setDupTarget(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate scenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New scenario name</Label>
            <Input value={dupName} onChange={(e) => setDupName(e.target.value)} maxLength={60} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupTarget(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!dupName.trim() || duplicate.isPending}
              onClick={() => {
                if (!dupTarget) return;
                duplicate.mutate(
                  { id: dupTarget.id, newName: dupName.trim() },
                  { onSuccess: () => setDupTarget(undefined) },
                );
              }}
            >
              {duplicate.isPending ? "Duplicating…" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTarget} onOpenChange={(v) => !v && setDelTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scenario?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{delTarget?.scenario_name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!delTarget) return;
                del.mutate({ id: delTarget.id }, { onSuccess: () => setDelTarget(undefined) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
