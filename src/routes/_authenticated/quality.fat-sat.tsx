// P-183 — Factory and site acceptance tests with certificate issue.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Plus } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { ResultBadge } from "@/components/quality/quality-bits";
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
import {
  createCertificate,
  createFat,
  createSat,
  getQualityAccess,
  listFatSat,
  setAcceptanceResult,
} from "@/lib/quality.functions";
import { TEST_RESULT_STATUSES, type TestResultStatus } from "@/lib/quality.rules";

export const Route = createFileRoute("/_authenticated/quality/fat-sat")({
  head: () => ({
    meta: [
      { title: "FAT & SAT — GridMind EPC" },
      {
        name: "description",
        content: "Factory and site acceptance tests with results, punch items and certificates.",
      },
      { property: "og:title", content: "FAT & SAT — GridMind EPC" },
      {
        property: "og:description",
        content: "Track equipment acceptance from factory witness to site energisation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FatSatPage,
});

type AcceptanceRow = {
  id: string;
  equipment_tag: string;
  test_date: string | null;
  result: TestResultStatus;
  fat_number?: string;
  sat_number?: string;
};

function FatSatPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [fatTag, setFatTag] = useState("");
  const [satTag, setSatTag] = useState("");
  const [satFat, setSatFat] = useState("none");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getQualityAccess);
  const access = useQuery({ queryKey: ["quality-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWriteRecords ?? false;

  const listFn = useServerFn(listFatSat);
  const key = ["fat-sat", activeProject] as const;
  const data = useQuery({
    queryKey: key,
    queryFn: () =>
      listFn({ data: { projectId: activeProject } }) as Promise<{
        fat: AcceptanceRow[];
        sat: AcceptanceRow[];
      }>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const fatFn = useServerFn(createFat);
  const addFat = useMutation({
    mutationFn: () => fatFn({ data: { projectId: activeProject, equipmentTag: fatTag.trim() } }),
    onSuccess: () => {
      toast.success("FAT created");
      setFatTag("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const satFn = useServerFn(createSat);
  const addSat = useMutation({
    mutationFn: () =>
      satFn({
        data: {
          projectId: activeProject,
          equipmentTag: satTag.trim(),
          fatId: satFat === "none" ? null : satFat,
        },
      }),
    onSuccess: () => {
      toast.success("SAT created");
      setSatTag("");
      setSatFat("none");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const resultFn = useServerFn(setAcceptanceResult);
  const setResult = useMutation({
    mutationFn: (v: { id: string; kind: "fat" | "sat"; result: string }) =>
      resultFn({ data: { id: v.id, kind: v.kind, result: v.result as never } }),
    onSuccess: () => {
      toast.success("Result recorded");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const certFn = useServerFn(createCertificate);
  const issueCert = useMutation({
    mutationFn: (v: { kind: "fat" | "sat"; id: string; tag: string }) =>
      certFn({
        data: {
          projectId: activeProject,
          entityType: v.kind,
          entityId: v.id,
          title: `${v.kind.toUpperCase()} certificate — ${v.tag}`,
          issueDate: new Date().toISOString().slice(0, 10),
        },
      }),
    onSuccess: () => toast.success("Certificate issued"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const renderList = (rows: AcceptanceRow[], kind: "fat" | "sat") => (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="font-medium text-foreground">
            {kind === "fat" ? row.fat_number : row.sat_number}
          </span>
          <span className="min-w-0 flex-1 text-muted-foreground">{row.equipment_tag}</span>
          <ResultBadge result={row.result} />
          {canWrite ? (
            <>
              <Select
                value={row.result}
                onValueChange={(v) => setResult.mutate({ id: row.id, kind, result: v })}
              >
                <SelectTrigger className="w-32" aria-label={`Result of ${row.equipment_tag}`}>
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
              <Button
                size="sm"
                variant="outline"
                disabled={row.result !== "pass" || issueCert.isPending}
                onClick={() => issueCert.mutate({ kind, id: row.id, tag: row.equipment_tag })}
              >
                Issue certificate
              </Button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="FAT & SAT"
        description="Factory acceptance witness and site acceptance testing per equipment tag."
      />
      <ProjectSelect
        projects={projects.data ?? []}
        value={activeProject}
        onChange={setProjectId}
        loading={projects.isLoading}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Factory acceptance tests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite ? (
            <div className="grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="fat-tag">Equipment tag</Label>
                <Input
                  id="fat-tag"
                  value={fatTag}
                  onChange={(e) => setFatTag(e.target.value)}
                  placeholder="INV-01"
                />
              </div>
              <Button
                onClick={() => addFat.mutate()}
                disabled={!activeProject || !fatTag.trim() || addFat.isPending}
              >
                <Plus className="mr-1 size-4" /> Add FAT
              </Button>
            </div>
          ) : null}
          <PanelState
            isLoading={data.isLoading}
            isError={data.isError}
            onRetry={() => void data.refetch()}
            isEmpty={(data.data?.fat.length ?? 0) === 0}
            emptyIcon={FlaskConical}
            emptyTitle="No factory acceptance tests"
            emptyDescription="Add a FAT per major equipment package."
          >
            {renderList(data.data?.fat ?? [], "fat")}
          </PanelState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site acceptance tests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canWrite ? (
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="sat-tag">Equipment tag</Label>
                <Input id="sat-tag" value={satTag} onChange={(e) => setSatTag(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sat-fat">Linked FAT</Label>
                <Select value={satFat} onValueChange={setSatFat}>
                  <SelectTrigger id="sat-fat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(data.data?.fat ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.fat_number} — {f.equipment_tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => addSat.mutate()}
                disabled={!activeProject || !satTag.trim() || addSat.isPending}
              >
                <Plus className="mr-1 size-4" /> Add SAT
              </Button>
            </div>
          ) : null}
          <PanelState
            isLoading={data.isLoading}
            isError={data.isError}
            onRetry={() => void data.refetch()}
            isEmpty={(data.data?.sat.length ?? 0) === 0}
            emptyIcon={FlaskConical}
            emptyTitle="No site acceptance tests"
            emptyDescription="Record SATs once equipment is installed and energised."
          >
            {renderList(data.data?.sat ?? [], "sat")}
          </PanelState>
        </CardContent>
      </Card>
    </div>
  );
}
