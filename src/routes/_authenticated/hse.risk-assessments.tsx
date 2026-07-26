// P-185 — Risk assessment register with a 5×5 matrix hazard editor.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister, RiskBadge } from "@/components/hse/hse-ext-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  activateRiskAssessment,
  createRiskAssessment,
  getHseExtAccess,
  listRiskAssessments,
} from "@/lib/hse-ext.functions";
import { residualScore, riskScore, type Hazard } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/risk-assessments")({
  head: () => ({
    meta: [
      { title: "Risk assessments — GridMind EPC" },
      {
        name: "description",
        content: "5×5 risk assessments with hazard registers, controls and residual risk scoring.",
      },
      { property: "og:title", content: "Risk assessments — GridMind EPC" },
      {
        property: "og:description",
        content: "Hazard register, controls and residual risk, approved before work starts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RiskAssessmentsPage,
});

type RaRow = {
  id: string;
  ra_number: string;
  title: string;
  activity: string;
  status: string;
  review_date: string | null;
  hazards: Hazard[] | null;
};

const emptyHazard = (): Hazard => ({
  hazard: "",
  likelihood: 3,
  severity: 3,
  controls: "",
  residual_likelihood: 2,
  residual_severity: 2,
});

function RiskAssessmentsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [activity, setActivity] = useState("");
  const [hazards, setHazards] = useState<Hazard[]>([emptyHazard()]);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getHseExtAccess);
  const access = useQuery({ queryKey: ["hse-ext-access"], queryFn: () => accessFn() });
  const canManage = access.data?.canManage ?? false;

  const listFn = useServerFn(listRiskAssessments);
  const key = ["hse", "risk-assessments", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<RaRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(createRiskAssessment);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          title: title.trim(),
          activity: activity.trim(),
          hazards: hazards.filter((h) => h.hazard.trim().length > 0),
        },
      }),
    onSuccess: () => {
      toast.success("Risk assessment created");
      setTitle("");
      setActivity("");
      setHazards([emptyHazard()]);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const activateFn = useServerFn(activateRiskAssessment);
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
      [r.ra_number, r.title, r.activity].some((v) => (v ?? "").toLowerCase().includes(term)),
    );
  }, [list.data, search]);

  const patchHazard = (i: number, patch: Partial<Hazard>) =>
    setHazards((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));

  return (
    <div className="page-shell">
      <PageHeader
        title="Risk assessments"
        description="Hazard registers scored on a 5×5 matrix, with controls and residual risk."
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">New risk assessment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ra-title">Title</Label>
                <Input id="ra-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ra-activity">Activity</Label>
                <Input
                  id="ra-activity"
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Hazards (likelihood × severity)</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHazards((p) => [...p, emptyHazard()])}
                >
                  <Plus size={14} aria-hidden /> Add hazard
                </Button>
              </div>
              {hazards.map((h, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[2fr_repeat(4,72px)_2fr_auto]"
                >
                  <Input
                    aria-label="Hazard"
                    placeholder="Hazard"
                    value={h.hazard}
                    onChange={(e) => patchHazard(i, { hazard: e.target.value })}
                  />
                  <MatrixInput
                    label="L"
                    value={h.likelihood}
                    onChange={(v) => patchHazard(i, { likelihood: v })}
                  />
                  <MatrixInput
                    label="S"
                    value={h.severity}
                    onChange={(v) => patchHazard(i, { severity: v })}
                  />
                  <MatrixInput
                    label="rL"
                    value={h.residual_likelihood ?? h.likelihood}
                    onChange={(v) => patchHazard(i, { residual_likelihood: v })}
                  />
                  <MatrixInput
                    label="rS"
                    value={h.residual_severity ?? h.severity}
                    onChange={(v) => patchHazard(i, { residual_severity: v })}
                  />
                  <Input
                    aria-label="Controls"
                    placeholder="Controls"
                    value={h.controls ?? ""}
                    onChange={(e) => patchHazard(i, { controls: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <RiskBadge score={residualScore(h)} />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove hazard"
                      onClick={() => setHazards((p) => p.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 size={14} aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <Button
              size="sm"
              disabled={!activeProject || !title.trim() || !activity.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={14} aria-hidden /> Create
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <HseRegister
        title="Register"
        icon={ShieldAlert}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="risk-assessments.csv"
            headers={["Number", "Title", "Activity", "Status", "Worst residual"]}
            rows={rows.map((r) => [
              r.ra_number,
              r.title,
              r.activity,
              r.status,
              Math.max(0, ...(r.hazards ?? []).map(residualScore)),
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No risk assessments"
        emptyDescription="Create the first risk assessment for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Hazards</TableHead>
              <TableHead>Worst residual</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const hs = r.hazards ?? [];
              const worst = hs.length ? Math.max(...hs.map(residualScore)) : 0;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.ra_number}</TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.activity}</TableCell>
                  <TableCell className="tabular-nums">{hs.length}</TableCell>
                  <TableCell>{worst ? <RiskBadge score={worst} /> : "—"}</TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}

function MatrixInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={1}
        max={5}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
        className="tabular-nums"
      />
      <span className="sr-only">{riskScore(value, value)}</span>
    </div>
  );
}
