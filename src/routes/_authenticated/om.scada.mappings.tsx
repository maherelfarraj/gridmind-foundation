import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useActiveCompany } from "@/components/company-switcher";
import {
  deleteTagMapping,
  importHistorianCsv,
  listTagMappings,
  upsertTagMapping,
} from "@/lib/scada-ingestion.functions";
import { listScadaProjectOptions } from "@/lib/scada.functions";
import {
  PROTOCOL_LABELS,
  TAG_PROTOCOLS,
  MAPPING_DATA_TYPES,
  validateSourceAddress,
  type TagProtocol,
} from "@/lib/scada/ingestion";

export const Route = createFileRoute("/_authenticated/om/scada/mappings")({
  head: () => ({
    meta: [
      { title: "SCADA tag mappings · GridMind EPC" },
      {
        name: "description",
        content:
          "Map MQTT topics, OPC UA node ids and Modbus registers to dictionary tags, and import historian CSV exports.",
      },
      { property: "og:title", content: "SCADA tag mappings · GridMind EPC" },
      {
        property: "og:description",
        content: "Protocol source addresses and historian imports for SCADA ingestion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TagMappingsPage,
});

const ADDRESS_PLACEHOLDER: Record<TagProtocol, string> = {
  mqtt: "plant/east-amman/inv-01/ac_power",
  opcua: "ns=2;s=Plant.INV01.ACPower",
  modbus: "1:hr:40071:2",
  historian_csv: "INV01_AC_POWER",
  vendor_api: "/v1/plants/1/inverters/01/power",
};

function TagMappingsPage() {
  const { activeCompanyId } = useActiveCompany();
  const qc = useQueryClient();
  const listFn = useServerFn(listTagMappings);
  const projectsFn = useServerFn(listScadaProjectOptions);
  const upsertFn = useServerFn(upsertTagMapping);
  const deleteFn = useServerFn(deleteTagMapping);
  const importFn = useServerFn(importHistorianCsv);

  const query = useQuery({
    queryKey: ["scada", "mappings", activeCompanyId],
    queryFn: () => listFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
  });
  const projectsQuery = useQuery({
    queryKey: ["scada", "project-options", activeCompanyId],
    queryFn: () => projectsFn({ data: { companyId: activeCompanyId! } }),
    enabled: Boolean(activeCompanyId),
  });

  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [protocol, setProtocol] = useState<TagProtocol>("mqtt");
  const [projectId, setProjectId] = useState("");
  const [tagId, setTagId] = useState("");
  const [address, setAddress] = useState("");
  const [dataType, setDataType] = useState<string>("float32");
  const [factor, setFactor] = useState("1");
  const [offset, setOffset] = useState("0");
  const [pollInterval, setPollInterval] = useState("60");

  const [importProject, setImportProject] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [csv, setCsv] = useState("");

  const rows = query.data?.rows ?? [];
  const tags = query.data?.tags ?? [];
  const projects = projectsQuery.data ?? [];
  const tagsForProject = useMemo(
    () => tags.filter((t) => !projectId || t.project_id === projectId),
    [tags, projectId],
  );
  const addressError = address ? validateSourceAddress(protocol, address) : null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["scada", "mappings", activeCompanyId] });

  const saveMut = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          project_id: projectId,
          tag_dictionary_id: tagId,
          protocol,
          source_address: address,
          data_type: dataType as never,
          byte_order: "big_endian" as const,
          scaling_factor: Number(factor),
          scaling_offset: Number(offset),
          poll_interval_s: Number(pollInterval),
          enabled: true,
        },
      }),
    onSuccess: () => {
      toast.success("Mapping saved");
      setOpen(false);
      setAddress("");
      invalidate();
    },
    onError: () => toast.error("Could not save mapping"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Mapping removed");
      invalidate();
    },
    onError: () => toast.error("Could not remove mapping"),
  });

  const importMut = useMutation({
    mutationFn: () =>
      importFn({
        data: { project_id: importProject, source_label: importLabel, csv },
      }),
    onSuccess: (res) => {
      toast.success(
        `Imported ${res.rows_accepted} of ${res.rows_received} rows${
          res.unmapped_columns.length > 0
            ? ` — unmapped: ${res.unmapped_columns.slice(0, 3).join(", ")}`
            : ""
        }`,
      );
      setImportOpen(false);
      setCsv("");
      qc.invalidateQueries({ queryKey: ["scada", "ingestion-health", activeCompanyId] });
    },
    onError: () => toast.error("Historian import failed"),
  });

  return (
    <div className="page-shell">
      <PageHeader
        title="Tag mappings"
        description="MQTT topics, OPC UA node ids, Modbus registers and historian columns bound to dictionary tags."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" /> Import historian CSV
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add mapping
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Configured mappings</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No tag mappings yet"
              description="Bind a dictionary tag to a protocol source address to start ingesting data."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Source address</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Poll</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.tag ?? "—"}
                      {r.unit ? <span className="text-muted-foreground"> ({r.unit})</span> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {PROTOCOL_LABELS[r.protocol as TagProtocol] ?? r.protocol}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.source_address}</TableCell>
                    <TableCell>{r.project_name ?? "—"}</TableCell>
                    <TableCell>{r.poll_interval_s}s</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMut.mutate(r.id)}
                        aria-label={`Delete mapping ${r.source_address}`}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tag mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dictionary tag</Label>
              <Select value={tagId} onValueChange={setTagId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tag" />
                </SelectTrigger>
                <SelectContent>
                  {tagsForProject.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.tag}
                      {t.unit ? ` (${t.unit})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select value={protocol} onValueChange={(v) => setProtocol(v as TagProtocol)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAG_PROTOCOLS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROTOCOL_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data type</Label>
                <Select value={dataType} onValueChange={setDataType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAPPING_DATA_TYPES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-address">Source address</Label>
              <Input
                id="source-address"
                value={address}
                placeholder={ADDRESS_PLACEHOLDER[protocol]}
                onChange={(e) => setAddress(e.target.value)}
              />
              {addressError ? (
                <p className="text-destructive text-xs">{addressError}</p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Example: {ADDRESS_PLACEHOLDER[protocol]}
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="factor">Scale ×</Label>
                <Input id="factor" value={factor} onChange={(e) => setFactor(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offset">Offset +</Label>
                <Input id="offset" value={offset} onChange={(e) => setOffset(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="poll">Poll (s)</Label>
                <Input
                  id="poll"
                  value={pollInterval}
                  onChange={(e) => setPollInterval(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={
                !projectId || !tagId || !address || Boolean(addressError) || saveMut.isPending
              }
            >
              Save mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import historian CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={importProject} onValueChange={setImportProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-label">Source label</Label>
              <Input
                id="source-label"
                value={importLabel}
                placeholder="PI export 2026-07"
                onChange={(e) => setImportLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="csv">CSV content</Label>
              <Textarea
                id="csv"
                rows={8}
                className="font-mono text-xs"
                placeholder={"timestamp,INV01_AC_POWER\n2026-07-01T00:00:00Z,1234.5"}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                First column is the timestamp; every other column must match a historian-CSV
                mapping.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importMut.mutate()}
              disabled={!importProject || !importLabel || !csv || importMut.isPending}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
