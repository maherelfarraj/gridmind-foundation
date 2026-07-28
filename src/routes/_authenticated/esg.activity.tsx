// P-216 — ESG activity data capture register.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  FileSpreadsheet,
  Fuel,
  Leaf,
  Paperclip,
  Pencil,
  Plus,
  Recycle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { CarbonTotalsCard } from "@/components/esg/carbon-totals-card";
import { CsvImportDialog } from "@/components/esg/csv-import-dialog";
import {
  ManualActivityDialog,
  type EditableActivity,
} from "@/components/esg/manual-activity-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  deleteEsgActivity,
  getEsgActivityAccess,
  importEquipmentFuel,
  importWasteActivities,
  listEsgActivities,
  listEsgFactors,
  signEsgEvidenceUrl,
} from "@/lib/esg/activity.functions";
import { computeEsgReport, getEsgReport } from "@/lib/esg/carbon.functions";
import type { ReportTotals } from "@/lib/esg/carbon";
import {
  currentMonthKey,
  ESG_CATEGORY_LABEL,
  ESG_SOURCE_LABEL,
  ESG_TAB_LABEL,
  ESG_TABS,
  formatQuantity,
  tabOfCategory,
  type EsgCategory,
  type EsgSource,
  type EsgTab,
  type ResolvedFactor,
} from "@/lib/esg/activity.rules";

export const Route = createFileRoute("/_authenticated/esg/activity")({
  head: () => ({
    meta: [
      { title: "ESG activity register — GridMind EPC" },
      {
        name: "description",
        content:
          "Monthly ESG activity capture: fuel, electricity, transport, materials and waste with evidence and auto-imports.",
      },
      { property: "og:title", content: "ESG activity register — GridMind EPC" },
      {
        property: "og:description",
        content: "Capture monthly ESG activity data with provenance, evidence and auto-imports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EsgActivityPage,
});

type ActivityRow = {
  id: string;
  act_number: string;
  category: EsgCategory;
  quantity: number;
  unit: string;
  source: EsgSource;
  evidence_path: string | null;
  notes: string | null;
  entered_by_name: string | null;
  created_at: string;
};

function EsgActivityPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [month, setMonth] = useState(currentMonthKey());
  const [tab, setTab] = useState<EsgTab>("fuel");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [editing, setEditing] = useState<EditableActivity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getEsgActivityAccess);
  const access = useQuery({ queryKey: ["esg", "access"], queryFn: () => accessFn() });

  const factorsFn = useServerFn(listEsgFactors);
  const factors = useQuery({
    queryKey: ["esg", "factors"],
    queryFn: () => factorsFn() as Promise<Record<string, ResolvedFactor>>,
  });

  const listFn = useServerFn(listEsgActivities);
  const listKey = ["esg", "activities", activeProject, month] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => listFn({ data: { projectId: activeProject, month } }) as Promise<ActivityRow[]>,
    enabled: Boolean(activeProject),
  });

  const periodFrom = `${month}-01`;
  const periodTo = firstOfNextMonthMinusDay(month);
  const reportFn = useServerFn(getEsgReport);
  const report = useQuery({
    queryKey: ["esg", "report", activeProject, month],
    queryFn: () =>
      reportFn({
        data: { project_id: activeProject, period_from: periodFrom, period_to: periodTo },
      }) as Promise<{ status: string; totals: ReportTotals; row_count: number } | null>,
    enabled: Boolean(activeProject),
  });
  const computeFn = useServerFn(computeEsgReport);

  const fuelFn = useServerFn(importEquipmentFuel);
  const wasteFn = useServerFn(importWasteActivities);
  const deleteFn = useServerFn(deleteEsgActivity);
  const signFn = useServerFn(signEsgEvidenceUrl);

  const rows = useMemo(
    () => (list.data ?? []).filter((r) => tabOfCategory(r.category) === tab),
    [list.data, tab],
  );

  const canManage = access.data?.canManage ?? false;
  const companyId = access.data?.companyId ?? "";
  const importsReady = access.data?.imports ?? { equipmentFuel: true, waste: true };

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["esg", "activities", activeProject, month] });
  }

  async function runImport(kind: "fuel" | "waste") {
    if (!activeProject) return;
    setBusy(kind);
    try {
      const res = (await (kind === "fuel" ? fuelFn : wasteFn)({
        data: { projectId: activeProject, month },
      })) as { created: number; skipped: number };
      toast.success(
        `${kind === "fuel" ? "Equipment fuel" : "Waste"} import — ${res.created} created, ${res.skipped} skipped`,
      );
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function computeReport() {
    if (!activeProject) return;
    setBusy("report");
    try {
      await computeFn({
        data: { project_id: activeProject, period_from: periodFrom, period_to: periodTo },
      });
      toast.success("Carbon report recomputed");
      void qc.invalidateQueries({ queryKey: ["esg", "report", activeProject, month] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function openEvidence(path: string) {
    try {
      const res = (await signFn({ data: { path } })) as { url: string };
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function removeRow(id: string) {
    setBusy(id);
    try {
      await deleteFn({ data: { id } });
      toast.success("Activity deleted");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="ESG activity register"
        description="Monthly activity data by category, with provenance for every imported row."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <ImportButton
                label="Import fuel"
                icon={Fuel}
                enabled={importsReady.equipmentFuel && Boolean(activeProject)}
                disabledHint="Equipment records are not available in this workspace"
                busy={busy === "fuel"}
                onClick={() => void runImport("fuel")}
              />
              <ImportButton
                label="Import waste"
                icon={Recycle}
                enabled={importsReady.waste && Boolean(activeProject)}
                disabledHint="Waste tracking is not available in this workspace"
                busy={busy === "waste"}
                onClick={() => void runImport("waste")}
              />
              <Button variant="outline" disabled={!activeProject} onClick={() => setCsvOpen(true)}>
                <FileSpreadsheet className="size-4" aria-hidden /> CSV paste
              </Button>
              <Button
                disabled={!activeProject}
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden /> Record activity
              </Button>
            </div>
          ) : null
        }
      />

      <CarbonTotalsCard
        totals={report.data?.totals ?? null}
        rowCount={report.data?.row_count ?? 0}
        status={report.data?.status}
        busy={busy === "report"}
        canCompute={canManage && Boolean(activeProject)}
        onCompute={() => void computeReport()}
      />

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle className="text-base font-semibold">Period</CardTitle>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="esg-project">Project</Label>
              <Select value={activeProject} onValueChange={setProjectId}>
                <SelectTrigger id="esg-project" className="w-64">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {(projects.data ?? []).map((p: { id: string; name: string }) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="esg-month">Month</Label>
              <Input
                id="esg-month"
                type="month"
                className="w-44"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonthKey())}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as EsgTab)}>
            <TabsList>
              {ESG_TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {ESG_TAB_LABEL[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {list.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <EmptyState
              icon={Leaf}
              title="Could not load the activity register"
              description={errorMessage(list.error)}
              action={
                <Button variant="outline" onClick={() => void list.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Leaf}
              title={`No ${ESG_TAB_LABEL[tab].toLowerCase()} activity for ${month}`}
              description="Record an entry manually or run an import to populate this month."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Entered by</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.act_number}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ESG_CATEGORY_LABEL[row.category]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(Number(row.quantity))} {row.unit}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.source === "manual" ? "outline" : "secondary"}>
                        {ESG_SOURCE_LABEL[row.source] ?? row.source}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.evidence_path ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openEvidence(row.evidence_path!)}
                        >
                          <Paperclip className="size-4" aria-hidden />
                          <span className="sr-only">View evidence</span>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{row.entered_by_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                        new Date(row.created_at),
                      )}
                    </TableCell>
                    <TableCell>
                      {canManage && row.source === "manual" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing({
                                id: row.id,
                                category: row.category,
                                quantity: Number(row.quantity),
                                unit: row.unit,
                                notes: row.notes,
                              });
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy === row.id}
                            onClick={() => void removeRow(row.id)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ManualActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={activeProject}
        companyId={companyId}
        month={month}
        factors={factors.data ?? {}}
        editing={editing}
        onSaved={refresh}
      />
      <CsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        projectId={activeProject}
        onImported={refresh}
      />
    </div>
  );
}

function firstOfNextMonthMinusDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0));
  return end.toISOString().slice(0, 10);
}

function ImportButton({
  label,
  icon: Icon,
  enabled,
  disabledHint,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Fuel;
  enabled: boolean;
  disabledHint: string;
  busy: boolean;
  onClick: () => void;
}) {
  const button = (
    <Button variant="outline" disabled={!enabled || busy} onClick={onClick}>
      <Icon className="size-4" aria-hidden /> {label}
    </Button>
  );
  if (enabled) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledHint}</TooltipContent>
    </Tooltip>
  );
}
