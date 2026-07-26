// P-183 — ITP register + per-ITP step runner (hold points lock work until signed).
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Lock, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { Badge } from "@/components/ui/badge";
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
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  addItpStep,
  createItp,
  getQualityAccess,
  listItps,
  listItpSteps,
  signOffItpStep,
  updateItp,
} from "@/lib/quality.functions";
import {
  ITP_POINT_TYPE_LABELS,
  ITP_POINT_TYPES,
  ITP_STATUSES,
  type ItpPointType,
} from "@/lib/quality.rules";

export const Route = createFileRoute("/_authenticated/quality/itp")({
  head: () => ({
    meta: [
      { title: "Inspection & test plans — GridMind EPC" },
      {
        name: "description",
        content:
          "ITP register with hold, witness, review and surveillance points and step sign-off.",
      },
      { property: "og:title", content: "Inspection & test plans — GridMind EPC" },
      {
        property: "og:description",
        content: "Run inspection and test plans with enforced hold-point sign-off.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItpPage,
});

type ItpRow = {
  id: string;
  itp_number: string;
  title: string;
  discipline: string;
  revision: string;
  status: string;
};

type StepRow = {
  id: string;
  seq: number;
  description: string;
  point_type: ItpPointType;
  status: string;
  signoff_role: string | null;
  signed_off_at: string | null;
};

function ItpPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState("general");
  const [selected, setSelected] = useState("");
  const [stepText, setStepText] = useState("");
  const [pointType, setPointType] = useState<ItpPointType>("review");
  const [signoffRole, setSignoffRole] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getQualityAccess);
  const access = useQuery({ queryKey: ["quality-access"], queryFn: () => accessFn() });
  const canWritePlans = access.data?.canWritePlans ?? false;

  const listFn = useServerFn(listItps);
  const key = ["itps", activeProject] as const;
  const itps = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<ItpRow[]>,
    enabled: Boolean(activeProject),
  });

  const activeItp = selected || (itps.data?.[0]?.id ?? "");
  const stepsFn = useServerFn(listItpSteps);
  const stepsKey = ["itp-steps", activeItp] as const;
  const steps = useQuery({
    queryKey: stepsKey,
    queryFn: () => stepsFn({ data: { itpId: activeItp } }) as Promise<StepRow[]>,
    enabled: Boolean(activeItp),
  });

  const createFn = useServerFn(createItp);
  const create = useMutation({
    mutationFn: () =>
      createFn({ data: { projectId: activeProject, title: title.trim(), discipline } }),
    onSuccess: () => {
      toast.success("ITP created");
      setTitle("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateFn = useServerFn(updateItp);
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      updateFn({ data: { id: v.id, status: v.status as never } }),
    onSuccess: () => {
      toast.success("ITP updated");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const addStepFn = useServerFn(addItpStep);
  const addStep = useMutation({
    mutationFn: () =>
      addStepFn({
        data: {
          itpId: activeItp,
          seq: (steps.data?.length ?? 0) + 1,
          description: stepText.trim(),
          pointType,
          signoffRole: signoffRole.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Step added");
      setStepText("");
      setSignoffRole("");
      void qc.invalidateQueries({ queryKey: stepsKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const signFn = useServerFn(signOffItpStep);
  const sign = useMutation({
    mutationFn: (v: { stepId: string; status: "signed_off" | "waived" | "failed" }) =>
      signFn({ data: v }),
    onSuccess: () => {
      toast.success("Step sign-off recorded");
      void qc.invalidateQueries({ queryKey: stepsKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inspection & test plans"
        description="Hold, witness, review and surveillance points — hold points block work until signed."
      />
      <ProjectSelect
        projects={projects.data ?? []}
        value={activeProject}
        onChange={(v) => {
          setProjectId(v);
          setSelected("");
        }}
        loading={projects.isLoading}
      />

      {canWritePlans ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New ITP</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="itp-title">Title</Label>
              <Input
                id="itp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="MV cable pulling & termination"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="itp-discipline">Discipline</Label>
              <Input
                id="itp-discipline"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
              />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={!activeProject || !title.trim() || create.isPending}
            >
              <Plus className="mr-1 size-4" /> Create
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          <PanelState
            isLoading={itps.isLoading}
            isError={itps.isError}
            onRetry={() => void itps.refetch()}
            isEmpty={(itps.data?.length ?? 0) === 0}
            emptyIcon={ClipboardList}
            emptyTitle="No inspection & test plans yet"
            emptyDescription="Create the first ITP for this project to start recording inspection points."
          >
            <ul className="divide-y divide-border">
              {(itps.data ?? []).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelected(row.id)}
                  >
                    <span className="font-medium text-foreground">{row.itp_number}</span>{" "}
                    <span className="text-muted-foreground">{row.title}</span>
                  </button>
                  <Badge variant="outline">{row.discipline}</Badge>
                  <Badge variant="outline">{row.revision}</Badge>
                  {canWritePlans ? (
                    <Select
                      value={row.status}
                      onValueChange={(v) => setStatus.mutate({ id: row.id, status: v })}
                    >
                      <SelectTrigger className="w-36" aria-label={`Status of ${row.itp_number}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITP_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge>{row.status}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </PanelState>
        </CardContent>
      </Card>

      {activeItp ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step runner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PanelState
              isLoading={steps.isLoading}
              isError={steps.isError}
              onRetry={() => void steps.refetch()}
              isEmpty={(steps.data?.length ?? 0) === 0}
              emptyIcon={ShieldCheck}
              emptyTitle="No steps yet"
              emptyDescription="Add inspection points in execution order."
            >
              <ol className="divide-y divide-border">
                {(steps.data ?? []).map((s) => {
                  const locked = s.point_type === "hold" && s.status !== "signed_off";
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="w-8 text-sm text-muted-foreground">{s.seq}</span>
                      {locked ? (
                        <Lock className="size-4 text-destructive" aria-label="Hold point locked" />
                      ) : null}
                      <span className="min-w-0 flex-1">{s.description}</span>
                      <Badge variant={s.point_type === "hold" ? "destructive" : "outline"}>
                        {ITP_POINT_TYPE_LABELS[s.point_type]}
                      </Badge>
                      <Badge variant={s.status === "signed_off" ? "default" : "secondary"}>
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                      {s.signoff_role ? (
                        <span className="text-xs text-muted-foreground">{s.signoff_role}</span>
                      ) : null}
                      {s.status !== "signed_off" ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => sign.mutate({ stepId: s.id, status: "signed_off" })}
                            disabled={sign.isPending}
                          >
                            Sign off
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sign.mutate({ stepId: s.id, status: "failed" })}
                            disabled={sign.isPending}
                          >
                            Fail
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </PanelState>

            {canWritePlans ? (
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="step-desc">Step</Label>
                  <Input
                    id="step-desc"
                    value={stepText}
                    onChange={(e) => setStepText(e.target.value)}
                    placeholder="Insulation resistance test witnessed"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="step-type">Point type</Label>
                  <Select
                    value={pointType}
                    onValueChange={(v) => setPointType(v as ItpPointType)}
                  >
                    <SelectTrigger id="step-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITP_POINT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ITP_POINT_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="step-role">Sign-off role</Label>
                  <Input
                    id="step-role"
                    value={signoffRole}
                    onChange={(e) => setSignoffRole(e.target.value)}
                    placeholder="construction_admin"
                  />
                </div>
                <Button
                  onClick={() => addStep.mutate()}
                  disabled={!stepText.trim() || addStep.isPending}
                >
                  <Plus className="mr-1 size-4" /> Add step
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
