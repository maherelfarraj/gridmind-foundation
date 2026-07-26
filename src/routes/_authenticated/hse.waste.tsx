// P-185 — Waste tracking register.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Recycle } from "lucide-react";
import { toast } from "sonner";

import { CsvButton, HseRegister } from "@/components/hse/hse-ext-bits";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import { createWasteRecord, listWasteRecords } from "@/lib/hse-ext.functions";
import { WASTE_TYPES, WASTE_TYPE_LABEL, type WasteType } from "@/lib/hse-ext.rules";

export const Route = createFileRoute("/_authenticated/hse/waste")({
  head: () => ({
    meta: [
      { title: "Waste tracking — GridMind EPC" },
      {
        name: "description",
        content: "Construction, hazardous and recyclable waste streams with disposal manifests.",
      },
      { property: "og:title", content: "Waste tracking — GridMind EPC" },
      {
        property: "og:description",
        content: "Quantities by stream, disposal method, contractor and manifest number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WastePage,
});

type WasteRow = {
  id: string;
  waste_type: string;
  qty: number;
  uom: string;
  disposal_method: string | null;
  contractor: string | null;
  manifest_number: string | null;
  disposal_date: string;
};

function WastePage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [wasteType, setWasteType] = useState<WasteType>("general");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState("kg");
  const [disposalMethod, setDisposalMethod] = useState("");
  const [contractor, setContractor] = useState("");
  const [manifestNumber, setManifestNumber] = useState("");
  const [disposalDate, setDisposalDate] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const listFn = useServerFn(listWasteRecords);
  const key = ["hse", "waste", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<WasteRow[]>,
    enabled: Boolean(activeProject),
  });

  const createFn = useServerFn(createWasteRecord);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          wasteType,
          qty: Number(qty),
          uom: uom.trim() || "kg",
          disposalMethod: disposalMethod.trim() || null,
          contractor: contractor.trim() || null,
          manifestNumber: manifestNumber.trim() || null,
          disposalDate,
        },
      }),
    onSuccess: () => {
      toast.success("Waste recorded");
      setQty("");
      setManifestNumber("");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) =>
      [r.waste_type, r.contractor ?? "", r.manifest_number ?? ""].some((v) =>
        v.toLowerCase().includes(term),
      ),
    );
  }, [list.data, search]);

  const byType = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) {
      if ((r.uom ?? "kg").toLowerCase() !== "kg") continue;
      acc[r.waste_type] = (acc[r.waste_type] ?? 0) + Number(r.qty ?? 0);
    }
    return acc;
  }, [rows]);

  return (
    <div className="page-shell">
      <PageHeader title="Waste tracking" description="What left site, how much, and to whom." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Record disposal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Waste type</Label>
              <Select value={wasteType} onValueChange={(v) => setWasteType(v as WasteType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {WASTE_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-qty">Quantity</Label>
              <Input
                id="w-qty"
                type="number"
                min={0}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-uom">Unit</Label>
              <Input id="w-uom" value={uom} onChange={(e) => setUom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-method">Disposal method</Label>
              <Input
                id="w-method"
                value={disposalMethod}
                onChange={(e) => setDisposalMethod(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-contractor">Contractor</Label>
              <Input
                id="w-contractor"
                value={contractor}
                onChange={(e) => setContractor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-manifest">Manifest no.</Label>
              <Input
                id="w-manifest"
                value={manifestNumber}
                onChange={(e) => setManifestNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-date">Disposal date</Label>
              <Input
                id="w-date"
                type="date"
                value={disposalDate}
                onChange={(e) => setDisposalDate(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!activeProject || !qty || !disposalDate || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={14} aria-hidden /> Record
          </Button>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {Object.entries(byType).length === 0
          ? "No kilogram-based totals yet."
          : Object.entries(byType)
              .map(([t, kg]) => `${WASTE_TYPE_LABEL[t as WasteType] ?? t}: ${kg} kg`)
              .join(" · ")}
      </p>

      <HseRegister
        title="Register"
        icon={Recycle}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="waste.csv"
            headers={["Type", "Qty", "Unit", "Method", "Contractor", "Manifest", "Date"]}
            rows={rows.map((r) => [
              r.waste_type,
              r.qty,
              r.uom,
              r.disposal_method ?? "",
              r.contractor ?? "",
              r.manifest_number ?? "",
              r.disposal_date,
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No waste records"
        emptyDescription="Record the first disposal for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Contractor</TableHead>
              <TableHead>Manifest</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {WASTE_TYPE_LABEL[r.waste_type as WasteType] ?? r.waste_type}
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.qty} {r.uom}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.disposal_method ?? "—"}</TableCell>
                <TableCell>{r.contractor ?? "—"}</TableCell>
                <TableCell>{r.manifest_number ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.disposal_date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
