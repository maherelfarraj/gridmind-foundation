// P-185 — Environmental monitoring register with server-derived exceedance flags.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Leaf, Plus } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister } from "@/components/hse/hse-ext-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import { createEnvironmentalReading, listEnvironmentalReadings } from "@/lib/hse-ext.functions";
import { ENV_METRICS, ENV_METRIC_LABEL, type EnvMetric } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/environmental")({
  head: () => ({
    meta: [
      { title: "Environmental monitoring — GridMind EPC" },
      {
        name: "description",
        content: "Noise, dust, water, soil and emissions readings with automatic exceedance flagging.",
      },
      { property: "og:title", content: "Environmental monitoring — GridMind EPC" },
      {
        property: "og:description",
        content: "Every reading compared against its permit limit, server-side.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EnvironmentalPage,
});

type EnvRow = {
  id: string;
  metric: string;
  value: number;
  uom: string;
  limit_value: number | null;
  exceedance: boolean;
  location: string | null;
  measured_at: string;
};

function EnvironmentalPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [metric, setMetric] = useState<EnvMetric>("noise_db");
  const [value, setValue] = useState("");
  const [uom, setUom] = useState("dB");
  const [limitValue, setLimitValue] = useState("");
  const [location, setLocation] = useState("");
  const [measuredAt, setMeasuredAt] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const listFn = useServerFn(listEnvironmentalReadings);
  const key = ["hse", "environmental", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<EnvRow[]>,
    enabled: Boolean(activeProject),
  });

  const createFn = useServerFn(createEnvironmentalReading);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          metric,
          value: Number(value),
          uom: uom.trim(),
          limitValue: limitValue ? Number(limitValue) : null,
          location: location.trim() || null,
          measuredAt: measuredAt ? new Date(measuredAt).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Reading recorded");
      setValue("");
      setMeasuredAt("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) =>
      [r.metric, r.location ?? ""].some((v) => v.toLowerCase().includes(term)),
    );
  }, [list.data, search]);

  const exceedances = rows.filter((r) => r.exceedance).length;

  return (
    <div className="page-shell">
      <PageHeader
        title="Environmental monitoring"
        description="Readings against permit limits. Exceedance is computed on the server, never trusted from the client."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Record a reading</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Metric</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as EnvMetric)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENV_METRICS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {ENV_METRIC_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-value">Value</Label>
              <Input
                id="env-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-uom">Unit</Label>
              <Input id="env-uom" value={uom} onChange={(e) => setUom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-limit">Limit</Label>
              <Input
                id="env-limit"
                type="number"
                value={limitValue}
                onChange={(e) => setLimitValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-loc">Location</Label>
              <Input id="env-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="env-at">Measured at</Label>
              <Input
                id="env-at"
                type="datetime-local"
                value={measuredAt}
                onChange={(e) => setMeasuredAt(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!activeProject || value === "" || !uom.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={14} aria-hidden /> Record
          </Button>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">Exceedances in view: {exceedances}</p>

      <HseRegister
        title="Readings"
        icon={Leaf}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="environmental.csv"
            headers={["Metric", "Value", "Unit", "Limit", "Exceedance", "Location", "Measured at"]}
            rows={rows.map((r) => [
              r.metric,
              r.value,
              r.uom,
              r.limit_value ?? "",
              r.exceedance ? "yes" : "no",
              r.location ?? "",
              r.measured_at,
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No readings"
        emptyDescription="Record the first environmental reading for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Measured</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {ENV_METRIC_LABEL[r.metric as EnvMetric] ?? r.metric}
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.value} {r.uom}
                </TableCell>
                <TableCell className="tabular-nums">{r.limit_value ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.location ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(r.measured_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  {r.exceedance ? (
                    <Badge variant="destructive">Exceedance</Badge>
                  ) : (
                    <Badge variant="outline">Within limit</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
