// P-169 — Grid-code checklist view (template picker, per-item responses, progress, admin edit).
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ClipboardCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EaValidationNotice } from "@/components/engineering/ea-study-workspace";
import { gridCodeProgress } from "@/lib/ea/present";
import type { GridCodeItem, GridCodeResponseStatus } from "@/lib/ea/protection";
import {
  listGridCodeChecklist,
  saveGridCodeResponse,
  saveGridCodeTemplate,
} from "@/lib/ea-protection.functions";
import { getEaWriteAccess, listEaStudies } from "@/lib/ea-studies.functions";

export const Route = createFileRoute("/_authenticated/projects/$projectId/engineering/grid-code")({
  head: () => ({
    meta: [
      { title: "Grid-code checklist — GridMind EPC" },
      {
        name: "description",
        content:
          "Track grid-code requirements item by item with status, evidence and linked electrical studies for the project record.",
      },
      { property: "og:title", content: "Grid-code checklist — GridMind EPC" },
      {
        property: "og:description",
        content: "Per-item grid-code tracking with evidence and study links.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GridCodePage,
});

const STATUS_LABEL: Record<GridCodeResponseStatus, string> = {
  open: "Open",
  evidence_pending: "Evidence pending",
  compliant: "Compliant",
  non_compliant: "Non-compliant",
  not_applicable: "Not applicable",
};

const NONE = "__none__";

function GridCodePage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listGridCodeChecklist);
  const studiesFn = useServerFn(listEaStudies);
  const accessFn = useServerFn(getEaWriteAccess);
  const saveResponseFn = useServerFn(saveGridCodeResponse);
  const saveTemplateFn = useServerFn(saveGridCodeTemplate);

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const checklist = useQuery({
    queryKey: ["grid-code", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const studies = useQuery({
    queryKey: ["ea-studies", projectId, "all", "all"],
    queryFn: () => studiesFn({ data: { projectId, studyType: null, status: null } }),
  });
  const access = useQuery({
    queryKey: ["ea-write-access", projectId],
    queryFn: () => accessFn({ data: { projectId } }),
  });

  const templates = checklist.data?.templates ?? [];
  useEffect(() => {
    if (!templateId && templates.length > 0) setTemplateId(templates[0].id);
  }, [templateId, templates]);

  const template = templates.find((t) => t.id === templateId) ?? null;
  const items = useMemo<GridCodeItem[]>(
    () => ((template?.items ?? []) as unknown as GridCodeItem[]) ?? [],
    [template],
  );
  const responses = useMemo(
    () => (checklist.data?.responses ?? []).filter((r) => r.template_id === templateId),
    [checklist.data, templateId],
  );

  const progress = gridCodeProgress(
    items.length,
    items.map(
      (_item, index) => responses.find((r) => r.item_index === index)?.status ?? "open",
    ),
  );

  const saveResponse = useMutation({
    mutationFn: (input: {
      itemIndex: number;
      status: GridCodeResponseStatus;
      evidence: string | null;
      comment: string | null;
      studyId: string | null;
    }) =>
      saveResponseFn({
        data: { projectId, templateId: templateId as string, ...input },
      }),
    onSuccess: () => {
      toast.success("Checklist item saved");
      void queryClient.invalidateQueries({ queryKey: ["grid-code", projectId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the item"),
  });

  const saveTemplate = useMutation({
    mutationFn: (input: {
      market: string;
      name: string;
      version: string;
      items: GridCodeItem[];
    }) =>
      saveTemplateFn({
        data: { projectId, templateId: templateId ?? undefined, isActive: true, ...input },
      }),
    onSuccess: () => {
      toast.success("Template saved");
      setEditorOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["grid-code", projectId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save the template"),
  });

  const canEdit = access.data?.canWrite === true;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Grid-code checklist"
        description="Requirement-by-requirement tracking with evidence, comments and linked studies."
        actions={
          canEdit ? (
            <Button variant="outline" onClick={() => setEditorOpen(true)}>
              <Pencil className="mr-1 size-4" aria-hidden /> Edit template
            </Button>
          ) : null
        }
      />

      <div
        role="note"
        className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        Checklist status is a project record, not a grid-code compliance certification.
        {checklist.data?.caveat ? ` ${checklist.data.caveat}` : ""}
      </div>

      {checklist.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : checklist.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Checklist could not be loaded"
          description={
            checklist.error instanceof Error ? checklist.error.message : "Unexpected error"
          }
          action={
            <Button variant="outline" onClick={() => void checklist.refetch()}>
              Retry
            </Button>
          }
        />
      ) : templates.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No grid-code templates yet"
          description="An engineering admin can create a market template (for example Jordan NEPCO) to start tracking."
          action={
            canEdit ? <Button onClick={() => setEditorOpen(true)}>Create template</Button> : null
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 py-3">
              <Select value={templateId ?? ""} onValueChange={setTemplateId}>
                <SelectTrigger className="h-9 w-72" aria-label="Grid-code template">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.market} — {t.name} (v{t.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="min-w-56 flex-1">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Compliant</span>
                  <span>
                    {progress.compliant}/{progress.applicable} applicable — {progress.percent}%
                  </span>
                </div>
                <Progress value={progress.percent} />
              </div>
            </CardContent>
          </Card>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Requirement</TableHead>
                  <TableHead className="w-44">Status</TableHead>
                  <TableHead className="w-56">Evidence</TableHead>
                  <TableHead className="w-56">Comment</TableHead>
                  <TableHead className="w-52">Linked study</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => {
                  const response = responses.find((r) => r.item_index === index);
                  return (
                    <ChecklistRow
                      key={`${item.code}-${index}`}
                      item={item}
                      index={index}
                      status={(response?.status ?? "open") as GridCodeResponseStatus}
                      evidence={response?.evidence ?? ""}
                      comment={response?.comment ?? ""}
                      studyId={response?.study_id ?? null}
                      studies={(studies.data?.studies ?? []).map((s) => ({
                        id: s.id,
                        label: `${s.study_number} — ${s.title}`,
                      }))}
                      disabled={!canEdit || saveResponse.isPending}
                      onSave={(payload) => saveResponse.mutate({ itemIndex: index, ...payload })}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <EaValidationNotice />

      <TemplateEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={
          template
            ? {
                market: template.market,
                name: template.name,
                version: template.version,
                items,
              }
            : null
        }
        pending={saveTemplate.isPending}
        onSave={(value) => saveTemplate.mutate(value)}
      />
    </div>
  );
}

type RowPayload = {
  status: GridCodeResponseStatus;
  evidence: string | null;
  comment: string | null;
  studyId: string | null;
};

function ChecklistRow({
  item,
  index,
  status,
  evidence,
  comment,
  studyId,
  studies,
  disabled,
  onSave,
}: {
  item: GridCodeItem;
  index: number;
  status: GridCodeResponseStatus;
  evidence: string;
  comment: string;
  studyId: string | null;
  studies: { id: string; label: string }[];
  disabled: boolean;
  onSave: (payload: RowPayload) => void;
}) {
  const [draft, setDraft] = useState({ status, evidence, comment, studyId });
  useEffect(() => {
    setDraft({ status, evidence, comment, studyId });
  }, [status, evidence, comment, studyId]);

  const commit = (next: Partial<typeof draft>) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    onSave({
      status: merged.status,
      evidence: merged.evidence.trim() || null,
      comment: merged.comment.trim() || null,
      studyId: merged.studyId,
    });
  };

  return (
    <TableRow>
      <TableCell className="align-top font-medium">{item.code}</TableCell>
      <TableCell className="align-top">
        <p className="text-sm text-foreground">{item.requirement}</p>
        <p className="text-xs text-muted-foreground">{item.category}</p>
      </TableCell>
      <TableCell className="align-top">
        <Select
          value={draft.status}
          disabled={disabled}
          onValueChange={(v) => commit({ status: v as GridCodeResponseStatus })}
        >
          <SelectTrigger className="h-9" aria-label={`Status for ${item.code}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as GridCodeResponseStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="align-top">
        <Input
          value={draft.evidence}
          disabled={disabled}
          aria-label={`Evidence for ${item.code}`}
          placeholder={item.evidence_required ? "Evidence required" : "Optional"}
          onChange={(e) => setDraft((d) => ({ ...d, evidence: e.target.value }))}
          onBlur={() => commit({})}
        />
      </TableCell>
      <TableCell className="align-top">
        <Input
          value={draft.comment}
          disabled={disabled}
          aria-label={`Comment for ${item.code}`}
          onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
          onBlur={() => commit({})}
        />
      </TableCell>
      <TableCell className="align-top">
        <Select
          value={draft.studyId ?? NONE}
          disabled={disabled}
          onValueChange={(v) => commit({ studyId: v === NONE ? null : v })}
        >
          <SelectTrigger className="h-9" aria-label={`Linked study for item ${index + 1}`}>
            <SelectValue placeholder="No study" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No study</SelectItem>
            {studies.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}

function TemplateEditor({
  open,
  onOpenChange,
  initial,
  pending,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { market: string; name: string; version: string; items: GridCodeItem[] } | null;
  pending: boolean;
  onSave: (value: {
    market: string;
    name: string;
    version: string;
    items: GridCodeItem[];
  }) => void;
}) {
  const [market, setMarket] = useState(initial?.market ?? "Jordan NEPCO");
  const [name, setName] = useState(initial?.name ?? "NEPCO interconnection starter");
  const [version, setVersion] = useState(initial?.version ?? "1.0");
  const [items, setItems] = useState<GridCodeItem[]>(initial?.items ?? []);

  useEffect(() => {
    if (!open) return;
    setMarket(initial?.market ?? "Jordan NEPCO");
    setName(initial?.name ?? "NEPCO interconnection starter");
    setVersion(initial?.version ?? "1.0");
    setItems(initial?.items ?? []);
  }, [open, initial]);

  const update = (index: number, patch: Partial<GridCodeItem>) =>
    setItems((current) => current.map((i, idx) => (idx === index ? { ...i, ...patch } : i)));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Edit grid-code template</SheetTitle>
          <SheetDescription>
            Items apply to every project in the company that uses this template.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="gc-market">Market</Label>
              <Input id="gc-market" value={market} onChange={(e) => setMarket(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gc-name">Name</Label>
              <Input id="gc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gc-version">Version</Label>
              <Input id="gc-version" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="text-sm">Items ({items.length})</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    {
                      code: `GCC-${String(current.length + 1).padStart(2, "0")}`,
                      category: "Interconnection",
                      requirement: "",
                      evidence_required: true,
                    },
                  ])
                }
              >
                <Plus className="mr-1 size-4" aria-hidden /> Add item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                items.map((item, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-md border border-border bg-card p-3"
                  >
                    <div className="flex gap-2">
                      <Input
                        value={item.code}
                        aria-label={`Item ${index + 1} code`}
                        className="w-32"
                        onChange={(e) => update(index, { code: e.target.value })}
                      />
                      <Input
                        value={item.category}
                        aria-label={`Item ${index + 1} category`}
                        onChange={(e) => update(index, { category: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove item ${index + 1}`}
                        onClick={() => setItems((c) => c.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <Textarea
                      value={item.requirement}
                      aria-label={`Item ${index + 1} requirement`}
                      rows={2}
                      onChange={(e) => update(index, { requirement: e.target.value })}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Button
            type="button"
            disabled={pending || items.length === 0}
            onClick={() => onSave({ market, name, version, items })}
          >
            {pending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
