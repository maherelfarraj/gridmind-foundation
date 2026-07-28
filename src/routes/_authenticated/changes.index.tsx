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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, formatRelative } from "@/lib/format";
import { useI18n } from "@/lib/i18n/locale-provider";
import {
  CHANGE_TYPES,
  CR_STATUSES,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type CrStatus,
  type DatePreset,
} from "@/lib/moc.rules";
import { createChangeRequest, listChangeProjects, listChangeRequests } from "@/lib/moc.functions";

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
  const { t } = useI18n();
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
      toast.success(t("adminMod.changes.register.createdToast", { number: created.cr_number }));
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["moc"] });
      void navigate({ to: "/changes/$id", params: { id: created.id } });
    },
    onError: (error: Error) => toast.error(error.message || t("adminMod.changes.register.createFailed")),
  });

  const selectedType = CHANGE_TYPES.find((t) => t.value === form.change_type);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("adminMod.changes.register.title")}
        description={t("adminMod.changes.register.description")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/changes/dashboard">{t("adminMod.changes.register.impactDashboard")}</Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-4" aria-hidden />
              {t("adminMod.changes.register.newChangeRequest")}
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
          placeholder={t("adminMod.changes.register.allStatuses")}
        />
        <Select
          value={changeType}
          onValueChange={(v) => {
            setChangeType(v);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by change type">
            <SelectValue placeholder={t("adminMod.changes.register.allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminMod.changes.register.allTypes")}</SelectItem>
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
            <SelectValue placeholder={t("adminMod.changes.register.allProjects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminMod.changes.register.allProjects")}</SelectItem>
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
            placeholder={t("adminMod.changes.register.searchPlaceholder")}
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
          title={t("adminMod.changes.register.loadError")}
          description={t("adminMod.changes.register.loadErrorDesc")}
          action={
            <Button variant="outline" onClick={() => void list.refetch()}>
              {t("adminMod.approvals.retry")}
            </Button>
          }
        />
      ) : null}

      {list.data && list.data.rows.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title={t("adminMod.changes.register.noMatches")}
          description={t("adminMod.changes.register.noMatchesDesc")}
          action={<Button onClick={() => setCreateOpen(true)}>{t("adminMod.changes.register.newChangeRequest")}</Button>}
        />
      ) : null}

      {list.data && list.data.rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminMod.changes.register.crCol")}</TableHead>
                <TableHead>{t("adminMod.changes.register.titleCol")}</TableHead>
                <TableHead>{t("adminMod.changes.register.typeCol")}</TableHead>
                <TableHead>{t("adminMod.changes.register.statusCol")}</TableHead>
                <TableHead>{t("adminMod.changes.register.originatorCol")}</TableHead>
                <TableHead className="text-right">{t("adminMod.changes.register.costImpactCol")}</TableHead>
                <TableHead className="text-right">{t("adminMod.changes.register.scheduleCol")}</TableHead>
                <TableHead className="text-right">{t("adminMod.changes.register.ageCol")}</TableHead>
                <TableHead>{t("adminMod.changes.register.updatedCol")}</TableHead>
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
                    {row.schedule_impact_days == null ? "—" : t("adminMod.changes.register.daysSuffix", { value: row.schedule_impact_days })}
                  </TableCell>
                  <TableCell className="text-right">{t("adminMod.changes.register.daysSuffix", { value: row.age_days })}</TableCell>
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
            {t("adminMod.changes.register.pageOf", {
              page: list.data.page,
              total: Math.ceil(list.data.total / list.data.pageSize),
              count: list.data.total,
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("adminMod.changes.register.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(list.data.total / list.data.pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("adminMod.changes.register.next")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("adminMod.changes.register.newDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("adminMod.changes.register.newDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cr-type">{t("adminMod.changes.register.changeType")}</Label>
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
              <Label htmlFor="cr-title">{t("adminMod.changes.register.titleLabel")}</Label>
              <Input
                id="cr-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-desc">{t("adminMod.changes.register.descriptionLabel")}</Label>
              <Textarea
                id="cr-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-reason">{t("adminMod.changes.register.reasonLabel")}</Label>
              <Textarea
                id="cr-reason"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-project">{t("adminMod.changes.register.projectLabel")}</Label>
              <Select
                value={form.project_id}
                onValueChange={(v) => setForm((f) => ({ ...f, project_id: v }))}
              >
                <SelectTrigger id="cr-project">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("adminMod.changes.register.noProject")}</SelectItem>
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
              {t("adminMod.changes.register.cancel")}
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
              {t("adminMod.changes.register.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
