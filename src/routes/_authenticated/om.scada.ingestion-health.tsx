import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActiveCompany } from "@/components/company-switcher";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getIngestionHealth } from "@/lib/scada-ingestion.functions";
import { getConnectorErrorRates } from "@/lib/scada-import.functions";
import { getIngestionQueue, replayIngestionDeadLetters } from "@/lib/scada-retry.functions";
import { toggleScadaConnector } from "@/lib/scada.functions";
import { toast } from "sonner";
import type { IngestionHealth } from "@/lib/scada/ingestion";

export const Route = createFileRoute("/_authenticated/om/scada/ingestion-health")({
  head: () => ({
    meta: [
      { title: "SCADA ingestion health · GridMind EPC" },
      {
        name: "description",
        content:
          "Per-connector ingestion freshness, accept rates and recent pull, push and import runs.",
      },
      { property: "og:title", content: "SCADA ingestion health · GridMind EPC" },
      {
        property: "og:description",
        content: "Ingestion freshness and run history for every SCADA connector.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngestionHealthPage,
});

function healthVariant(health: IngestionHealth): "default" | "secondary" | "destructive" {
  if (health === "healthy") return "default";
  if (health === "down") return "destructive";
  return "secondary";
}

function runVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

function freshnessBadge(lagSeconds: number | null) {
  if (lagSeconds == null) return { label: "no data", variant: "secondary" as const };
  if (lagSeconds < 300) return { label: formatLag(lagSeconds), variant: "default" as const };
  if (lagSeconds < 900) return { label: formatLag(lagSeconds), variant: "secondary" as const };
  return { label: formatLag(lagSeconds), variant: "destructive" as const };
}

function formatLag(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  return `${formatDistanceToNow(new Date(iso))} ago`;
}

function IngestionHealthPage() {
  const { activeCompanyId } = useActiveCompany();
  const healthFn = useServerFn(getIngestionHealth);
  const query = useQuery({
    queryKey: ["scada", "ingestion-health", activeCompanyId],
    queryFn: () => healthFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
    refetchInterval: 30_000,
  });

  const extrasFn = useServerFn(getConnectorErrorRates);
  const extras = useQuery({
    queryKey: ["scada", "ingestion-extras", activeCompanyId],
    queryFn: () => extrasFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
    refetchInterval: 30_000,
  });

  const qc = useQueryClient();
  const toggleFn = useServerFn(toggleScadaConnector);
  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.enabled ? "Connector enabled" : "Connector disabled");
      qc.invalidateQueries({ queryKey: ["scada", "ingestion-health", activeCompanyId] });
      qc.invalidateQueries({ queryKey: ["scada", "connectors", activeCompanyId] });
    },
    onError: () => toast.error("Toggle failed"),
  });

  const queueFn = useServerFn(getIngestionQueue);
  const queueQuery = useQuery({
    queryKey: ["scada", "ingestion-queue", activeCompanyId],
    queryFn: () => queueFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
    refetchInterval: 30_000,
  });
  const queue = queueQuery.data;
  const deadLetters = queue?.deadLetters ?? [];
  const pendingReplay = deadLetters.filter((d) => !d.replayed_at);

  const replayFn = useServerFn(replayIngestionDeadLetters);
  const replayMut = useMutation({
    mutationFn: () => replayFn({ data: { companyId: activeCompanyId! } }),
    onSuccess: (res) => {
      toast.success(`${res.replayed} dead letter(s) requeued`);
      qc.invalidateQueries({ queryKey: ["scada", "ingestion-queue", activeCompanyId] });
    },
    onError: () => toast.error("Replay failed"),
  });

  const kpis = query.data?.kpis;
  const connectors = query.data?.connectors ?? [];
  const runs = query.data?.runs ?? [];

  return (
    <div className="page-shell">
      <PageHeader
        title="Ingestion health"
        description="Freshness, accept rate and run history across MQTT, OPC UA, Modbus and historian sources."
      />

      <KpiGrid columns={4}>
        <KpiTile label="Connectors" value={String(kpis?.connectors ?? 0)} />
        <KpiTile
          label="Healthy"
          value={`${kpis?.healthy ?? 0} / ${kpis?.connectors ?? 0}`}
          status={(kpis?.down ?? 0) > 0 ? "bad" : "good"}
        />
        <KpiTile label="Rows (24h)" value={(kpis?.rowsLast24h ?? 0).toLocaleString()} />
        <KpiTile
          label="Accept rate"
          value={kpis?.acceptRate == null ? "—" : `${(kpis.acceptRate * 100).toFixed(1)}%`}
        />
      </KpiGrid>

      <KpiGrid columns={4}>
        <KpiTile
          label="Retry queue"
          value={String(queue?.pending ?? 0)}
          status={(queue?.pending ?? 0) > 50 ? "warning" : "good"}
        />
        <KpiTile label="Processing" value={String(queue?.processing ?? 0)} />
        <KpiTile
          label="Dead letters"
          value={String(queue?.dead ?? 0)}
          status={(queue?.dead ?? 0) > 0 ? "bad" : "good"}
        />
        <KpiTile label="Oldest pending" value={relative(queue?.oldestPendingAt ?? null)} />
      </KpiGrid>

      <Card>
        <CardHeader>
          <CardTitle>Connector status</CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingReplay.length === 0 || replayMut.isPending}
                  onClick={() => replayMut.mutate()}
                >
                  Replay dead letters
                  {pendingReplay.length > 0 ? ` (${pendingReplay.length})` : ""}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {pendingReplay.length === 0
                ? "No dead letters awaiting replay."
                : "Requeue dead-lettered batches with a fresh attempt budget."}
            </TooltipContent>
          </Tooltip>
        </CardHeader>

        <CardContent>
          {query.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : connectors.length === 0 ? (
            <EmptyState
              title="No connectors configured"
              description="Add a SCADA connector to start monitoring ingestion health."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Lag</TableHead>
                  <TableHead>Error rate</TableHead>
                  <TableHead>Last data</TableHead>
                  <TableHead>Mappings</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((c) => (
                  <TableRow key={c.connector_id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.connector_type}</TableCell>
                    <TableCell>
                      <Badge variant={healthVariant(c.health)}>{c.health}</Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const badge = freshnessBadge(
                          extras.data?.lagSeconds?.[c.connector_id] ?? null,
                        );
                        return <Badge variant={badge.variant}>{badge.label}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const rate = extras.data?.rates?.[c.connector_id] ?? null;
                        if (rate != null) return `${(rate * 100).toFixed(1)}%`;
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground">—</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Available once the ingestion retry queue ships with P-177.
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                    <TableCell>{relative(c.last_seen_at)}</TableCell>
                    <TableCell>{c.mappings_count}</TableCell>
                    <TableCell>
                      <Switch
                        checked={c.enabled}
                        onCheckedChange={(checked) =>
                          toggleMut.mutate({ id: c.connector_id, enabled: checked })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent ingestion runs</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState
              title="No ingestion runs recorded"
              description="Scheduled pulls, pushes and historian imports appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Accepted</TableHead>
                  <TableHead>Rejected</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{relative(r.started_at)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.trigger}</TableCell>
                    <TableCell>
                      <Badge variant={runVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.rows_received}</TableCell>
                    <TableCell>{r.rows_accepted}</TableCell>
                    <TableCell>{r.rows_rejected}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.source_label ?? r.error_text ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
