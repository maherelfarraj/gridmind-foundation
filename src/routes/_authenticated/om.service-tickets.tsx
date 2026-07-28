// P-109 — Service tickets workspace with SLA countdown + breach log.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Inbox, Search, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ServiceTicketDialog } from "@/components/service-tickets/service-ticket-dialog";
import { ServiceTicketDrawer } from "@/components/service-tickets/service-ticket-drawer";
import { SlaCountdownChip } from "@/components/service-tickets/sla-countdown-chip";
import {
  listBreaches,
  listTicketProjects,
  listTickets,
  type BreachLogRow,
  type TicketRow,
} from "@/lib/service-tickets.functions";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/service-tickets.rules";
import { WORK_ORDER_PRIORITIES, type WorkOrderPriority } from "@/lib/work-orders.rules";
import { useI18n } from "@/lib/i18n/locale-provider";

export const Route = createFileRoute("/_authenticated/om/service-tickets")({
  head: () => ({
    meta: [
      { title: "Service Tickets · GridMind EPC" },
      {
        name: "description",
        content:
          "Track service tickets, SLA response/resolution timers, breaches, and SLA credits.",
      },
    ],
  }),
  component: ServiceTicketsPage,
  errorComponent: ({ error, reset }) => {
    const { t } = useI18n();
    return (
      <div className="page-shell">
        <EmptyState
          icon={ShieldAlert}
          title={t("omMod.serviceTickets.loadFailed")}
          description={error.message}
          action={
            <Button size="sm" onClick={reset}>
              {t("omMod.common.retry")}
            </Button>
          }
        />
      </div>
    );
  },
});

function priorityBadge(p: WorkOrderPriority, t: ReturnType<typeof useI18n>["t"]) {
  const cls =
    p === "emergency"
      ? "bg-destructive text-destructive-foreground"
      : p === "high"
        ? "bg-warning text-warning-foreground"
        : p === "medium"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground";
  return <Badge className={cls}>{t(`omMod.workOrderPriority.${p}`)}</Badge>;
}

function toTicketCsv(rows: TicketRow[]): string {
  const header = [
    "Ticket",
    "Title",
    "Project",
    "Priority",
    "Status",
    "Assignee",
    "Created",
    "Response due",
    "Resolution due",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.ticket_number,
      r.title,
      r.project_name ?? "",
      r.priority,
      r.status,
      r.assignee_name ?? "",
      r.created_at,
      r.sla?.response_due_at ?? "",
      r.sla?.resolution_due_at ?? "",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function toBreachCsv(rows: BreachLogRow[]): string {
  const header = [
    "Ticket",
    "Title",
    "Project",
    "Priority",
    "Breach type",
    "Breach minutes",
    "Credit %",
    "Credit amount",
    "Currency",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const types: string[] = [];
    if (r.response_breached) types.push("response");
    if (r.resolution_breached) types.push("resolution");
    const cells = [
      r.ticket_number,
      r.title,
      r.project_name ?? "",
      r.priority,
      types.join("+"),
      String(r.breach_minutes),
      String(r.credit_pct),
      r.credit_amount != null ? String(r.credit_amount) : "",
      r.currency_code ?? "",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ServiceTicketsPage() {
  const { t } = useI18n();
  const listFn = useServerFn(listTickets);
  const projectsFn = useServerFn(listTicketProjects);
  const breachesFn = useServerFn(listBreaches);

  const [q, setQ] = useState("");
  const [projectId, setProjectId] = useState("all");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [drawer, setDrawer] = useState<TicketRow | null>(null);

  const projects = useQuery({
    queryKey: ["ticket-projects"],
    queryFn: () => projectsFn(),
  });

  const filters = useMemo(
    () => ({
      project_id: projectId === "all" ? undefined : projectId,
      status: status === "all" ? undefined : (status as TicketStatus),
      priority: priority === "all" ? undefined : (priority as WorkOrderPriority),
      q: q || undefined,
    }),
    [projectId, status, priority, q],
  );

  const ticketsQ = useQuery({
    queryKey: ["service-tickets", filters],
    queryFn: () => listFn({ data: filters }),
    refetchInterval: 60_000,
  });

  const breachesQ = useQuery({
    queryKey: ["breach-log", filters.project_id],
    queryFn: () => breachesFn({ data: { project_id: filters.project_id } }),
    refetchInterval: 60_000,
  });

  const rows = (ticketsQ.data ?? []) as TicketRow[];
  const breaches = (breachesQ.data ?? []) as BreachLogRow[];

  return (
    <div className="page-shell">
      <PageHeader
        title={t("omMod.serviceTickets.title")}
        description={t("omMod.serviceTickets.description")}
        actions={<ServiceTicketDialog />}
      />

      <Tabs defaultValue="tickets">
        <TabsList>
          <TabsTrigger value="tickets">
            {t("omMod.serviceTickets.ticketsTab")}{" "}
            <span className="ms-1 text-xs text-muted-foreground">{rows.length}</span>
          </TabsTrigger>
          <TabsTrigger value="breaches">
            {t("omMod.serviceTickets.breachesTab")}{" "}
            <span className="ms-1 text-xs text-muted-foreground">{breaches.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">{t("omMod.serviceTickets.openWorkload")}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={rows.length === 0}
                onClick={() =>
                  download(
                    `service-tickets-${new Date().toISOString().slice(0, 10)}.csv`,
                    toTicketCsv(rows),
                  )
                }
              >
                <Download className="me-2 h-4 w-4" /> {t("omMod.common.csv")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-64 ps-8"
                    placeholder={t("omMod.serviceTickets.searchPlaceholder")}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t("omMod.common.allProjects")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("omMod.common.allProjects")}</SelectItem>
                    {(projects.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={t("omMod.common.allStatuses")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("omMod.common.allStatuses")}</SelectItem>
                    {TICKET_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`omMod.ticketStatus.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={t("omMod.common.allSeverities")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("omMod.common.allSeverities")}</SelectItem>
                    {WORK_ORDER_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`omMod.workOrderPriority.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {ticketsQ.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title={t("omMod.serviceTickets.noTicketsTitle")}
                  description={t("omMod.serviceTickets.noTicketsDescription")}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("omMod.serviceTickets.colTicket")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colTitle")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colPriority")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colStatus")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colAssignee")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colResponse")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colResolution")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id} className="cursor-pointer" onClick={() => setDrawer(row)}>
                        <TableCell className="font-mono text-xs">{row.ticket_number}</TableCell>
                        <TableCell>
                          <div className="text-sm">{row.title}</div>
                          <div className="text-xs text-muted-foreground">{row.project_name}</div>
                        </TableCell>
                        <TableCell>{priorityBadge(row.priority, t)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{t(`omMod.ticketStatus.${row.status}`)}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.assignee_name ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <SlaCountdownChip
                            createdAtISO={row.created_at}
                            dueAtISO={row.sla?.response_due_at}
                          />
                        </TableCell>
                        <TableCell>
                          <SlaCountdownChip
                            createdAtISO={row.created_at}
                            dueAtISO={row.sla?.resolution_due_at}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breaches" className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">{t("omMod.serviceTickets.breachLogTitle")}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={breaches.length === 0}
                onClick={() =>
                  download(
                    `sla-breaches-${new Date().toISOString().slice(0, 10)}.csv`,
                    toBreachCsv(breaches),
                  )
                }
              >
                <Download className="me-2 h-4 w-4" /> {t("omMod.common.csv")}
              </Button>
            </CardHeader>
            <CardContent>
              {breachesQ.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : breaches.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title={t("omMod.serviceTickets.noBreachesTitle")}
                  description={t("omMod.serviceTickets.noBreachesDescription")}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("omMod.serviceTickets.colTicket")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colTitle")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colBreach")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colMinutes")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colCreditPct")}</TableHead>
                      <TableHead>{t("omMod.serviceTickets.colCreditAmount")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breaches.map((b) => {
                      const types: string[] = [];
                      if (b.response_breached) types.push(t("omMod.serviceTickets.breachResponse"));
                      if (b.resolution_breached) types.push(t("omMod.serviceTickets.breachResolution"));
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-mono text-xs">{b.ticket_number}</TableCell>
                          <TableCell>
                            <div className="text-sm">{b.title}</div>
                            <div className="text-xs text-muted-foreground">{b.project_name}</div>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-destructive text-destructive-foreground">
                              {types.join(" + ")}
                            </Badge>
                          </TableCell>
                          <TableCell>{b.breach_minutes}</TableCell>
                          <TableCell>{b.credit_pct}%</TableCell>
                          <TableCell>
                            {b.credit_amount != null
                              ? `${b.credit_amount} ${b.currency_code ?? ""}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ServiceTicketDrawer
        ticket={drawer}
        open={!!drawer}
        onOpenChange={(o) => !o && setDrawer(null)}
      />
    </div>
  );
}
