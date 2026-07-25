// P-093 — Commissioning test board.
import { useMemo, useState } from "react";
import {
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Download, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  COMMISSIONING_TEST_STATUSES,
  COMMISSIONING_TEST_TYPES,
  COMMISSIONING_TEST_TYPE_LABELS,
  assignCommissioningTests,
  listCommissioningAssignees,
  listCommissioningTests,
  type CommissioningTestRow,
  type CommissioningTestStatus,
  type CommissioningTestType,
} from "@/lib/commissioning.functions";

export const Route = createFileRoute(
  "/_authenticated/projects/$projectId/commissioning",
)({
  head: () => ({
    meta: [
      { title: "Commissioning — GridMind EPC" },
      {
        name: "description",
        content:
          "Commissioning test board: assign, filter and track site test progress.",
      },
      { property: "og:title", content: "Commissioning — GridMind EPC" },
      {
        property: "og:description",
        content:
          "Commissioning test board: assign, filter and track site test progress.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommissioningBoard,
});

const STATUS_LABELS: Record<CommissioningTestStatus, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  passed: "Passed",
  failed: "Failed",
  on_hold: "On hold",
};

function statusTint(s: CommissioningTestStatus): string {
  switch (s) {
    case "passed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "failed":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "in_progress":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
    case "scheduled":
      return "bg-primary/15 text-primary border-primary/30";
    case "on_hold":
      return "bg-muted text-muted-foreground border-border";
    case "not_started":
    default:
      return "bg-secondary text-secondary-foreground border-border";
  }
}

function CommissioningBoard() {
  const { projectId } = Route.useParams();
  const [testType, setTestType] = useState<CommissioningTestType | null>(null);
  const [status, setStatus] = useState<CommissioningTestStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useQuery({
    queryKey: [
      "commissioning-tests",
      projectId,
      testType,
      status,
      search,
    ] as const,
    queryFn: () =>
      listCommissioningTests({
        data: {
          projectId,
          testType: testType ?? null,
          status: status === "all" ? null : status,
          search: search.trim() || null,
        },
      }),
  });

  const rows = query.data?.rows ?? [];
  const canWrite = query.data?.canWrite ?? false;

  const groups = useMemo(() => {
    const byArea = new Map<string, CommissioningTestRow[]>();
    for (const r of rows) {
      const list = byArea.get(r.area) ?? [];
      list.push(r);
      byArea.set(r.area, list);
    }
    return Array.from(byArea.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Commissioning test board
          </h2>
          <p className="text-sm text-muted-foreground">
            Stage 6 — assign, track and close out site tests by area.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(rows)}
            disabled={rows.length === 0}
          >
            <Download size={14} aria-hidden />
            CSV
          </Button>
          {canWrite ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus size={14} aria-hidden />
              Assign tests
            </Button>
          ) : null}
        </div>
      </header>

      {/* filters */}
      <Card className="border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={testType === null}
            onClick={() => setTestType(null)}
            label="All types"
          />
          {COMMISSIONING_TEST_TYPES.filter((t) => t !== "other").map((t) => (
            <FilterChip
              key={t}
              active={testType === t}
              onClick={() => setTestType(testType === t ? null : t)}
              label={COMMISSIONING_TEST_TYPE_LABELS[t]}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search area, equipment, string or notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {COMMISSIONING_TEST_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* body */}
      {query.isLoading ? (
        <BoardSkeleton />
      ) : query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState canWrite={canWrite} onAssign={() => setDialogOpen(true)} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(([area, list]) => (
            <AreaSection key={area} area={area} rows={list} />
          ))}
        </div>
      )}

      <AssignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area section
// ---------------------------------------------------------------------------
function AreaSection({
  area,
  rows,
}: {
  area: string;
  rows: CommissioningTestRow[];
}) {
  const [open, setOpen] = useState(true);
  const counts = useMemo(() => {
    const c: Record<CommissioningTestStatus, number> = {
      not_started: 0,
      scheduled: 0,
      in_progress: 0,
      passed: 0,
      failed: 0,
      on_hold: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  return (
    <Card className="border-border bg-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <span className="font-display text-base font-semibold text-foreground">
                {area}
              </span>
              <span className="text-xs text-muted-foreground">
                {rows.length} test{rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  "not_started",
                  "scheduled",
                  "in_progress",
                  "passed",
                  "failed",
                  "on_hold",
                ] as CommissioningTestStatus[]
              )
                .filter((s) => counts[s] > 0)
                .map((s) => (
                  <span
                    key={s}
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                      statusTint(s),
                    )}
                  >
                    {STATUS_LABELS[s]}: {counts[s]}
                  </span>
                ))}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test type</TableHead>
                  <TableHead>Equipment / String</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Witness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {COMMISSIONING_TEST_TYPE_LABELS[r.test_type]}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[r.equipment_ref, r.string_ref]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.assigned_email ?? (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.planned_date ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("border", statusTint(r.status))}
                      >
                        {STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.utility_witness_required ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <ShieldCheck size={12} aria-hidden />
                          Required
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assign dialog
// ---------------------------------------------------------------------------
const assignSchema = z.object({
  area: z.string().trim().min(1, "Area is required").max(120),
  testTypes: z
    .array(z.enum(COMMISSIONING_TEST_TYPES))
    .min(1, "Pick at least one test type"),
  equipmentRef: z.string().trim().max(120).optional(),
  stringRef: z.string().trim().max(120).optional(),
  assignedTo: z.string().uuid().optional().or(z.literal("")),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  utilityWitnessRequired: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});

type AssignForm = z.infer<typeof assignSchema>;

function AssignDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  const router = useRouter();

  const assignees = useQuery({
    queryKey: ["commissioning-assignees", projectId] as const,
    queryFn: () => listCommissioningAssignees({ data: { projectId } }),
    enabled: open,
  });

  const form = useForm<AssignForm>({
    resolver: zodResolver(assignSchema) as any,
    defaultValues: {
      area: "",
      testTypes: [],
      equipmentRef: "",
      stringRef: "",
      assignedTo: "",
      plannedDate: "",
      utilityWitnessRequired: false,
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: AssignForm) =>
      assignCommissioningTests({
        data: {
          projectId,
          area: values.area,
          testTypes: values.testTypes,
          equipmentRef: values.equipmentRef || null,
          stringRef: values.stringRef || null,
          assignedTo: values.assignedTo || null,
          plannedDate: values.plannedDate || null,
          utilityWitnessRequired: values.utilityWitnessRequired,
          notes: values.notes || null,
        },
      }),
    onSuccess: (data) => {
      toast.success(
        `Assigned ${data.ids.length} test${data.ids.length === 1 ? "" : "s"}`,
      );
      qc.invalidateQueries({ queryKey: ["commissioning-tests", projectId] });
      form.reset();
      onOpenChange(false);
      router.invalidate();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to assign tests";
      toast.error(message);
    },
  });

  const selected = form.watch("testTypes") ?? [];
  const toggleType = (t: CommissioningTestType) => {
    const set = new Set(selected);
    if (set.has(t)) set.delete(t);
    else set.add(t);
    form.setValue("testTypes", Array.from(set) as CommissioningTestType[], {
      shouldValidate: true,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign commissioning tests</DialogTitle>
          <DialogDescription>
            Creates one test row per selected type for this area.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="area">Area *</Label>
            <Input
              id="area"
              placeholder="e.g. Array Block 1"
              {...form.register("area")}
            />
            {form.formState.errors.area ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.area.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Test types *</Label>
            <div className="grid grid-cols-2 gap-2">
              {COMMISSIONING_TEST_TYPES.map((t) => (
                <label
                  key={t}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={selected.includes(t)}
                    onCheckedChange={() => toggleType(t)}
                  />
                  <span>{COMMISSIONING_TEST_TYPE_LABELS[t]}</span>
                </label>
              ))}
            </div>
            {form.formState.errors.testTypes ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.testTypes.message as string}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="equipmentRef">Equipment ref</Label>
              <Input id="equipmentRef" {...form.register("equipmentRef")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stringRef">String ref</Label>
              <Input id="stringRef" {...form.register("stringRef")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="assignedTo">Assignee</Label>
              <Select
                value={form.watch("assignedTo") || ""}
                onValueChange={(v) =>
                  form.setValue("assignedTo", v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {(assignees.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.email ?? m.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="plannedDate">Planned date</Label>
              <Input
                id="plannedDate"
                type="date"
                {...form.register("plannedDate")}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                Utility witness required
              </p>
              <p className="text-xs text-muted-foreground">
                Hipot always requires a utility witness.
              </p>
            </div>
            <Switch
              checked={form.watch("utilityWitnessRequired")}
              onCheckedChange={(v) => form.setValue("utilityWitnessRequired", v)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" {...form.register("notes")} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : null}
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// helpers: filter chip, states, csv
// ---------------------------------------------------------------------------
function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="border-border bg-card p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-24 w-full" />
        </Card>
      ))}
    </div>
  );
}

function BoardError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-destructive/40 bg-card p-6">
      <h3 className="font-display text-lg font-semibold text-foreground">
        Couldn&rsquo;t load commissioning tests
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Something went wrong loading the board. Try again.
      </p>
      <Button className="mt-3" size="sm" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden />
        Retry
      </Button>
    </Card>
  );
}

function EmptyState({
  canWrite,
  onAssign,
}: {
  canWrite: boolean;
  onAssign: () => void;
}) {
  return (
    <Card className="flex flex-col items-start gap-3 border-border bg-card p-6">
      <h3 className="font-display text-lg font-semibold text-foreground">
        No commissioning tests assigned yet
      </h3>
      <p className="text-sm text-muted-foreground">
        Group tests by area and assign them to your commissioning team to get
        started.
      </p>
      {canWrite ? (
        <Button size="sm" onClick={onAssign}>
          <Plus size={14} aria-hidden />
          Assign tests
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          You don&rsquo;t have permission to assign tests.
        </p>
      )}
    </Card>
  );
}

function exportCsv(rows: CommissioningTestRow[]) {
  const header = [
    "area",
    "test_type",
    "equipment_ref",
    "string_ref",
    "status",
    "assignee_email",
    "planned_date",
    "utility_witness_required",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.area,
      r.test_type,
      r.equipment_ref ?? "",
      r.string_ref ?? "",
      r.status,
      r.assigned_email ?? "",
      r.planned_date ?? "",
      String(r.utility_witness_required),
      (r.notes ?? "").replace(/\s+/g, " "),
    ].map(csvCell);
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commissioning-tests-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
