// P-091 — Submittals list with inline "New submittal" dialog.
import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { downloadCsv, objectsToCsv } from "@/lib/csv";
import { createSubmittal, signSubmittalUpload } from "@/lib/submittals.functions";
import {
  errorMessage,
  submittalListQueryOptions,
  submittalProjectsQueryOptions,
} from "@/lib/submittals-query";
import {
  SUBMITTAL_STATUSES,
  SUBMITTAL_STATUS_LABELS,
  avgTurnaroundDays,
  submittalStatusTint,
  type SubmittalStatus,
} from "@/lib/submittals.rules";
import { supabase } from "@/integrations/supabase/client";

const searchSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(SUBMITTAL_STATUSES).optional(),
  search: z.string().max(200).optional(),
});

export const Route = createFileRoute("/_authenticated/field/submittals/")({
  validateSearch: (raw): z.infer<typeof searchSchema> => searchSchema.parse(raw ?? {}),
  head: () => ({
    meta: [
      { title: "Submittals — GridMind EPC" },
      {
        name: "description",
        content: "Track spec submittals, revisions, and review turnaround per project.",
      },
      { property: "og:title", content: "Submittals — GridMind EPC" },
      {
        property: "og:description",
        content: "Draft, submit, review, and revise engineering submittals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubmittalsIndexPage,
});

function SubmittalsIndexPage() {
  const navigate = useNavigate();
  const sp = Route.useSearch();
  const projectsQuery = useQuery(submittalProjectsQueryOptions());
  const [search, setSearch] = useState(sp.search ?? "");
  const [dlgOpen, setDlgOpen] = useState(false);

  const filters = useMemo(
    () => ({
      projectId: sp.projectId ?? null,
      status: sp.status ?? null,
      search: sp.search ?? null,
    }),
    [sp],
  );
  const listQuery = useQuery(submittalListQueryOptions(filters));

  const setSearchParam = (patch: Partial<z.infer<typeof searchSchema>>) => {
    void navigate({
      to: "/field/submittals",
      search: (prev: Record<string, unknown>) =>
        ({ ...prev, ...patch }) as z.infer<typeof searchSchema>,
      replace: true,
    });
  };

  const rows = listQuery.data ?? [];
  const open = rows.filter((r) =>
    ["submitted", "under_review", "revise_resubmit"].includes(r.status),
  ).length;
  const turnaround = avgTurnaroundDays(rows);

  const onExport = () => {
    const csv = objectsToCsv(
      rows.map((r) => ({
        number: r.submittal_number,
        revision: r.revision,
        project: r.project_name ?? "",
        title: r.title,
        spec: r.spec_section ?? "",
        status: r.status,
        due: r.due_date ?? "",
        submitted: r.submitted_at ?? "",
        reviewed: r.reviewed_at ?? "",
      })),
    );
    downloadCsv(`submittals-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <FileText size={14} aria-hidden /> Field / Document control
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Submittals
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" onClick={() => setDlgOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New submittal
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Kpi label="Open" value={String(open)} />
        <Kpi
          label="Avg turnaround"
          value={turnaround === null ? "—" : `${turnaround.toFixed(1)} d`}
        />
        <Kpi label="Total" value={String(rows.length)} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select
              value={sp.projectId ?? "all"}
              onValueChange={(v) => setSearchParam({ projectId: v === "all" ? undefined : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
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
            <Select
              value={sp.status ?? "all"}
              onValueChange={(v) =>
                setSearchParam({
                  status: v === "all" ? undefined : (v as SubmittalStatus),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {SUBMITTAL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SUBMITTAL_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-full flex flex-col gap-1 md:col-span-2">
            <Label className="text-xs">Search</Label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearchParam({ search: search || undefined });
              }}
              className="flex gap-1"
            >
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="SUB / title / spec…"
              />
              <Button type="submit" variant="outline" size="icon">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <Skeleton className="h-64" />
      ) : listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load submittals</AlertTitle>
          <AlertDescription>
            {errorMessage(listQuery.error)}{" "}
            <Button variant="link" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No submittals yet. Create the first one.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Rev</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/field/submittals/$id"
                        params={{ id: r.id }}
                        className="font-medium text-foreground hover:underline"
                      >
                        {r.submittal_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.revision}</TableCell>
                    <TableCell className="text-sm">{r.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.project_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={submittalStatusTint(r.status)} variant="outline">
                        {SUBMITTAL_STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{r.due_date ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <NewSubmittalDialog
        open={dlgOpen}
        onOpenChange={setDlgOpen}
        defaultProjectId={sp.projectId}
      />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-display text-xl font-semibold text-foreground">{value}</span>
      </CardContent>
    </Card>
  );
}

function NewSubmittalDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultProjectId: string | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projectsQuery = useQuery(submittalProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  const [title, setTitle] = useState("");
  const [specSection, setSpecSection] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const projects = projectsQuery.data ?? [];
  const resolvedProjectId = projectId || projects[0]?.id || "";

  const createMut = useMutation({
    mutationFn: () =>
      createSubmittal({
        data: {
          projectId: resolvedProjectId,
          title,
          specSection: specSection || null,
          dueDate: dueDate || null,
          filePath: filePath || null,
        } as any,
      }),
    onSuccess: async (row) => {
      toast.success(`${(row as any).submittal_number} created`);
      await qc.invalidateQueries({ queryKey: ["submittals"] });
      onOpenChange(false);
      setTitle("");
      setSpecSection("");
      setDueDate("");
      setFilePath(null);
      void navigate({ to: "/field/submittals/$id", params: { id: (row as any).id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !resolvedProjectId) return;
    setUploading(true);
    try {
      const signed = await signSubmittalUpload({
        data: { projectId: resolvedProjectId, fileName: file.name } as any,
      });
      const { error } = await supabase.storage
        .from(signed.bucket)
        .uploadToSignedUrl(signed.path, signed.token, file);
      if (error) throw error;
      setFilePath(signed.path);
      toast.success("File uploaded");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const canSubmit = !!resolvedProjectId && title.trim().length >= 2 && !createMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New submittal</DialogTitle>
          <DialogDescription>Draft a submittal — file attachment is optional.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Project</Label>
            <Select value={resolvedProjectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label>Spec section</Label>
              <Input value={specSection} onChange={(e) => setSpecSection(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Attachment</Label>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" className="hidden" onChange={onFileChange} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !resolvedProjectId}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {filePath ? "Replace file" : "Upload file"}
              </Button>
              {filePath ? (
                <span className="truncate text-xs text-muted-foreground">
                  {filePath.split("/").pop()}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
