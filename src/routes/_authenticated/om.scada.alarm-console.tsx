// P-174 — Alarm console: acknowledge (P-105), assign, root-cause workflow.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Timer, UserRound } from "lucide-react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { acknowledgeAlarm } from "@/lib/alarms.functions";
import {
  ALARM_SEVERITIES,
  ALARM_STATUSES,
  type AlarmSeverity,
  type AlarmStatus,
} from "@/lib/alarms.rules";
import {
  assignAlarmOwner,
  getAlarmConsole,
  updateAlarmRootCause,
} from "@/lib/alarm-console.functions";
import type { ConsoleAlarmRow } from "@/lib/alarm-console.server";
import {
  RCA_STATUSES,
  RCA_STATUS_LABELS,
  validateRcaTransition,
  type RcaStatus,
} from "@/lib/scada/alarm-workflow";

export const Route = createFileRoute("/_authenticated/om/scada/alarm-console")({
  head: () => ({
    meta: [
      { title: "Alarm console · GridMind EPC" },
      {
        name: "description",
        content:
          "Triage SCADA alarms: acknowledge, assign an owner, and drive the root-cause investigation to closure.",
      },
      { property: "og:title", content: "Alarm console · GridMind EPC" },
      {
        property: "og:description",
        content: "Acknowledge, assign and root-cause SCADA alarms across the operating fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AlarmConsolePage,
});

const SEVERITY_TOKEN: Record<string, string> = {
  critical: "var(--destructive)",
  major: "var(--warning)",
  warning: "var(--secondary)",
  info: "var(--muted-foreground)",
};

function severityBadge(s: string) {
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

function AlarmConsolePage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AlarmStatus | "all">("active");
  const [severity, setSeverity] = useState<AlarmSeverity | "all">("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [ackTarget, setAckTarget] = useState<ConsoleAlarmRow | null>(null);
  const [ackNote, setAckNote] = useState("");
  const [rcaTarget, setRcaTarget] = useState<ConsoleAlarmRow | null>(null);

  const consoleFn = useServerFn(getAlarmConsole);
  const query = useQuery({
    queryKey: ["alarm-console", status, severity, projectFilter],
    queryFn: () =>
      consoleFn({
        data: {
          status: status === "all" ? undefined : status,
          severity: severity === "all" ? undefined : severity,
          projectId: projectFilter === "all" ? undefined : projectFilter,
        },
      }),
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["alarm-console"] });

  const ackFn = useServerFn(acknowledgeAlarm);
  const ackMut = useMutation({
    mutationFn: (vars: { id: string; note: string }) => ackFn({ data: vars }),
    onSuccess: () => {
      toast.success("Alarm acknowledged");
      setAckTarget(null);
      setAckNote("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to acknowledge"),
  });

  const assignFn = useServerFn(assignAlarmOwner);
  const assignMut = useMutation({
    mutationFn: (vars: { id: string; assigned_to: string | null }) => assignFn({ data: vars }),
    onSuccess: () => {
      toast.success("Assignment saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to assign"),
  });

  const rows = query.data?.rows ?? [];
  const kpis = query.data?.kpis;
  const members = query.data?.members ?? [];
  const donutData = useMemo(
    () => (kpis?.bySeverity ?? []).filter((d) => d.count > 0),
    [kpis?.bySeverity],
  );

  return (
    <div className="page-shell">
      <PageHeader
        title="Alarm console"
        description="Acknowledge, assign and root-cause plant alarms — refreshes every 30 seconds."
      />

      <KpiGrid columns={3}>
        <KpiTile
          label="Unacknowledged critical"
          value={
            query.isLoading ? (
              "—"
            ) : (
              <Badge variant="destructive" className="text-base">
                {kpis?.unacknowledgedCritical ?? 0}
              </Badge>
            )
          }
          icon={AlertTriangle}
          status={(kpis?.unacknowledgedCritical ?? 0) > 0 ? "bad" : "good"}
        />
        <KpiTile
          label="Mean time to acknowledge"
          value={kpis?.mttaMinutes != null ? `${kpis.mttaMinutes} min` : "—"}
          icon={Timer}
          hint={kpis?.mttaMinutes == null ? "No acknowledged alarms in range" : undefined}
        />
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Alarms by severity
          </p>
          <div className="h-32">
            {donutData.length === 0 ? (
              <div className="flex h-full items-center text-sm text-muted-foreground">
                No alarms in range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="count"
                    nameKey="severity"
                    innerRadius={28}
                    outerRadius={48}
                  >
                    {donutData.map((d) => (
                      <Cell key={d.severity} fill={SEVERITY_TOKEN[d.severity]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="middle" align="right" layout="vertical" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </KpiGrid>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <CardTitle className="text-sm font-medium">Alarms</CardTitle>
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
                {(query.data?.projects ?? []).map((p) => (
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
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load the alarm console"
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No alarms match these filters" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raised</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Root cause</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDistanceToNow(new Date(row.raised_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>{severityBadge(row.severity)}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "active" ? "default" : "secondary"}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.project_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{row.asset_key ?? "—"}</TableCell>
                    <TableCell className="max-w-sm truncate">{row.message}</TableCell>
                    <TableCell>
                      <Select
                        value={row.assigned_to ?? "none"}
                        onValueChange={(v) =>
                          assignMut.mutate({ id: row.id, assigned_to: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger className="h-8 w-44">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.full_name ?? m.email ?? m.id.slice(0, 8)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{RCA_STATUS_LABELS[row.rca_status]}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap text-right">
                      {row.status === "active" ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setAckTarget(row);
                            setAckNote("");
                          }}
                        >
                          Acknowledge
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => setRcaTarget(row)}>
                        Root cause
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* P-105 acknowledge flow — mandatory note, unchanged semantics. */}
      <Dialog open={!!ackTarget} onOpenChange={(o) => !o && setAckTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge alarm</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ack-note">Acknowledgement note</Label>
            <Textarea
              id="ack-note"
              value={ackNote}
              onChange={(e) => setAckNote(e.target.value)}
              placeholder="What did you observe, and what is the immediate action?"
            />
            {ackNote.trim().length === 0 ? (
              <p className="text-xs text-destructive">A note is required.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAckTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={ackNote.trim().length === 0 || ackMut.isPending}
              onClick={() =>
                ackTarget && ackMut.mutate({ id: ackTarget.id, note: ackNote.trim() })
              }
            >
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RcaDrawer
        row={rcaTarget}
        onClose={() => setRcaTarget(null)}
        onSaved={() => {
          setRcaTarget(null);
          invalidate();
        }}
      />
    </div>
  );
}

function RcaDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: ConsoleAlarmRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const rcaFn = useServerFn(updateAlarmRootCause);
  const [next, setNext] = useState<RcaStatus>("open");
  const [rootCause, setRootCause] = useState("");
  const [notes, setNotes] = useState("");
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);

  if (row && initialisedFor !== row.id) {
    setInitialisedFor(row.id);
    setNext(row.rca_status);
    setRootCause(row.root_cause ?? "");
    setNotes(row.rca_notes ?? "");
  }

  const mut = useMutation({
    mutationFn: (vars: {
      id: string;
      rca_status: RcaStatus;
      root_cause: string | null;
      rca_notes: string | null;
    }) => rcaFn({ data: vars }),
    onSuccess: () => {
      toast.success("Root-cause status updated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message || "Update rejected"),
  });

  const check = row
    ? validateRcaTransition({
        from: row.rca_status,
        to: next,
        rootCause,
        alarmStatus: row.status,
      })
    : ({ ok: true } as const);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full space-y-5 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Root-cause investigation</SheetTitle>
          <SheetDescription>{row?.message}</SheetDescription>
        </SheetHeader>

        <div className="space-y-2">
          <Label>Stage</Label>
          <Select value={next} onValueChange={(v) => setNext(v as RcaStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RCA_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RCA_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Current stage: {row ? RCA_STATUS_LABELS[row.rca_status] : "—"} · owner{" "}
            {row?.assignee_name ?? "unassigned"}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="root-cause">Root cause</Label>
          <Textarea
            id="root-cause"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="Confirmed technical cause"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rca-notes">Investigation notes</Label>
          <Textarea
            id="rca-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Evidence, tests performed, corrective actions"
          />
        </div>

        {!check.ok ? <p className="text-sm text-destructive">{check.message}</p> : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!check.ok || mut.isPending || !row}
            onClick={() =>
              row &&
              mut.mutate({
                id: row.id,
                rca_status: next,
                root_cause: rootCause.trim() ? rootCause.trim() : null,
                rca_notes: notes.trim() ? notes.trim() : null,
              })
            }
          >
            <UserRound className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
