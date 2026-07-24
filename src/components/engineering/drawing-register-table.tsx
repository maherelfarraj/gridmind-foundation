// P-053 — Drawing register table + toolbar + new-drawing dialog.
import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Download, FileWarning, Loader2, Lock, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  DRAWING_DISCIPLINES,
  DRAWING_STATUSES,
  listDrawings,
  getMyDrawingRoles,
  type DrawingDiscipline,
  type DrawingStatus,
} from "@/lib/drawings.functions";
import {
  drawingRolesQueryOptions,
  drawingsListQueryOptions,
  useCreateDrawing,
} from "@/lib/drawings-query";

const DISCIPLINE_LABEL: Record<DrawingDiscipline, string> = {
  civil: "Civil",
  structural: "Structural",
  electrical: "Electrical",
  mechanical: "Mechanical",
  scada_controls: "SCADA/Controls",
  survey: "Survey",
  general: "General",
};

export function statusBadgeClass(status: DrawingStatus): string {
  switch (status) {
    case "draft":
      return "bg-muted text-muted-foreground border-transparent";
    case "IFD":
      // amber accent
      return "bg-accent/20 text-accent-foreground border-accent/40";
    case "IFC":
      return "bg-primary/15 text-primary border-primary/40";
    case "as_built":
      return "bg-secondary text-secondary-foreground border-transparent";
    case "superseded":
      return "bg-muted text-muted-foreground border-transparent line-through";
    default:
      return "";
  }
}

const STATUS_LABEL: Record<DrawingStatus, string> = {
  draft: "Draft",
  IFD: "IFD",
  IFC: "IFC",
  as_built: "As-built",
  superseded: "Superseded",
};

interface Props {
  projectId: string;
  filters: {
    q?: string;
    discipline?: DrawingDiscipline;
    status?: DrawingStatus;
    page?: number;
  };
  onFilterChange: (next: Props["filters"]) => void;
}

export function DrawingRegisterTable({ projectId, filters, onFilterChange }: Props) {
  const listFn = useServerFn(listDrawings);
  const rolesFn = useServerFn(getMyDrawingRoles);
  const { data: rolesData } = useSuspenseQuery(
    drawingRolesQueryOptions(rolesFn, projectId),
  );
  const { data } = useSuspenseQuery(
    drawingsListQueryOptions(listFn, projectId, {
      search: filters.q ?? null,
      discipline: filters.discipline ?? null,
      status: filters.status ?? null,
      limit: 100,
      offset: ((filters.page ?? 1) - 1) * 100,
    }),
  );
  const [search, setSearch] = useState(filters.q ?? "");

  const exportCsv = () => {
    const header = [
      "drawing_number",
      "title",
      "discipline",
      "current_status",
      "revision",
      "issued_at",
    ];
    const lines = [header.join(",")];
    for (const r of data.rows) {
      lines.push(
        [
          r.drawing_number,
          r.title.replace(/"/g, '""'),
          r.discipline,
          r.current_status,
          r.current_revision?.revision_code ?? "",
          r.current_revision?.issued_at ?? "",
        ]
          .map((v) => `"${v}"`)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drawings-${projectId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onFilterChange({ ...filters, q: search || undefined, page: 1 });
          }}
          className="relative flex-1 min-w-[220px]"
        >
          <Search
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={14}
          />
          <Input
            placeholder="Search number or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </form>
        <Select
          value={filters.discipline ?? "all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filters,
              discipline: v === "all" ? undefined : (v as DrawingDiscipline),
              page: 1,
            })
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Discipline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All disciplines</SelectItem>
            {DRAWING_DISCIPLINES.map((d) => (
              <SelectItem key={d} value={d}>
                {DISCIPLINE_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filters,
              status: v === "all" ? undefined : (v as DrawingStatus),
              page: 1,
            })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {DRAWING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={14} aria-hidden />
          CSV
        </Button>
        {rolesData.canWrite && <NewDrawingDialog projectId={projectId} />}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState canWrite={rolesData.canWrite} projectId={projectId} />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead>Revision</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">
                    <Link
                      to="/projects/$projectId/engineering/drawings/$drawingId"
                      params={{ projectId, drawingId: r.id }}
                      className="text-foreground hover:underline"
                    >
                      {r.drawing_number}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={cn(
                      r.current_status === "superseded" && "line-through text-muted-foreground",
                    )}
                  >
                    {r.title}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{DISCIPLINE_LABEL[r.discipline]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.current_revision?.revision_code ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge className={statusBadgeClass(r.current_status)}>
                        {STATUS_LABEL[r.current_status]}
                      </Badge>
                      {r.locked && (
                        <Lock size={12} className="text-muted-foreground" aria-label="Locked" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.current_revision?.issued_at
                      ? new Date(r.current_revision.issued_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to="/projects/$projectId/engineering/drawings/$drawingId"
                        params={{ projectId, drawingId: r.id }}
                      >
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Showing {data.rows.length} of {data.total} drawings.
      </p>
    </div>
  );
}

function EmptyState({ canWrite, projectId }: { canWrite: boolean; projectId: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <FileWarning className="text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No drawings yet</p>
      <p className="text-sm text-muted-foreground">
        Register a drawing number and start uploading revisions.
      </p>
      {canWrite && <NewDrawingDialog projectId={projectId} />}
    </Card>
  );
}

const schema = z.object({
  drawingNumber: z.string().trim().min(1, "Required").max(80),
  title: z.string().trim().min(1, "Required").max(200),
  discipline: z.enum(DRAWING_DISCIPLINES),
});
type FormValues = z.infer<typeof schema>;

function NewDrawingDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const create = useCreateDrawing(projectId);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { drawingNumber: "", title: "", discipline: "electrical" },
  });

  const onSubmit = (values: FormValues) => {
    create.mutate(values, {
      onSuccess: (res) => {
        setOpen(false);
        form.reset();
        navigate({
          to: "/projects/$projectId/engineering/drawings/$drawingId",
          params: { projectId, drawingId: res.id },
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={14} aria-hidden />
          New drawing
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New drawing</DialogTitle>
          <DialogDescription>
            Register the drawing number, title, and discipline. Upload revisions afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="drawing-number">Drawing number</Label>
              <Input
                id="drawing-number"
                placeholder="GM-E-1001"
                {...form.register("drawingNumber")}
              />
              {form.formState.errors.drawingNumber && (
                <span className="text-xs text-destructive">
                  {form.formState.errors.drawingNumber.message}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="discipline">Discipline</Label>
              <Select
                value={form.watch("discipline")}
                onValueChange={(v) => form.setValue("discipline", v as DrawingDiscipline)}
              >
                <SelectTrigger id="discipline">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DRAWING_DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DISCIPLINE_LABEL[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Single-line diagram — inverter bay 01"
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <span className="text-xs text-destructive">
                {form.formState.errors.title.message}
              </span>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" size={14} />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DrawingRegisterTableSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="h-64 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
