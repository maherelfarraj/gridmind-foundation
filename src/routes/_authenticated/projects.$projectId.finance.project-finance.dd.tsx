// P-082 — Lender DD tab (checklist grouped by category + document upload).
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, isValid } from "date-fns";
import { Download, ExternalLink, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

import {
  changeDdStatus,
  signDdDocumentDownloadUrl,
  signDdDocumentUploadUrl,
  upsertDdItem,
} from "@/lib/lender-dd.functions";
import {
  ddListQueryOptions,
  ddMembersQueryOptions,
  projectFinanceAccessQueryOptions,
  projectFinanceErrorMessage,
} from "@/lib/project-finance.query";
import {
  DD_CATEGORIES,
  DD_ITEM_STATUSES,
  ddReadinessBucket,
  ddReadinessSummary,
  isDdOverdue,
  type DdCategory,
  type DdItemRow,
  type DdItemStatus,
} from "@/lib/project-finance.rules";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/finance/project-finance/dd",
)({
  head: () => ({
    meta: [
      { title: "Lender DD — GridMind EPC" },
      {
        name: "description",
        content: "Lender due diligence checklist with document upload and readiness KPI.",
      },
      { property: "og:title", content: "Lender DD — GridMind EPC" },
      {
        property: "og:description",
        content: "Track lender due diligence status by category and owner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ params, context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(ddListQueryOptions(params.projectId)),
      context.queryClient.ensureQueryData(ddMembersQueryOptions()),
      context.queryClient.ensureQueryData(projectFinanceAccessQueryOptions()),
    ]);
  },
  errorComponent: ({ error, reset }) => (
    <Card className="p-4">
      <p className="text-sm text-destructive">{projectFinanceErrorMessage(error)}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={reset}>
        Try again
      </Button>
    </Card>
  ),
  pendingComponent: () => (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  ),
  component: DdTab,
});

const STATUS_TONE: Record<DdItemStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  submitted: "bg-primary/10 text-primary border-primary/30",
  accepted: "bg-success/10 text-success border-success/30",
  waived: "bg-warning/10 text-warning border-warning/30",
};

function DdTab() {
  const { projectId } = Route.useParams();
  const list = useSuspenseQuery(ddListQueryOptions(projectId));
  const members = useSuspenseQuery(ddMembersQueryOptions());
  const access = useSuspenseQuery(projectFinanceAccessQueryOptions());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DdItemRow | null>(null);

  const rows = list.data.rows;
  const summary = useMemo(() => ddReadinessSummary(rows), [rows]);
  const bucket = ddReadinessBucket(summary.readinessPct);
  const bucketTone =
    bucket === "ok"
      ? "border-success/40 bg-success/10 text-success"
      : "border-warning/40 bg-warning/10 text-warning";

  const grouped = useMemo(() => {
    const g: Record<string, DdItemRow[]> = {};
    for (const r of rows) {
      (g[r.category] = g[r.category] ?? []).push(r);
    }
    return g;
  }, [rows]);

  const exportCsv = () => {
    const header = ["category", "title", "status", "due_date", "owner_id", "document_path"];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.category,
          JSON.stringify(r.title),
          r.status,
          r.due_date ?? "",
          r.owner_id ?? "",
          JSON.stringify(r.document_path ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `lender-dd-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className={cn("p-4", bucketTone)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-80">DD readiness</div>
            <div className="text-2xl font-semibold tabular-nums">
              {summary.readinessPct.toFixed(1)}%
            </div>
          </div>
          <div className="text-sm tabular-nums opacity-90">
            {summary.accepted + summary.waived} of {summary.total} complete · {summary.submitted}{" "}
            submitted · {summary.in_progress} in progress
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {rows.length === 0 ? "No DD items yet." : `${rows.length} item(s)`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 size-4" /> CSV
          </Button>
          {access.data.canWriteDd ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" /> New item
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Add the first lender due-diligence item.
        </Card>
      ) : (
        <div className="space-y-4">
          {DD_CATEGORIES.map((cat) => {
            const items = grouped[cat] ?? [];
            if (items.length === 0) return null;
            return (
              <Card key={cat} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
                  <div className="text-sm font-semibold capitalize">{cat}</div>
                  <div className="text-xs text-muted-foreground">{items.length} item(s)</div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((r) => (
                      <DdRow
                        key={r.id}
                        row={r}
                        canWrite={access.data.canWriteDd}
                        members={members.data.members}
                        onEdit={() => {
                          setEditing(r);
                          setOpen(true);
                        }}
                        projectId={projectId}
                      />
                    ))}
                  </TableBody>
                </Table>
              </Card>
            );
          })}
        </div>
      )}

      {open ? (
        <DdDrawer
          projectId={projectId}
          initial={editing}
          members={members.data.members}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

interface DdRowProps {
  row: DdItemRow;
  canWrite: boolean;
  members: Array<{ id: string; email: string | null; full_name: string | null }>;
  onEdit: () => void;
  projectId: string;
}

function DdRow({ row, canWrite, members, onEdit, projectId }: DdRowProps) {
  const qc = useQueryClient();
  const changeStatus = useServerFn(changeDdStatus);
  const signDownload = useServerFn(signDdDocumentDownloadUrl);

  const mut = useMutation({
    mutationFn: (status: DdItemStatus) => changeStatus({ data: { id: row.id, status } }),
    onSuccess: async () => {
      toast.success("Status updated");
      await qc.invalidateQueries({ queryKey: ["pf", "dd", projectId] });
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  const overdue = isDdOverdue(row.due_date, row.status);
  const owner = members.find((m) => m.id === row.owner_id);

  const openDoc = async () => {
    if (!row.document_path) return;
    const { url } = await signDownload({ data: { path: row.document_path } });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error("Could not open document");
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{row.title}</TableCell>
      <TableCell>
        {canWrite ? (
          <Select value={row.status} onValueChange={(v) => mut.mutate(v as DdItemStatus)}>
            <SelectTrigger className={cn("h-8 w-40 capitalize", STATUS_TONE[row.status])}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DD_ITEM_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline" className={cn("capitalize", STATUS_TONE[row.status])}>
            {row.status.replace(/_/g, " ")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {owner?.full_name ?? owner?.email ?? "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-xs tabular-nums",
          overdue ? "text-destructive font-medium" : "text-muted-foreground",
        )}
      >
        {row.due_date
          ? isValid(new Date(row.due_date))
            ? format(new Date(row.due_date), "dd MMM yyyy")
            : "—"
          : "—"}
        {overdue ? " · overdue" : ""}
      </TableCell>
      <TableCell>
        {row.document_path ? (
          <Button variant="ghost" size="sm" onClick={openDoc}>
            <ExternalLink className="mr-1 size-3" /> Open
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {canWrite ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

interface DdDrawerProps {
  projectId: string;
  initial: DdItemRow | null;
  members: Array<{ id: string; email: string | null; full_name: string | null }>;
  onClose: () => void;
}

function DdDrawer({ projectId, initial, members, onClose }: DdDrawerProps) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertDdItem);
  const signUpload = useServerFn(signDdDocumentUploadUrl);

  const [category, setCategory] = useState<DdCategory>(
    (initial?.category as DdCategory) ?? "technical",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [dueDate, setDueDate] = useState(initial?.due_date ?? "");
  const [ownerId, setOwnerId] = useState(initial?.owner_id ?? "");
  const [note, setNote] = useState(initial?.response_note ?? "");
  const [docPath, setDocPath] = useState<string | null>(initial?.document_path ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File is larger than 20 MB");
      return;
    }
    setUploading(true);
    try {
      const { path, token } = await signUpload({
        data: { projectId, filename: file.name },
      });
      const { error } = await supabase.storage
        .from("documents")
        .uploadToSignedUrl(path, token, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (error) throw error;
      setDocPath(path);
      toast.success("Document uploaded");
    } catch (err) {
      toast.error(projectFinanceErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const mut = useMutation({
    mutationFn: () =>
      upsert({
        data: {
          id: initial?.id,
          project_id: projectId,
          category,
          title,
          description: description || null,
          due_date: dueDate || null,
          owner_id: ownerId || null,
          response_note: note || null,
          document_path: docPath,
        },
      }),
    onSuccess: async () => {
      toast.success(initial ? "Item updated" : "Item created");
      await qc.invalidateQueries({ queryKey: ["pf", "dd", projectId] });
      onClose();
    },
    onError: (err) => toast.error(projectFinanceErrorMessage(err)),
  });

  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{initial ? "Edit DD item" : "New DD item"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as DdCategory)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DD_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={dueDate ?? ""}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name ?? m.email ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Response note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Document</Label>
            <div className="flex items-center gap-2">
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
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 size-4" />
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              {docPath ? (
                <span className="text-xs text-muted-foreground truncate">{docPath}</span>
              ) : null}
            </div>
          </div>
        </div>
        <SheetFooter className="mt-6 gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={title.trim().length === 0 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Saving…" : initial ? "Update" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
