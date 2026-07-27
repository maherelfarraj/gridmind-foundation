// P-190 — Change control register.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitPullRequestArrow, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChangeTypeBadge } from "@/components/moc/change-type-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { MultiSelect } from "@/components/ui/multi-select";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatRelative } from "@/lib/format";
import {
  CHANGE_TYPES,
  CR_STATUSES,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type CrStatus,
  type DatePreset,
} from "@/lib/moc.rules";
import {
  createChangeRequest,
  listChangeProjects,
  listChangeRequests,
} from "@/lib/moc.functions";

export const Route = createFileRoute("/_authenticated/changes/")({
  validateSearch: (raw: Record<string, unknown>) => ({
    status: typeof raw.status === "string" ? raw.status : undefined,
    type: typeof raw.type === "string" ? raw.type : undefined,
    project: typeof raw.project === "string" ? raw.project : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Change control — GridMind EPC" },
      {
        name: "description",
        content: "Register of engineering, vendor and site change requests with impact and status.",
      },
    ],
  }),
  component: ChangeRegister,
});

const ALL = "__all__";

function ChangeRegister() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch() as {
    status?: string;
    type?: string;
    project?: string;
  };

  const [statuses, setStatuses] = useState<CrStatus[]>(
    search.status ? [search.status as CrStatus] : [],
  );
  const [changeType, setChangeType] = useState<string>(search.type ?? ALL);
  const [projectId, setProjectId] = useState<string>(search.project ?? ALL);
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [text, setText] = useState("");
  const [appliedText, setAppliedText] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchList = useServerFn(listChangeRequests);
  const fetchProjects = useServerFn(listChangeProjects);
  const create = useServerFn(createChangeRequest);

  const filters = {
    statuses,
    changeType: changeType === ALL ? null : changeType,
    projectId: projectId === ALL ? null : projectId,
    datePreset,
    search: appliedText,
    page,
  };

  const list = useQuery({
    queryKey: ["moc", "register", filters],
    queryFn: () => fetchList({ data: filters }),
  });
  const projects = useQuery({
    queryKey: ["moc", "projects"],
    queryFn: () => fetchProjects(),
  });

  const [form, setForm] = useState({
    change_type: CHANGE_TYPES[0].value,
    title: "",
    description: "",
    reason: "",
    project_id: ALL,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          change_type: form.change_type,
          title: form.title,
          description: form.description,
          reason: form.reason,
          project_id: form.project_id === ALL ? null : form.project_id,
        },
      }),
    onSuccess: (created) => {
      toast.success(`${created.cr_number} created`);
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["moc"] });
      void navigate({ to: "/changes/$id", params: { id: created.id } });
    },
    onError: (error: Error) => toast.error(error.message || "Could not create the change request"),
  });

  const selectedType = CHANGE_TYPES.find((t) => t.value === form.change_type);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Change control"
        description="Every deviation from the approved baseline, assessed and routed for approval."
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/changes/dashboard">Impact dashboard</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-4" aria-hidden />
              New change request
            </Button>
          </>
        }
      />

      <Card className="grid gap-3 p-4 lg:grid-cols-5">
        <MultiSelect
          aria-label="Filter by status"
          options={CR_STATUSES.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))}
          value={statuses}
          onChange={(next) => {
            setStatuses(next as CrStatus[]);
            setPage(1);
          }}
          placeholder="All statuses"
        />
        <Select
          value={changeType}
          onValueChange={(v) => {
            setChangeType(v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by change type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {CHANGE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={projectId}
          onValueChange={(v) => {
            setProjectId(v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by project">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {(projects.data?.rows ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={datePreset}
          onValueChange={(v) => {
            setDatePreset(v as DatePreset);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {DATE_PRESET_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedText(text.trim());
            setPage(1);
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search title or CR number"
            aria-label="Search change requests"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <Search className="size-4" aria-hidden />
          </Button>
        </form>
      </Card>

      {list.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : null}

      {list.isError ? (
        <EmptyState
          title="Could not load change requests"
          description="The register could not be read."
          action={
            <Button variant="outline" onClick={() => void list.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {list.data && list.data.rows.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title="No change requests match"
          description="Adjust the filters, or raise the first change request."
          action={<Button onClick={() => setCreateOpen(true)}>New change request</Button>}
        />
      ) : null}

      {list.data && list.data.rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CR</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Originator</TableHead>
                <TableHead className="text-right">Cost impact</TableHead>
                <TableHead className="text-right">Schedule</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => void navigate({ to: "/changes/$id", params: { id: row.id } })}
                >
                  <TableCell className="font-mono text-xs">{row.cr_number}</TableCell>
                  <TableCell className="max-w-xs truncate">{row.title}</TableCell>
                  <TableCell>
                    <ChangeTypeBadge type={row.change_type} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.originator_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.cost_impact == null ? "—" : formatMoney(row.cost_impact, "USD")}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.schedule_impact_days == null ? "—" : `${row.schedule_impact_days} d`}
                  </TableCell>
                  <TableCell className="text-right">{row.age_days} d</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelative(row.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}

      {list.data && list.data.total > list.data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {list.data.page} of {Math.ceil(list.data.total / list.data.pageSize)} ·{" "}
            {list.data.total} change requests
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(list.data.total / list.data.pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New change request</DialogTitle>
            <DialogDescription>
              Describe what is changing and why. A CR number is assigned automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cr-type">Change type</Label>
              <Select
                value={form.change_type}
                onValueChange={(v) => setForm((f) => ({ ...f, change_type: v }))}
              >
                <SelectTrigger id="cr-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType ? (
                <p className="text-xs text-muted-foreground">{selectedType.description}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-title">Title</Label>
              <Input
                id="cr-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-desc">Description</Label>
              <Textarea
                id="cr-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-reason">Reason</Label>
              <Textarea
                id="cr-reason"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-project">Project</Label>
              <Select
                value={form.project_id}
                onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}
              >
                <SelectTrigger id="cr-project">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>No project</SelectItem>
                  {(projects.data?.rows ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                form.title.trim().length < 3 ||
                form.description.trim().length < 3 ||
                form.reason.trim().length < 3
              }
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
