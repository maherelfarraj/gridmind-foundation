// P-088 — HSE inspections list + editor sheet.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, Search, Shield } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChecklistRunner } from "@/components/hse/checklist-runner";
import {
  errorMessage,
  hseProjectsQueryOptions,
  inspectionListQueryOptions,
} from "@/lib/hse-query";
import { upsertInspection } from "@/lib/hse.functions";
import {
  INSPECTION_STATUSES,
  summarizeChecklist,
  type ChecklistItem,
  type InspectionInput,
  type InspectionStatus,
} from "@/lib/hse.rules";
import { objectsToCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/hse/inspections")({
  head: () => ({
    meta: [
      { title: "HSE inspections — GridMind EPC" },
      { name: "description", content: "Scheduled and completed HSE inspections." },
      { property: "og:title", content: "HSE inspections" },
      { property: "og:description", content: "Checklists, findings, and close-out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InspectionsPage,
});

interface Draft {
  id?: string;
  projectId: string;
  inspectionDate: string;
  inspectionType: string;
  area: string;
  checklist: ChecklistItem[];
  status: InspectionStatus;
  dueDate: string;
}

function emptyDraft(): Draft {
  return {
    projectId: "",
    inspectionDate: new Date().toISOString().slice(0, 10),
    inspectionType: "routine",
    area: "",
    checklist: [],
    status: "scheduled",
    dueDate: "",
  };
}

function InspectionsPage() {
  const projectsQuery = useQuery(hseProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const qc = useQueryClient();

  const filters = useMemo(
    () => ({
      projectId: projectId || null,
      status: (status || null) as any,
      search: search || null,
    }),
    [projectId, status, search],
  );
  const listQuery = useQuery(inspectionListQueryOptions(filters));
  const rows = listQuery.data ?? [];

  const saveMut = useMutation({
    mutationFn: (payload: InspectionInput) =>
      upsertInspection({ data: payload as any }),
    onSuccess: async () => {
      toast.success("Inspection saved");
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ["hse"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const startNew = () => {
    setDraft(emptyDraft());
    setOpen(true);
  };
  const startEdit = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    setDraft({
      id: r.id,
      projectId: r.project_id,
      inspectionDate: r.inspection_date,
      inspectionType: r.inspection_type,
      area: r.area ?? "",
      checklist: (r.checklist ?? []) as ChecklistItem[],
      status: r.status,
      dueDate: r.due_date ?? "",
    });
    setOpen(true);
  };

  const save = () => {
    if (!draft.projectId) {
      toast.error("Select a project");
      return;
    }
    saveMut.mutate({
      id: draft.id,
      projectId: draft.projectId,
      inspectionDate: draft.inspectionDate,
      inspectionType: draft.inspectionType,
      area: draft.area || null,
      checklist: draft.checklist,
      status: draft.status,
      dueDate: draft.dueDate || null,
    });
  };

  const exportCsv = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        date: r.inspection_date,
        project: r.project_name ?? "",
        type: r.inspection_type,
        area: r.area ?? "",
        status: r.status,
        findings: r.findings_count,
        open_findings: r.open_findings,
      })),
    );
    downloadCsv("hse-inspections.csv", csv);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Shield size={14} aria-hidden /> HSE
        </div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Inspections
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button size="sm" onClick={startNew}>
              <Plus size={14} aria-hidden /> New inspection
            </Button>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All projects</SelectItem>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any</SelectItem>
                {INSPECTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Area, type, project"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {errorMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ClipboardCheck size={32} className="text-muted-foreground" aria-hidden />
            <div className="text-sm text-muted-foreground">
              No inspections yet — tap New inspection.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => startEdit(r.id)}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{r.inspection_date}</span>
                <Badge variant="secondary" className="capitalize">
                  {r.inspection_type}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {r.status}
                </Badge>
                {r.open_findings > 0 ? (
                  <Badge className="bg-destructive/10 text-destructive">
                    {r.open_findings} open
                  </Badge>
                ) : r.findings_count > 0 ? (
                  <Badge variant="outline">{r.findings_count} finding(s)</Badge>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.project_name ?? "—"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{r.area ?? "—"}</div>
            </button>
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{draft.id ? "Edit inspection" : "New inspection"}</SheetTitle>
            <SheetDescription>
              {(() => {
                const s = summarizeChecklist(draft.checklist);
                return `${s.findingsCount} finding(s), ${s.openFindings} open`;
              })()}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Project</Label>
                <Select
                  value={draft.projectId}
                  onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projectsQuery.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={draft.inspectionDate}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, inspectionDate: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Type</Label>
                <Input
                  value={draft.inspectionType}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, inspectionType: e.target.value }))
                  }
                  placeholder="routine / spot / audit"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Area</Label>
                <Input
                  value={draft.area}
                  onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, status: v as InspectionStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSPECTION_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={draft.dueDate}
                  onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <ChecklistRunner
              items={draft.checklist}
              onChange={(items) => setDraft((d) => ({ ...d, checklist: items }))}
            />
          </div>
          <SheetFooter className="mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
