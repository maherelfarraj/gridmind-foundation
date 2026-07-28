// P-180 — Weekly rolling look-ahead editor (Monday-only weeks, publish locks).
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarRange, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
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
import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { getControlsAccess, getCwpBoard, listControlsProjects } from "@/lib/controls.functions";
import {
  getLookAheadPlan,
  setLookAheadStatus,
  upsertLookAheadPlan,
} from "@/lib/cwp.functions";
import { isMonday } from "@/lib/cwp.rules";
import { mondayOf } from "@/lib/controls.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/construction/look-ahead")({
  head: () => ({
    meta: [
      { title: "Look-ahead planning · GridMind EPC" },
      {
        name: "description",
        content:
          "Weekly rolling look-ahead: crews, constraints and daily commitments per construction work package.",
      },
      { property: "og:title", content: "Look-ahead planning · GridMind EPC" },
      {
        property: "og:description",
        content: "Plan the next weeks of construction with crew sizes and constraint tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LookAheadPage,
});

const CONSTRAINT_CHIPS = [
  "no permit",
  "material shortage",
  "no drawing",
  "access blocked",
  "equipment",
  "manpower",
] as const;

interface EntryRow {
  cwp_id: string | null;
  schedule_task_id: string | null;
  day: string;
  crew_size: number;
  constraints: string[];
  notes: string | null;
}

function LookAheadPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [notes, setNotes] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getControlsAccess);
  const access = useQuery({ queryKey: ["controls-access"], queryFn: () => accessFn() });

  const cwpFn = useServerFn(getCwpBoard);
  const cwps = useQuery({
    queryKey: ["cwp-board", activeProject],
    queryFn: () => cwpFn({ data: { projectId: activeProject } }),
    enabled: Boolean(activeProject),
  });

  const planFn = useServerFn(getLookAheadPlan);
  const planKey = ["look-ahead", activeProject, weekStart] as const;
  const validWeek = isMonday(weekStart);
  const plan = useQuery({
    queryKey: planKey,
    queryFn: () => planFn({ data: { projectId: activeProject, weekStart } }),
    enabled: Boolean(activeProject) && validWeek,
  });

  const locked = plan.data?.status === "published" || plan.data?.status === "locked";
  const canEdit = (access.data?.canWrite ?? false) && !locked;

  useEffect(() => {
    const raw = plan.data?.entries;
    setEntries(Array.isArray(raw) ? (raw as unknown as EntryRow[]) : []);
    setNotes(plan.data?.notes ?? "");
  }, [plan.data]);

  const days = useMemo(() => {
    if (!validWeek) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${weekStart}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [weekStart, validWeek]);

  const saveFn = useServerFn(upsertLookAheadPlan);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          projectId: activeProject,
          weekStart,
          entries: entries as never,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("adminMod.construction.lookAhead.saved"));
      void qc.invalidateQueries({ queryKey: planKey });
    },
    onError: () => toast.error(t("adminMod.construction.lookAhead.saveFailed")),
  });

  const publishFn = useServerFn(setLookAheadStatus);
  const publish = useMutation({
    mutationFn: () => publishFn({ data: { id: plan.data!.id, status: "published" } }),
    onSuccess: () => {
      toast.success(t("adminMod.construction.lookAhead.published"));
      void qc.invalidateQueries({ queryKey: planKey });
    },
    onError: () => toast.error(t("adminMod.construction.lookAhead.publishFailed")),
  });

  const update = (i: number, patch: Partial<EntryRow>) =>
    setEntries((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title={t("adminMod.construction.lookAhead.title")}
        description={t("adminMod.construction.lookAhead.description")}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || save.isPending}
              onClick={() => save.mutate()}
            >
              {t("adminMod.construction.lookAhead.saveDraft")}
            </Button>
            <Button
              size="sm"
              disabled={!plan.data || locked || publish.isPending || !access.data?.canWrite}
              onClick={() => publish.mutate()}
            >
              {t("adminMod.construction.lookAhead.publish")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ProjectSelect
          projects={projects.data ?? []}
          value={activeProject}
          onChange={setProjectId}
          loading={projects.isLoading}
        />
        <div className="w-full space-y-1 sm:w-56">
          <Label htmlFor="week-start" className="text-xs text-muted-foreground">
            {t("adminMod.construction.lookAhead.weekStart")}
          </Label>
          <Input
            id="week-start"
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(mondayOf(e.target.value))}
          />
          {!validWeek ? (
            <p className="text-xs text-destructive">{t("adminMod.construction.lookAhead.weekMustBeMonday")}</p>
          ) : null}
        </div>
        {locked ? <Badge variant="outline">{t("adminMod.construction.lookAhead.locked")}</Badge> : null}
      </div>

      <PanelState
        isLoading={plan.isLoading || projects.isLoading}
        isError={plan.isError}
        onRetry={() => void plan.refetch()}
        isEmpty={entries.length === 0 && !canEdit}
        emptyIcon={CalendarRange}
        emptyTitle={t("adminMod.construction.lookAhead.noEntries")}
        emptyDescription={t("adminMod.construction.lookAhead.noEntriesDesc")}
      >
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminMod.construction.lookAhead.workPackageCol")}</TableHead>
                <TableHead>{t("adminMod.construction.lookAhead.dayCol")}</TableHead>
                <TableHead className="w-24">{t("adminMod.construction.lookAhead.crewCol")}</TableHead>
                <TableHead>{t("adminMod.construction.lookAhead.constraintsCol")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((row, i) => (
                <TableRow key={`${row.day}-${i}`}>
                  <TableCell>
                    <Select
                      value={row.cwp_id ?? "none"}
                      onValueChange={(v) => update(i, { cwp_id: v === "none" ? null : v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("adminMod.construction.lookAhead.unassigned")}</SelectItem>
                        {(cwps.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.cwp_number} — {c.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.day}
                      onValueChange={(v) => update(i, { day: v })}
                      disabled={!canEdit}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {days.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      value={row.crew_size}
                      disabled={!canEdit}
                      onChange={(e) => update(i, { crew_size: Number(e.target.value) || 0 })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {CONSTRAINT_CHIPS.map((c) => {
                        const on = row.constraints.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              update(i, {
                                constraints: on
                                  ? row.constraints.filter((x) => x !== c)
                                  : [...row.constraints, c],
                              })
                            }
                          >
                            <Badge variant={on ? "destructive" : "outline"}>{c}</Badge>
                          </button>
                        );
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("adminMod.construction.lookAhead.removeRow")}
                      disabled={!canEdit}
                      onClick={() => setEntries((rows) => rows.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || !validWeek}
            onClick={() =>
              setEntries((rows) => [
                ...rows,
                {
                  cwp_id: null,
                  schedule_task_id: null,
                  day: days[0] ?? weekStart,
                  crew_size: 0,
                  constraints: [],
                  notes: null,
                },
              ])
            }
          >
            <Plus className="mr-1 size-4" /> {t("adminMod.construction.lookAhead.addRow")}
          </Button>
          <div className="space-y-1">
            <Label htmlFor="la-notes" className="text-xs text-muted-foreground">
              {t("adminMod.construction.lookAhead.notes")}
            </Label>
            <Textarea
              id="la-notes"
              value={notes}
              disabled={!canEdit}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </PanelState>
    </div>
  );
}
