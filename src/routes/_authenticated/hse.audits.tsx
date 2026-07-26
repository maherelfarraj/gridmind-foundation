// P-185 — Site audit checklist runner with automatic scoring.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister } from "@/components/hse/hse-ext-bits";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  createAuditChecklist,
  listAuditChecklists,
  updateAuditChecklist,
} from "@/lib/hse-ext.functions";
import { scoreChecklist, type AuditItem } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/audits")({
  head: () => ({
    meta: [
      { title: "Site HSE audits — GridMind EPC" },
      {
        name: "description",
        content: "Run site HSE audit checklists with automatic scoring and findings counts.",
      },
      { property: "og:title", content: "Site HSE audits — GridMind EPC" },
      {
        property: "og:description",
        content: "Pass/fail items roll up to a score and a findings list you can act on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditsPage,
});

type AuditRow = {
  id: string;
  title: string;
  audit_date: string;
  status: string;
  items: AuditItem[] | null;
  score_pct: number | null;
  findings_count: number;
};

function AuditsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [auditDate, setAuditDate] = useState("");
  const [items, setItems] = useState<AuditItem[]>([{ item: "", result: null, note: "" }]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<AuditItem[]>([]);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const listFn = useServerFn(listAuditChecklists);
  const key = ["hse", "audits", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<AuditRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(createAuditChecklist);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          title: title.trim(),
          auditDate,
          items: items.filter((i) => i.item.trim().length > 0),
        },
      }),
    onSuccess: () => {
      toast.success("Audit created");
      setTitle("");
      setItems([{ item: "", result: null, note: "" }]);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateFn = useServerFn(updateAuditChecklist);
  const save = useMutation({
    mutationFn: (payload: { id: string; items?: AuditItem[]; status?: "completed" }) =>
      updateFn({ data: payload }),
    onSuccess: () => {
      toast.success("Audit updated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) => r.title.toLowerCase().includes(term));
  }, [list.data, search]);

  const openRow = rows.find((r) => r.id === openId) ?? null;
  const draftScore = scoreChecklist(draftItems);

  return (
    <div className="page-shell">
      <PageHeader
        title="Site HSE audits"
        description="Run the checklist; the score and findings count compute themselves."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">New audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-title">Title</Label>
              <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-date">Audit date</Label>
              <Input
                id="a-date"
                type="date"
                value={auditDate}
                onChange={(e) => setAuditDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Checklist items</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setItems((p) => [...p, { item: "", result: null, note: "" }])}
              >
                <Plus size={14} aria-hidden /> Add item
              </Button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label="Checklist item"
                  placeholder="Item"
                  value={it.item}
                  onChange={(e) =>
                    setItems((p) => p.map((x, idx) => (idx === i ? { ...x, item: e.target.value } : x)))
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove item"
                  onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))}
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            disabled={!activeProject || !title.trim() || !auditDate || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={14} aria-hidden /> Create
          </Button>
        </CardContent>
      </Card>

      {openRow ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Runner — {openRow.title} ({draftScore.scorePct ?? "—"}%, {draftScore.findingsCount} findings)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {draftItems.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[2fr_160px_2fr]">
                <span className="self-center text-sm">{it.item}</span>
                <Select
                  value={it.result ?? "unset"}
                  onValueChange={(v) =>
                    setDraftItems((p) =>
                      p.map((x, idx) =>
                        idx === i
                          ? { ...x, result: v === "unset" ? null : (v as AuditItem["result"]) }
                          : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger aria-label={`Result for ${it.item}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not answered</SelectItem>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                    <SelectItem value="na">N/A</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Note for ${it.item}`}
                  placeholder="Note"
                  value={it.note ?? ""}
                  onChange={(e) =>
                    setDraftItems((p) =>
                      p.map((x, idx) => (idx === i ? { ...x, note: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate({ id: openRow.id, items: draftItems })}
              >
                Save results
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({ id: openRow.id, items: draftItems, status: "completed" })
                }
              >
                Complete audit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <HseRegister
        title="Audits"
        icon={ClipboardCheck}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="hse-audits.csv"
            headers={["Title", "Date", "Score %", "Findings", "Status"]}
            rows={rows.map((r) => [
              r.title,
              r.audit_date,
              r.score_pct ?? "",
              r.findings_count,
              r.status,
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No audits"
        emptyDescription="Create the first HSE audit for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Findings</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.title}</TableCell>
                <TableCell className="text-muted-foreground">{r.audit_date}</TableCell>
                <TableCell className="tabular-nums">
                  {r.score_pct == null ? "—" : `${r.score_pct}%`}
                </TableCell>
                <TableCell>
                  {r.findings_count > 0 ? (
                    <Badge variant="destructive">{r.findings_count}</Badge>
                  ) : (
                    <Badge variant="outline">0</Badge>
                  )}
                </TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenId(r.id);
                      setDraftItems((r.items ?? []).map((i) => ({ ...i })));
                    }}
                  >
                    Run
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
