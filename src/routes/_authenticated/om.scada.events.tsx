// P-174 — SCADA event timeline: cursor-paginated vertical log of record.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNow } from "date-fns";
import { Activity, AlertTriangle, History } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getScadaEventTimeline } from "@/lib/scada-timeline.functions";
import type { TimelineEvent } from "@/lib/scada-timeline.server";
import { SCADA_EVENT_SEVERITIES, SCADA_EVENT_TYPES } from "@/lib/scada/events";

export const Route = createFileRoute("/_authenticated/om/scada/events")({
  head: () => ({
    meta: [
      { title: "SCADA event timeline · GridMind EPC" },
      {
        name: "description",
        content:
          "Chronological SCADA log of record: trips, warnings, status changes and operator actions across the fleet.",
      },
      { property: "og:title", content: "SCADA event timeline · GridMind EPC" },
      {
        property: "og:description",
        content: "Filterable, paginated timeline of plant events and operator actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EventTimelinePage,
});

function typeBadge(t: string) {
  const cls =
    t === "trip" || t === "protection"
      ? "bg-destructive text-destructive-foreground"
      : t === "warning" || t === "comm_failure"
        ? "bg-warning text-warning-foreground"
        : t === "operator_action" || t === "setpoint_change"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground";
  return <Badge className={cls}>{t.replaceAll("_", " ")}</Badge>;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function EventTimelinePage() {
  const [eventType, setEventType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [nodeId, setNodeId] = useState("all");

  const listFn = useServerFn(getScadaEventTimeline);
  const query = useInfiniteQuery({
    queryKey: ["scada-events-timeline", eventType, severity, nodeId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listFn({
        data: {
          eventType: eventType === "all" ? undefined : (eventType as never),
          severity: severity === "all" ? undefined : (severity as never),
          nodeId: nodeId === "all" ? undefined : nodeId,
          cursor: pageParam,
          limit: 40,
        },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const pages = query.data?.pages ?? [];
  const events: TimelineEvent[] = pages.flatMap((p) => p.events);
  const nodes = pages[0]?.nodes ?? [];

  return (
    <div className="page-shell">
      <PageHeader
        title="Event timeline"
        description="Every trip, warning, status change and operator action, newest first."
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {SCADA_EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {SCADA_EVENT_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={nodeId} onValueChange={setNodeId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All asset nodes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All asset nodes</SelectItem>
                {nodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load the event timeline"
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : events.length === 0 ? (
            <EmptyState
              icon={History}
              title="No events recorded"
              description="Events appear as soon as a connector streams them or an operator logs an action."
            />
          ) : (
            <>
              <ol className="relative space-y-4 border-l border-border pl-6">
                {events.map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className="absolute -left-[27px] top-2 size-2.5 rounded-full bg-primary"
                      aria-hidden
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {typeBadge(e.event_type)}
                      <Badge variant="outline">{e.severity}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(e.occurred_at), "yyyy-MM-dd HH:mm:ss")} ·{" "}
                        {formatDistanceToNow(new Date(e.occurred_at), { addSuffix: true })}
                      </span>
                      {e.event_type === "operator_action" || e.actor_id ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Avatar className="size-5">
                            {e.actor_avatar ? <AvatarImage src={e.actor_avatar} alt="" /> : null}
                            <AvatarFallback className="text-[10px]">
                              {initials(e.actor_name)}
                            </AvatarFallback>
                          </Avatar>
                          {e.actor_name ?? "Operator"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-foreground">{e.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.code ? <span className="font-mono">{e.code} · </span> : null}
                      {e.asset_node_id ? (
                        <Link
                          to="/om/scada/assets/$nodeId"
                          params={{ nodeId: e.asset_node_id }}
                          className="underline underline-offset-2"
                        >
                          {e.node_name ?? e.node_tag ?? "Asset node"}
                        </Link>
                      ) : (
                        (e.project_name ?? "—")
                      )}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="mt-6 flex justify-center">
                {query.hasNextPage ? (
                  <Button
                    variant="outline"
                    onClick={() => query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                  >
                    <Activity className="mr-1 h-4 w-4" />
                    {query.isFetchingNextPage ? "Loading…" : "Load older events"}
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">End of timeline</span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
