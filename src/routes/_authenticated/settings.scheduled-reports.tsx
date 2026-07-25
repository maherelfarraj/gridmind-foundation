// P-117 — Scheduled reports admin UI.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CalendarClock, CheckCircle2, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";

import {
  FREQUENCIES,
  REPORT_TYPES,
  deleteScheduledReport,
  listScheduledReports,
  sendScheduledReport,
  upsertScheduledReport,
  type Frequency,
  type ReportType,
  type ScheduledReportRow,
} from "@/lib/scheduled-reports.functions";
import { listAdminProjects } from "@/lib/portal.functions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SECTION_KEYS = [
  "kpi_summary",
  "milestones",
  "photos",
  "financials",
  "hse",
  "alarms",
  "work_orders",
] as const;

const formSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1, "Name is required").max(120),
    report_type: z.enum(REPORT_TYPES),
    frequency: z.enum(FREQUENCIES),
    project_id: z.string().uuid().nullable(),
    day_of_week: z.number().int().min(0).max(6).nullable(),
    day_of_month: z.number().int().min(1).max(28).nullable(),
    hour_utc: z.number().int().min(0).max(23),
    recipients_raw: z.string().trim().min(1, "At least one recipient"),
    sections: z.record(z.string(), z.boolean()),
    is_active: z.boolean(),
  })
  .refine((v) => v.frequency !== "weekly" || v.day_of_week != null, {
    message: "Day of week required for weekly",
    path: ["day_of_week"],
  })
  .refine(
    (v) => !(v.frequency === "monthly" || v.frequency === "quarterly") || v.day_of_month != null,
    { message: "Day of month required", path: ["day_of_month"] },
  );

type FormValues = z.infer<typeof formSchema>;

export const Route = createFileRoute("/_authenticated/settings/scheduled-reports")({
  component: ScheduledReportsPage,
});

function ScheduledReportsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listScheduledReports);
  const upsert = useServerFn(upsertScheduledReport);
  const remove = useServerFn(deleteScheduledReport);
  const send = useServerFn(sendScheduledReport);
  const projectsFn = useServerFn(listAdminProjects);

  const rowsQ = useQuery({
    queryKey: ["scheduled-reports"],
    queryFn: () => list(),
  });
  const projectsQ = useQuery({
    queryKey: ["admin-projects"],
    queryFn: () => projectsFn(),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReportRow | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Schedule removed");
      qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendMut = useMutation({
    mutationFn: (id: string) => send({ data: { id } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Sent to ${res.recipients_ok} recipient(s)`);
      } else {
        toast.error(res.reason ?? "Send failed");
      }
      qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(r: ScheduledReportRow) {
    setEditing(r);
    setOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scheduled reports</h1>
          <p className="text-sm text-muted-foreground">
            Weekly, monthly, or quarterly PDF reports delivered by email.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New schedule
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {rowsQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rowsQ.error ? (
            <div className="text-sm text-destructive">
              Failed to load: {(rowsQ.error as Error).message}
            </div>
          ) : (rowsQ.data ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No schedules yet. Create one to start delivering recurring PDF reports.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsQ.data!.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.project_name && (
                        <div className="text-xs text-muted-foreground">{r.project_name}</div>
                      )}
                      {!r.is_active && (
                        <Badge variant="outline" className="ml-2">
                          Paused
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.report_type}</Badge>
                    </TableCell>
                    <TableCell>{describeCadence(r)}</TableCell>
                    <TableCell>{r.recipients.length}</TableCell>
                    <TableCell>
                      {r.next_run_at ? (
                        <div className="flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                          {format(new Date(r.next_run_at), "MMM d, HH:mm 'UTC'")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.last_run_at ? (
                        formatDistanceToNowStrict(new Date(r.last_run_at), {
                          addSuffix: true,
                        })
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.last_run_status === "success" && (
                        <Badge className="bg-success/15 text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Success
                        </Badge>
                      )}
                      {r.last_run_status === "error" && (
                        <Badge variant="destructive" title={r.last_run_error ?? undefined}>
                          <XCircle className="mr-1 h-3 w-3" /> Error
                        </Badge>
                      )}
                      {!r.last_run_status && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => sendMut.mutate(r.id)}
                        disabled={sendMut.isPending}
                        title="Send test now"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete schedule "${r.name}"?`)) {
                            deleteMut.mutate(r.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ScheduleDialog
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        projects={projectsQ.data ?? []}
        onSave={async (values) => {
          const recipients = values.recipients_raw
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          await upsert({
            data: {
              id: values.id ?? null,
              name: values.name,
              report_type: values.report_type,
              frequency: values.frequency,
              project_id: values.project_id,
              day_of_week: values.frequency === "weekly" ? values.day_of_week : null,
              day_of_month: values.frequency !== "weekly" ? values.day_of_month : null,
              hour_utc: values.hour_utc,
              recipients,
              template_sections: values.sections,
              is_active: values.is_active,
            },
          });
          toast.success(values.id ? "Schedule updated" : "Schedule created");
          qc.invalidateQueries({ queryKey: ["scheduled-reports"] });
          setOpen(false);
        }}
      />
    </div>
  );
}

function describeCadence(r: ScheduledReportRow): string {
  const time = `${String(r.hour_utc).padStart(2, "0")}:00 UTC`;
  if (r.frequency === "weekly") return `Weekly · ${DOW_LABELS[r.day_of_week ?? 1]} · ${time}`;
  if (r.frequency === "monthly") return `Monthly · day ${r.day_of_month} · ${time}`;
  return `Quarterly · day ${r.day_of_month} · ${time}`;
}

function ScheduleDialog({
  open,
  onOpenChange,
  editing,
  projects,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ScheduledReportRow | null;
  projects: { id: string; name: string }[];
  onSave: (v: FormValues) => Promise<void>;
}) {
  const defaults = useMemo<FormValues>(() => {
    if (editing) {
      return {
        id: editing.id,
        name: editing.name,
        report_type: editing.report_type,
        frequency: editing.frequency,
        project_id: editing.project_id,
        day_of_week: editing.day_of_week,
        day_of_month: editing.day_of_month,
        hour_utc: editing.hour_utc,
        recipients_raw: editing.recipients.join(", "),
        sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, !!editing.template_sections[k]])),
        is_active: editing.is_active,
      };
    }
    return {
      id: null,
      name: "",
      report_type: "om_monthly",
      frequency: "monthly",
      project_id: null,
      day_of_week: 1,
      day_of_month: 1,
      hour_utc: 9,
      recipients_raw: "",
      sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, false])),
      is_active: true,
    };
  }, [editing]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: defaults,
  });

  const freq = form.watch("frequency");
  const sections = form.watch("sections");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit schedule" : "New scheduled report"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await onSave(v);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Save failed");
            }
          })}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input {...form.register("name")} placeholder="Monthly O&M report" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Report type</Label>
              <Select
                value={form.watch("report_type")}
                onValueChange={(v) => form.setValue("report_type", v as ReportType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project (optional)</Label>
              <Select
                value={form.watch("project_id") ?? "__all__"}
                onValueChange={(v) => form.setValue("project_id", v === "__all__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All projects (company-wide)</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={freq}
                onValueChange={(v) => form.setValue("frequency", v as Frequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {freq === "weekly" ? (
              <div className="space-y-2">
                <Label>Day of week</Label>
                <Select
                  value={String(form.watch("day_of_week") ?? 1)}
                  onValueChange={(v) => form.setValue("day_of_week", parseInt(v, 10))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOW_LABELS.map((l, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Day of month (1–28)</Label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  value={form.watch("day_of_month") ?? 1}
                  onChange={(e) => form.setValue("day_of_month", parseInt(e.target.value, 10))}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Hour (UTC)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={form.watch("hour_utc")}
                onChange={(e) => form.setValue("hour_utc", parseInt(e.target.value, 10))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Recipients (comma or newline separated)</Label>
            <Textarea
              rows={3}
              {...form.register("recipients_raw")}
              placeholder="ops@example.com, finance@example.com"
            />
            {form.formState.errors.recipients_raw && (
              <p className="text-xs text-destructive">
                {form.formState.errors.recipients_raw.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Template sections</Label>
            <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
              {SECTION_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={!!sections[k]}
                    onCheckedChange={(v) => form.setValue(`sections.${k}` as never, !!v as never)}
                  />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={form.watch("is_active")}
              onCheckedChange={(v) => form.setValue("is_active", v)}
            />
            <Label>Active</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {editing ? "Save changes" : "Create schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Route-level 404 for non-writers is enforced server-side; the UI is only
// reachable via the settings nav, which itself is gated by role visibility.
void notFound;
