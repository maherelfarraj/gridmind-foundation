// P-181 — Work fronts list + crew allocation grid by date.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardHat, Minus, Plus } from "lucide-react";
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
import { errorMessage } from "@/lib/dpr-query";
import { listControlsProjects } from "@/lib/controls.functions";
import {
  getFieldAccess,
  listWorkFronts,
  setCrewAssignment,
  upsertWorkFront,
} from "@/lib/field-exec.functions";
import { crewHeadcountByFront, FIELD_DISCIPLINES, type CrewLike } from "@/lib/field-exec.rules";
import { TRADES, TRADE_LABELS, type Trade } from "@/lib/dpr.rules";

export const Route = createFileRoute("/_authenticated/field/work-fronts")({
  head: () => ({
    meta: [
      { title: "Work fronts & crew — GridMind EPC" },
      {
        name: "description",
        content: "Define construction work fronts and allocate crews by trade and date.",
      },
      { property: "og:title", content: "Work fronts & crew — GridMind EPC" },
      {
        property: "og:description",
        content: "Field work fronts with a daily crew allocation grid by trade.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkFrontsPage,
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function WorkFrontsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(today());
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [discipline, setDiscipline] = useState<(typeof FIELD_DISCIPLINES)[number]>("general");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getFieldAccess);
  const access = useQuery({ queryKey: ["field-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWrite ?? false;

  const listFn = useServerFn(listWorkFronts);
  const key = ["work-fronts", activeProject] as const;
  const data = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }),
    enabled: Boolean(activeProject),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(upsertWorkFront);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          name: name.trim(),
          area: area.trim() || null,
          discipline,
          isActive: true,
        },
      }),
    onSuccess: () => {
      toast.success("Work front created");
      setName("");
      setArea("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const crewFn = useServerFn(setCrewAssignment);
  const setCrew = useMutation({
    mutationFn: (v: { workFrontId: string; trade: Trade; headcount: number }) =>
      crewFn({
        data: {
          workFrontId: v.workFrontId,
          assignmentDate: date,
          trade: v.trade,
          headcount: v.headcount,
        },
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const fronts = data.data?.fronts ?? [];
  const crew = useMemo(() => data.data?.crew ?? [], [data.data]);
  const totals = useMemo(
    () => crewHeadcountByFront(crew as unknown as CrewLike[], date),
    [crew, date],
  );

  const headcountFor = (frontId: string, trade: Trade) =>
    crew.find((c) => c.work_front_id === frontId && c.assignment_date === date && c.trade === trade)
      ?.headcount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work fronts & crew"
        description="Define where work happens, then allocate crews by trade for each day."
      />

      <div className="flex flex-wrap items-end gap-3">
        <ProjectSelect
          projects={projects.data ?? []}
          value={activeProject}
          onChange={setProjectId}
          loading={projects.isLoading}
        />
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="crew-date" className="text-xs text-muted-foreground">
            Allocation date
          </Label>
          <Input
            id="crew-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || today())}
          />
        </div>
      </div>

      {canWrite && activeProject ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">New work front</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Block A — tracker rows 1–40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wf-area">Area</Label>
              <Input id="wf-area" value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wf-disc">Discipline</Label>
              <Select
                value={discipline}
                onValueChange={(v) => setDiscipline(v as (typeof FIELD_DISCIPLINES)[number])}
              >
                <SelectTrigger id="wf-disc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d} className="capitalize">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-4">
              <Button
                type="button"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden /> Add work front
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PanelState
        isLoading={data.isLoading}
        isError={data.isError}
        onRetry={() => data.refetch()}
        isEmpty={fronts.length === 0}
        emptyTitle="No work fronts yet"
        emptyDescription="Create a work front to start allocating crews."
        emptyIcon={HardHat}
      >
        <div className="flex flex-col gap-3">
          {fronts.map((f) => (
            <Card key={f.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span className="min-w-0 truncate">
                    {f.name}
                    {f.area ? <span className="text-muted-foreground"> · {f.area}</span> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {f.discipline}
                    </Badge>
                    <Badge variant="secondary">{totals[f.id] ?? 0} crew</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {TRADES.map((trade) => {
                    const value = Number(headcountFor(f.id, trade));
                    return (
                      <li
                        key={trade}
                        className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                      >
                        <span className="text-sm text-foreground">{TRADE_LABELS[trade]}</span>
                        <span className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={!canWrite || value <= 0 || setCrew.isPending}
                            aria-label={`Decrease ${TRADE_LABELS[trade]} on ${f.name}`}
                            onClick={() =>
                              setCrew.mutate({
                                workFrontId: f.id,
                                trade,
                                headcount: Math.max(0, value - 1),
                              })
                            }
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                          <span className="w-8 text-center text-sm tabular-nums">{value}</span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={!canWrite || setCrew.isPending}
                            aria-label={`Increase ${TRADE_LABELS[trade]} on ${f.name}`}
                            onClick={() =>
                              setCrew.mutate({
                                workFrontId: f.id,
                                trade,
                                headcount: value + 1,
                              })
                            }
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </PanelState>
    </div>
  );
}
