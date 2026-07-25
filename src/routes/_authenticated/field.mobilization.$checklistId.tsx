// P-084 — Mobilization checklist detail page.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Circle,
  HardHat,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage, mobilizationDetailQueryOptions } from "@/lib/mobilization-query";
import {
  attachMobilizationEvidence,
  completeMobilizationChecklist,
  toggleMobilizationItem,
  updateInductionRoster,
} from "@/lib/mobilization.functions";
import {
  CATEGORY_LABELS,
  computeProgress,
  MOBILIZATION_CATEGORIES,
  type ChecklistItem,
  type MobilizationCategory,
  type RosterEntry,
} from "@/lib/mobilization.rules";

export const Route = createFileRoute("/_authenticated/field/mobilization/$checklistId")({
  head: () => ({
    meta: [
      { title: "Mobilization checklist — GridMind EPC" },
      {
        name: "description",
        content: "Track cabins, fencing, HSE induction and permits for a project site.",
      },
      { property: "og:title", content: "Mobilization checklist — GridMind EPC" },
      {
        property: "og:description",
        content: "Track cabins, fencing, HSE induction and permits for a project site.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(mobilizationDetailQueryOptions(params.checklistId)),
  component: MobilizationDetailPage,
});

function MobilizationDetailPage() {
  const { checklistId } = Route.useParams();
  const query = useQuery(mobilizationDetailQueryOptions(checklistId));

  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Failed to load checklist</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage(query.error)}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  const row = query.data!;
  const items = row.items ?? [];
  const progress = computeProgress(items);
  const pct =
    progress.requiredTotal === 0
      ? 0
      : Math.round((progress.requiredComplete / progress.requiredTotal) * 100);
  const isComplete = row.status === "complete";
  const showAmberBanner = !isComplete && !progress.allRequiredDone;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          to="/field/mobilization"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft size={14} aria-hidden /> Mobilization
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <HardHat className="h-5 w-5 text-muted-foreground" aria-hidden />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {row.name}
          </h1>
          <StatusBadge status={row.status} />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {progress.requiredComplete} / {progress.requiredTotal} required items complete
              </span>
              <span>{pct}%</span>
            </div>
            <Progress value={pct} />
          </div>
          <CompleteButton
            checklistId={checklistId}
            disabled={!progress.allRequiredDone || isComplete}
          />
        </div>
      </header>

      {showAmberBanner ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm text-warning">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Site not yet ready for field work
          </div>
          <p className="mt-1 text-xs">
            Required items remain incomplete. Field mobilization cannot be marked complete until
            every required item is checked off.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {MOBILIZATION_CATEGORIES.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            items={items.filter((i) => i.category === cat)}
            checklistId={checklistId}
            companyId={row.company_id}
            projectId={row.project_id}
            disabled={isComplete}
          />
        ))}
      </div>
    </div>
  );
}

function CompleteButton({ checklistId, disabled }: { checklistId: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const completeFn = useServerFn(completeMobilizationChecklist);
  const mutation = useMutation({
    mutationFn: () => completeFn({ data: { checklistId } }),
    onSuccess: () => {
      toast.success("Mobilization complete");
      queryClient.invalidateQueries({ queryKey: ["mobilization"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button onClick={() => mutation.mutate()} disabled={disabled || mutation.isPending}>
      {mutation.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <CheckCircle2 className="mr-2 h-4 w-4" />
      )}
      Mark complete
    </Button>
  );
}

function CategorySection({
  category,
  items,
  checklistId,
  companyId,
  projectId,
  disabled,
}: {
  category: MobilizationCategory;
  items: ChecklistItem[];
  checklistId: string;
  companyId: string;
  projectId: string;
  disabled: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{CATEGORY_LABELS[category]}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {items.filter((i) => i.status === "complete").length} / {items.length}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            checklistId={checklistId}
            companyId={companyId}
            projectId={projectId}
            disabled={disabled}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  checklistId,
  companyId,
  projectId,
  disabled,
}: {
  item: ChecklistItem;
  checklistId: string;
  companyId: string;
  projectId: string;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const toggleFn = useServerFn(toggleMobilizationItem);
  const attachFn = useServerFn(attachMobilizationEvidence);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [uploading, setUploading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = useMutation({
    mutationFn: (opts: { status: "not_started" | "in_progress" | "complete" }) =>
      toggleFn({
        data: {
          checklistId,
          itemKey: item.key,
          status: opts.status,
          notes: notes.trim() ? notes.trim() : null,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mobilization"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const attach = useMutation({
    mutationFn: (path: string) =>
      attachFn({ data: { checklistId, itemKey: item.key, evidencePath: path } }),
    onSuccess: () => {
      toast.success("Evidence attached");
      queryClient.invalidateQueries({ queryKey: ["mobilization"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const path = `${companyId}/mobilization/${projectId}/${checklistId}/${item.key}-${id}.${ext}`;
      const { error } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      await attach.mutateAsync(path);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openSigned = async () => {
    if (!item.evidence_path) return;
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(item.evidence_path, 600);
    if (data?.signedUrl) {
      setSignedUrl(data.signedUrl);
      window.open(data.signedUrl, "_blank", "noopener");
    }
  };

  const isDone = item.status === "complete";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-0.5"
          disabled={disabled || toggle.isPending}
          onClick={() => toggle.mutate({ status: isDone ? "not_started" : "complete" })}
          aria-label={isDone ? "Mark not started" : "Mark complete"}
        >
          {isDone ? (
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
        </button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{item.label}</span>
            {item.required ? (
              <Badge variant="outline" className="text-[10px]">
                required
              </Badge>
            ) : null}
            {item.status === "in_progress" ? (
              <Badge variant="secondary" className="text-[10px]">
                in progress
              </Badge>
            ) : null}
          </div>
          {item.completed_at ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Completed {new Date(item.completed_at).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>

      {item.category === "hse_induction" && item.roster !== undefined ? (
        <RosterEditor
          checklistId={checklistId}
          itemKey={item.key}
          roster={item.roster ?? []}
          disabled={disabled}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={disabled}
            className="mt-1"
          />
          <div className="mt-1 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || toggle.isPending}
              onClick={() => toggle.mutate({ status: item.status })}
            >
              Save notes
            </Button>
          </div>
        </div>
        <div>
          <Label className="text-xs">Evidence</Label>
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Upload
            </Button>
            {item.evidence_path ? (
              <Button size="sm" variant="ghost" onClick={openSigned}>
                <Paperclip className="mr-2 h-4 w-4" /> View
              </Button>
            ) : null}
          </div>
          {item.evidence_path ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.evidence_path.split("/").pop()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RosterEditor({
  checklistId,
  itemKey,
  roster,
  disabled,
}: {
  checklistId: string;
  itemKey: string;
  roster: RosterEntry[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateInductionRoster);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [inductedAt, setInductedAt] = useState(new Date().toISOString().slice(0, 10));

  const mutation = useMutation({
    mutationFn: (next: RosterEntry[]) => updateFn({ data: { checklistId, itemKey, roster: next } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mobilization"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const add = () => {
    if (!name.trim() || !company.trim()) return;
    mutation.mutate([
      ...roster,
      { name: name.trim(), company: company.trim(), inducted_at: inductedAt },
    ]);
    setName("");
    setCompany("");
  };
  const remove = (idx: number) => {
    const next = roster.filter((_, i) => i !== idx);
    mutation.mutate(next);
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Induction roster ({roster.length})
        </span>
      </div>
      {roster.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">No attendees recorded yet.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {roster.map((r, i) => (
            <li
              key={`${r.name}-${i}`}
              className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background px-2 py-1"
            >
              <span className="truncate">
                <span className="font-medium text-foreground">{r.name}</span>
                <span className="ml-2 text-muted-foreground">{r.company}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.inducted_at}</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled || mutation.isPending}
                onClick={() => remove(i)}
                aria-label="Remove attendee"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-4">
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
        />
        <Input
          placeholder="Company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={disabled}
        />
        <Input
          type="date"
          value={inductedAt}
          onChange={(e) => setInductedAt(e.target.value)}
          disabled={disabled}
        />
        <Button
          size="sm"
          onClick={add}
          disabled={disabled || mutation.isPending || !name.trim() || !company.trim()}
        >
          <Plus className="mr-2 h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    not_started: { label: "Not started", variant: "outline" },
    in_progress: { label: "In progress", variant: "secondary" },
    complete: { label: "Complete", variant: "default" },
  };
  const cfg = map[status] ?? map.not_started;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function DetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
