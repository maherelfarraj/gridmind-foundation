// P-180 — CWP kanban board with drag-drop status changes and a detail drawer.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HardHat, KanbanSquare } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import {
  getControlsAccess,
  getCwpBoard,
  getWorkPackageDetail,
  listControlsProjects,
  setWorkPackageStatus,
  type CwpCardRow,
} from "@/lib/controls.functions";
import { CWP_STATUSES, type CwpStatus } from "@/lib/cwp.rules";
import { typedErrorMessage } from "@/lib/typed-error";


export const Route = createFileRoute("/_authenticated/construction/cwp")({
  head: () => ({
    meta: [
      { title: "Construction work packages · GridMind EPC" },
      {
        name: "description",
        content:
          "Kanban board of construction work packages by status, with progress, WBS links and planned dates.",
      },
      { property: "og:title", content: "Construction work packages · GridMind EPC" },
      {
        property: "og:description",
        content: "Plan, sequence and track construction work packages across disciplines and areas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CwpBoardPage,
});

const STATUS_LABEL: Record<CwpStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

function CwpBoardPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [discipline, setDiscipline] = useState("all");
  const [area, setArea] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getControlsAccess);
  const access = useQuery({ queryKey: ["controls-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWrite ?? false;

  const boardFn = useServerFn(getCwpBoard);
  const boardKey = ["cwp-board", activeProject] as const;
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => boardFn({ data: { projectId: activeProject } }),
    enabled: Boolean(activeProject),
  });

  const statusFn = useServerFn(setWorkPackageStatus);
  const move = useMutation({
    mutationFn: (v: { id: string; status: CwpStatus }) => statusFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: boardKey });
      const prev = qc.getQueryData<CwpCardRow[]>(boardKey);
      qc.setQueryData<CwpCardRow[]>(boardKey, (rows) =>
        (rows ?? []).map((r) => (r.id === v.id ? { ...r, status: v.status } : r)),
      );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(boardKey, ctx.prev);
      toast.error(typedErrorMessage(e, "Status change failed — reverted"));
    },

    onSuccess: (_d, v) => toast.success(`Moved to ${STATUS_LABEL[v.status]}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: boardKey }),
  });

  const rows = board.data ?? [];
  const disciplines = useMemo(
    () => [...new Set(rows.map((r) => r.discipline).filter(Boolean))].sort(),
    [rows],
  );
  const areas = useMemo(
    () => [...new Set(rows.map((r) => r.area).filter((a): a is string => Boolean(a)))].sort(),
    [rows],
  );
  const filtered = rows.filter(
    (r) =>
      (discipline === "all" || r.discipline === discipline) &&
      (area === "all" || r.area === area),
  );

  const detailFn = useServerFn(getWorkPackageDetail);
  const detail = useQuery({
    queryKey: ["cwp-detail", openId],
    queryFn: () => detailFn({ data: { id: openId! } }),
    enabled: Boolean(openId),
  });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Construction work packages"
        description="Sequence delivery by status, discipline and area. Drag a card to change status."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ProjectSelect
          projects={projects.data ?? []}
          value={activeProject}
          onChange={setProjectId}
          loading={projects.isLoading}
        />
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="cwp-discipline" className="text-xs text-muted-foreground">
            Discipline
          </Label>
          <Select value={discipline} onValueChange={setDiscipline}>
            <SelectTrigger id="cwp-discipline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All disciplines</SelectItem>
              {disciplines.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="cwp-area" className="text-xs text-muted-foreground">
            Area
          </Label>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger id="cwp-area">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              {areas.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <PanelState
        isLoading={board.isLoading || projects.isLoading}
        isError={board.isError}
        onRetry={() => void board.refetch()}
        isEmpty={Boolean(activeProject) && filtered.length === 0}
        emptyIcon={HardHat}
        emptyTitle="No work packages"
        emptyDescription="Create construction work packages to start planning delivery for this project."
        skeletonRows={5}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CWP_STATUSES.map((status) => {
            const cards = filtered.filter((r) => r.status === status);
            return (
              <section
                key={status}
                aria-label={STATUS_LABEL[status]}
                onDragOver={(e) => {
                  if (canWrite && dragId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!canWrite || !dragId) return;
                  const card = rows.find((r) => r.id === dragId);
                  setDragId(null);
                  if (!card || card.status === status) return;
                  move.mutate({ id: dragId, status });
                }}
                className="flex min-h-40 flex-col gap-2 rounded-md border border-border bg-card/50 p-3"
              >
                <header className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-foreground">{STATUS_LABEL[status]}</h2>
                  <Badge variant="outline">{cards.length}</Badge>
                </header>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    draggable={canWrite}
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setOpenId(c.id)}
                    className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {c.cwp_number}
                      </span>
                      {c.wbs?.code ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {c.wbs.code}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.discipline}
                      {c.area ? ` · ${c.area}` : ""}
                    </p>
                    <Progress value={Number(c.progress_pct ?? 0)} className="mt-2 h-1.5" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {Number(c.progress_pct ?? 0).toFixed(0)}% ·{" "}
                      {c.planned_start ?? "—"} → {c.planned_end ?? "—"}
                    </p>
                  </button>
                ))}
                {cards.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Drop packages here</p>
                ) : null}
              </section>
            );
          })}
        </div>
      </PanelState>

      <Sheet open={Boolean(openId)} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{detail.data?.cwp?.cwp_number ?? "Work package"}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 p-4">
            <PanelState
              isLoading={detail.isLoading}
              isError={detail.isError}
              onRetry={() => void detail.refetch()}
              isEmpty={!detail.isLoading && !detail.data?.cwp}
              emptyIcon={KanbanSquare}
              emptyTitle="Work package not found"
              skeletonRows={3}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{detail.data?.cwp?.title}</p>
                <p className="text-sm text-muted-foreground">
                  {detail.data?.cwp?.description || "No description."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Weight</p>
                  <p className="text-foreground">{Number(detail.data?.cwp?.weight ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Progress</p>
                  <p className="text-foreground">
                    {Number(detail.data?.cwp?.progress_pct ?? 0).toFixed(1)}%
                  </p>
                </div>
              </div>
              <Separator />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Linked schedule tasks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(detail.data?.tasks ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks linked.</p>
                  ) : (
                    (detail.data?.tasks ?? []).map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-foreground">{t.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t.start_date} → {t.end_date}
                          {t.is_critical ? " · CP" : ""}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Progress history</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(detail.data?.history ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recorded changes yet.</p>
                  ) : (
                    (detail.data?.history ?? []).map((h) => (
                      <div key={h.id} className="text-xs">
                        <p className="text-foreground">{h.action}</p>
                        <p className="truncate text-muted-foreground">
                          {new Date(h.created_at).toLocaleString()} · {h.detail}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </PanelState>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
