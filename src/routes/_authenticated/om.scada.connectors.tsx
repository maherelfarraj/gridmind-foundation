import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow } from "date-fns";
import { Radio as RadioIcon, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiGrid, KpiTile } from "@/components/ui/kpi-tile";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
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
import {
  listScadaConnectors,
  toggleScadaConnector,
  type ConnectorRow,
} from "@/lib/scada.functions";
import { ScadaConnectorWizard } from "@/components/om/scada-connector-wizard";

export const Route = createFileRoute("/_authenticated/om/scada/connectors")({
  head: () => ({
    meta: [
      { title: "SCADA connectors · GridMind EPC" },
      {
        name: "description",
        content:
          "Configure and monitor SCADA connector streams for inverters, meters, weather stations, plant controllers, and BESS.",
      },
      { property: "og:title", content: "SCADA connectors · GridMind EPC" },
      {
        property: "og:description",
        content: "SCADA connector configuration for O&M operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScadaConnectorsPage,
});

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

function ScadaConnectorsPage() {
  const { activeCompanyId } = useActiveCompany();
  const [wizardOpen, setWizardOpen] = useState(false);
  const qc = useQueryClient();
  const listFn = useServerFn(listScadaConnectors);
  const query = useQuery({
    queryKey: ["scada", "connectors", activeCompanyId],
    queryFn: () => listFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
  });

  const toggleFn = useServerFn(toggleScadaConnector);
  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => toggleFn({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["scada", "connectors", activeCompanyId] });
      const prev = qc.getQueryData<{ rows: ConnectorRow[] }>([
        "scada",
        "connectors",
        activeCompanyId,
      ]);
      if (prev) {
        qc.setQueryData(["scada", "connectors", activeCompanyId], {
          ...prev,
          rows: prev.rows.map((r) =>
            r.id === vars.id
              ? { ...r, enabled: vars.enabled, status: vars.enabled ? "active" : "disabled" }
              : r,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["scada", "connectors", activeCompanyId], ctx.prev);
      toast.error("Toggle failed");
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.enabled ? "Connector enabled" : "Connector disabled");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["scada", "connectors", activeCompanyId] });
    },
  });

  const kpis = query.data?.kpis ?? {
    activeCount: 0,
    totalCount: 0,
    assetsMapped: 0,
    lastTelemetryAt: null,
  };
  const rows = query.data?.rows ?? [];

  return (
    <div className="page-shell">
      <PageHeader
        title="SCADA connectors"
        description="Inverter, meter, weather station, plant controller, and BESS streams."
        actions={
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add connector
          </Button>
        }
      />

      <KpiGrid columns={3}>
        <KpiTile
          label="Active connectors"
          value={`${kpis.activeCount} / ${kpis.totalCount}`}
        />
        <KpiTile label="Assets mapped" value={kpis.assetsMapped} />
        <KpiTile
          label="Last telemetry seen"
          value={
            kpis.lastTelemetryAt
              ? formatDistanceToNow(new Date(kpis.lastTelemetryAt), { addSuffix: true })
              : "—"
          }
        />
      </KpiGrid>

      <Card>
        <CardContent className="p-0">
          {query.isLoading && (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {query.isError && (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load connectors"
              action={
                <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                  Retry
                </Button>
              }
            />
          )}
          {!query.isLoading && !query.isError && rows.length === 0 && (
            <EmptyState
              icon={RadioIcon}
              title="No SCADA connectors"
              description="Add your first stream to start ingesting telemetry."
              action={
                <Button size="sm" onClick={() => setWizardOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add connector
                </Button>
              }
            />
          )}
          {!query.isLoading && !query.isError && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.connector_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.project_name ?? "—"}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(checked) =>
                          toggleMut.mutate({ id: r.id, enabled: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.last_seen_at
                        ? formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {activeCompanyId && (
        <ScadaConnectorWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          companyId={activeCompanyId}
        />
      )}
    </div>
  );
}
