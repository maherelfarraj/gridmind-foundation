// P-105 — Alarms list + acknowledge UI.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, BellRing, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { listAlarms, acknowledgeAlarm, type AlarmRow } from "@/lib/alarms.functions";
import {
  ALARM_SEVERITIES,
  ALARM_STATUSES,
  acknowledgeInputSchema,
  type AlarmSeverity,
  type AlarmStatus,
} from "@/lib/alarms.rules";

export const Route = createFileRoute("/_authenticated/om/scada/alarms")({
  head: () => ({
    meta: [
      { title: "SCADA alarms · GridMind EPC" },
      {
        name: "description",
        content:
          "Active and historical SCADA alarms with severity filters and acknowledge workflow.",
      },
      { property: "og:title", content: "SCADA alarms · GridMind EPC" },
      { property: "og:description", content: "Alarm inbox for O&M teams." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlarmsPage,
});

function severityBadge(s: AlarmSeverity) {
  const cls =
    s === "critical"
      ? "bg-destructive text-destructive-foreground"
      : s === "major"
        ? "bg-warning text-warning-foreground"
        : s === "warning"
          ? "bg-secondary text-secondary-foreground"
          : "bg-muted text-muted-foreground";
  return <Badge className={cls}>{s}</Badge>;
}

function statusBadge(s: AlarmStatus) {
  const variant: "default" | "secondary" | "outline" =
    s === "active" ? "default" : s === "acknowledged" ? "secondary" : "outline";
  return <Badge variant={variant}>{s}</Badge>;
}

function AlarmsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AlarmStatus | "all">("active");
  const [severity, setSeverity] = useState<AlarmSeverity | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [ackTarget, setAckTarget] = useState<AlarmRow | null>(null);

  const listFn = useServerFn(listAlarms);
  const query = useQuery({
    queryKey: ["alarms", status, severity],
    queryFn: () =>
      listFn({
        data: {
          status: status === "all" ? undefined : status,
          severity: severity === "all" ? undefined : severity,
        },
      }),
    refetchInterval: 30_000,
  });

  const rows = query.data ?? [];
  const filtered = useMemo(
    () => (projectFilter === "all" ? rows : rows.filter((r) => r.project_id === projectFilter)),
    [rows, projectFilter],
  );
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.project_name) seen.set(r.project_id, r.project_name);
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [rows]);

  const ackFn = useServerFn(acknowledgeAlarm);
  const form = useForm<{ id: string; note: string }>({
    resolver: zodResolver(acknowledgeInputSchema),
    defaultValues: { id: "", note: "" },
  });
  const ackMut = useMutation({
    mutationFn: (vars: { id: string; note: string }) => ackFn({ data: vars }),
    onSuccess: () => {
      toast.success("Alarm acknowledged");
      setAckTarget(null);
      form.reset({ id: "", note: "" });
      qc.invalidateQueries({ queryKey: ["alarms"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to acknowledge"),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BellRing className="h-6 w-6" /> SCADA alarms
          </h1>
          <p className="text-sm text-muted-foreground">
            Live plant health signals. Auto-refreshes every 30s.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Filters</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {ALARM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {ALARM_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <div className="flex flex-col items-start gap-2 p-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" /> Failed to load alarms.
              </div>
              <Button variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <div className="font-medium">No active alarms — plant healthy</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raised</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDistanceToNow(new Date(row.raised_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>{severityBadge(row.severity)}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>{row.project_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.asset_key ?? "—"}</TableCell>
                    <TableCell>{row.rule_name ?? "—"}</TableCell>
                    <TableCell className="max-w-sm truncate">{row.message}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.value != null ? row.value : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "active" ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setAckTarget(row);
                            form.reset({ id: row.id, note: "" });
                          }}
                        >
                          Acknowledge
                        </Button>
                      ) : row.acknowledge_note ? (
                        <span className="text-xs text-muted-foreground">
                          {row.acknowledge_note}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!ackTarget} onOpenChange={(o) => !o && setAckTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge alarm</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => ackMut.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note (required)</FormLabel>
                    <FormControl>
                      <Textarea rows={4} placeholder="Root cause / action taken" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAckTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={ackMut.isPending}>
                  {ackMut.isPending ? "Saving…" : "Acknowledge"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
