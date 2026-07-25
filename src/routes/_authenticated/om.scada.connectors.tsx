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
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      toggleFn({ data: vars }),
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
      if (ctx?.prev)
        qc.setQueryData(["scada", "connectors", activeCompanyId], ctx.prev);
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
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">SCADA connectors</h1>
          <p className="text-sm text-muted-foreground">
            Inverter, meter, weather station, plant controller, and BESS streams.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add connector
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Active connectors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold">
              {kpis.activeCount}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                / {kpis.totalCount}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Assets mapped
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold">{kpis.assetsMapped}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Last telemetry seen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-lg font-semibold">
              {kpis.lastTelemetryAt
                ? formatDistanceToNow(new Date(kpis.lastTelemetryAt), { addSuffix: true })
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

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
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-sm">Couldn&apos;t load connectors.</p>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {!query.isLoading && !query.isError && rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <RadioIcon className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No SCADA connectors — add your first stream
              </p>
              <Button size="sm" onClick={() => setWizardOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add connector
              </Button>
            </div>
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
                    <TableCell className="text-muted-foreground">
                      {r.project_name ?? "—"}
                    </TableCell>
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
