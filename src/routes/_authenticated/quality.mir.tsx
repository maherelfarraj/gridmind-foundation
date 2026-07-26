// P-183 — Material inspection requests (MIR) register.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PackageSearch, Plus } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { ResultBadge } from "@/components/quality/quality-bits";
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
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import { createMir, getQualityAccess, listMirs, updateMir } from "@/lib/quality.functions";
import { MIR_STATUSES, TEST_RESULT_STATUSES, type TestResultStatus } from "@/lib/quality.rules";

export const Route = createFileRoute("/_authenticated/quality/mir")({
  head: () => ({
    meta: [
      { title: "Material inspection requests — GridMind EPC" },
      {
        name: "description",
        content: "Raise and close out material inspection requests against purchase orders.",
      },
      { property: "og:title", content: "Material inspection requests — GridMind EPC" },
      {
        property: "og:description",
        content: "MIR register with inspector, inspection date and result.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MirPage,
});

type MirRow = {
  id: string;
  mir_number: string;
  material: string;
  qty: number | null;
  uom: string | null;
  status: string;
  result: TestResultStatus;
  inspection_date: string | null;
};

function MirPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("");
  const [uom, setUom] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getQualityAccess);
  const access = useQuery({ queryKey: ["quality-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWriteRecords ?? false;

  const listFn = useServerFn(listMirs);
  const key = ["mirs", activeProject] as const;
  const mirs = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<MirRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(createMir);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          material: material.trim(),
          qty: qty ? Number(qty) : null,
          uom: uom.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("MIR raised");
      setMaterial("");
      setQty("");
      setUom("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateFn = useServerFn(updateMir);
  const patch = useMutation({
    mutationFn: (v: { id: string; status?: string; result?: string }) =>
      updateFn({ data: { id: v.id, status: v.status as never, result: v.result as never } }),
    onSuccess: () => {
      toast.success("MIR updated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material inspection requests"
        description="Inbound material verification against the purchase order and specification."
      />
      <ProjectSelect
        projects={projects.data ?? []}
        value={activeProject}
        onChange={setProjectId}
        loading={projects.isLoading}
      />

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raise MIR</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="mir-material">Material</Label>
              <Input
                id="mir-material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="MV cable 33 kV 3x240 mm²"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mir-qty">Quantity</Label>
              <Input
                id="mir-qty"
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mir-uom">UOM</Label>
              <Input id="mir-uom" value={uom} onChange={(e) => setUom(e.target.value)} />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={!activeProject || !material.trim() || create.isPending}
            >
              <Plus className="mr-1 size-4" /> Raise
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          <PanelState
            isLoading={mirs.isLoading}
            isError={mirs.isError}
            onRetry={() => void mirs.refetch()}
            isEmpty={(mirs.data?.length ?? 0) === 0}
            emptyIcon={PackageSearch}
            emptyTitle="No inspection requests yet"
            emptyDescription="Raise a MIR when material arrives on site."
          >
            <ul className="divide-y divide-border">
              {(mirs.data ?? []).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="font-medium text-foreground">{row.mir_number}</span>
                  <span className="min-w-0 flex-1 text-muted-foreground">{row.material}</span>
                  {row.qty ? (
                    <Badge variant="outline">
                      {row.qty} {row.uom ?? ""}
                    </Badge>
                  ) : null}
                  <ResultBadge result={row.result} />
                  {canWrite ? (
                    <>
                      <Select
                        value={row.status}
                        onValueChange={(v) => patch.mutate({ id: row.id, status: v })}
                      >
                        <SelectTrigger className="w-36" aria-label={`Status of ${row.mir_number}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MIR_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.result}
                        onValueChange={(v) => patch.mutate({ id: row.id, result: v })}
                      >
                        <SelectTrigger className="w-32" aria-label={`Result of ${row.mir_number}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TEST_RESULT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <Badge variant="outline">{row.status}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </PanelState>
        </CardContent>
      </Card>
    </div>
  );
}
