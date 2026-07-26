// P-185 — Job safety analysis register (task steps, hazards, controls).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister } from "@/components/hse/hse-ext-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  activateJsa,
  createJsa,
  getHseExtAccess,
  listJsas,
  listRiskAssessments,
} from "@/lib/hse-ext.functions";

export const Route = createFileRoute("/_authenticated/hse/jsa")({
  head: () => ({
    meta: [
      { title: "Job safety analyses — GridMind EPC" },
      {
        name: "description",
        content: "Step-by-step job safety analyses linked to the governing risk assessment.",
      },
      { property: "og:title", content: "Job safety analyses — GridMind EPC" },
      {
        property: "og:description",
        content: "Task steps, hazards, controls and responsible parties before work starts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JsaPage,
});

type JsaStep = {
  step: string;
  hazards?: string | null;
  controls?: string | null;
  responsible?: string | null;
};
type JsaRow = {
  id: string;
  jsa_number: string;
  task: string;
  status: string;
  steps: JsaStep[] | null;
  risk_assessment_id: string | null;
};
type RaLite = { id: string; ra_number: string; title: string };

const emptyStep = (): JsaStep => ({ step: "", hazards: "", controls: "", responsible: "" });

function JsaPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("");
  const [raId, setRaId] = useState("");
  const [steps, setSteps] = useState<JsaStep[]>([emptyStep()]);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getHseExtAccess);
  const access = useQuery({ queryKey: ["hse-ext-access"], queryFn: () => accessFn() });
  const canManage = access.data?.canManage ?? false;

  const raFn = useServerFn(listRiskAssessments);
  const ras = useQuery({
    queryKey: ["hse", "risk-assessments", activeProject],
    queryFn: () => raFn({ data: { projectId: activeProject } }) as Promise<RaLite[]>,
    enabled: Boolean(activeProject),
  });

  const listFn = useServerFn(listJsas);
  const key = ["hse", "jsa", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<JsaRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(createJsa);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          task: task.trim(),
          riskAssessmentId: raId || null,
          steps: steps.filter((s) => s.step.trim().length > 0),
        },
      }),
    onSuccess: () => {
      toast.success("JSA created");
      setTask("");
      setSteps([emptyStep()]);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const activateFn = useServerFn(activateJsa);
  const activate = useMutation({
    mutationFn: (id: string) => activateFn({ data: { id } }),
    onSuccess: (r: { approvalInstanceId?: string | null }) => {
      toast.success(r?.approvalInstanceId ? "Sent for approval" : "Activated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) =>
      [r.jsa_number, r.task].some((v) => (v ?? "").toLowerCase().includes(term)),
    );
  }, [list.data, search]);

  const patchStep = (i: number, patch: Partial<JsaStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <div className="page-shell">
      <PageHeader
        title="Job safety analyses"
        description="Break the task into steps, name the hazard, name the control."
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">New JSA</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="jsa-task">Task</Label>
                <Input id="jsa-task" value={task} onChange={(e) => setTask(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Risk assessment</Label>
                <Select value={raId} onValueChange={setRaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {(ras.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.ra_number} — {r.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Steps</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSteps((p) => [...p, emptyStep()])}
                >
                  <Plus size={14} aria-hidden /> Add step
                </Button>
              </div>
              {steps.map((s, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[2fr_2fr_2fr_1fr_auto]"
                >
                  <Input
                    aria-label="Step"
                    placeholder="Step"
                    value={s.step}
                    onChange={(e) => patchStep(i, { step: e.target.value })}
                  />
                  <Input
                    aria-label="Hazards"
                    placeholder="Hazards"
                    value={s.hazards ?? ""}
                    onChange={(e) => patchStep(i, { hazards: e.target.value })}
                  />
                  <Input
                    aria-label="Controls"
                    placeholder="Controls"
                    value={s.controls ?? ""}
                    onChange={(e) => patchStep(i, { controls: e.target.value })}
                  />
                  <Input
                    aria-label="Responsible"
                    placeholder="Responsible"
                    value={s.responsible ?? ""}
                    onChange={(e) => patchStep(i, { responsible: e.target.value })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove step"
                    onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              size="sm"
              disabled={!activeProject || !task.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={14} aria-hidden /> Create
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <HseRegister
        title="Register"
        icon={ClipboardList}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="jsa.csv"
            headers={["Number", "Task", "Steps", "Status"]}
            rows={rows.map((r) => [r.jsa_number, r.task, (r.steps ?? []).length, r.status])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No JSAs"
        emptyDescription="Create the first job safety analysis for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.jsa_number}</TableCell>
                <TableCell>{r.task}</TableCell>
                <TableCell className="tabular-nums">{(r.steps ?? []).length}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell className="text-right">
                  {canManage && r.status === "draft" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activate.isPending}
                      onClick={() => activate.mutate(r.id)}
                    >
                      Activate
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
