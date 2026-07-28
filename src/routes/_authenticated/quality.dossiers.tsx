// P-183 — Commissioning dossiers: compile sections and issue.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FolderCheck, Plus } from "lucide-react";
import { toast } from "sonner";

import { PanelState, ProjectSelect } from "@/components/construction/controls-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  createDossier,
  getQualityAccess,
  issueDossier,
  listDossiers,
  listFatSat,
  listItps,
  setDossierSections,
} from "@/lib/quality.functions";
import { dossierItemCount, type DossierSection } from "@/lib/quality.rules";

export const Route = createFileRoute("/_authenticated/quality/dossiers")({
  head: () => ({
    meta: [
      { title: "Commissioning dossiers — GridMind EPC" },
      {
        name: "description",
        content: "Compile ITPs, acceptance tests and certificates into an issuable dossier.",
      },
      { property: "og:title", content: "Commissioning dossiers — GridMind EPC" },
      {
        property: "og:description",
        content: "Turnover-ready dossiers built from live quality records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DossiersPage,
});

type DossierRow = {
  id: string;
  dossier_number: string;
  title: string;
  status: string;
  sections: DossierSection[] | null;
  issued_at: string | null;
};

function DossiersPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const accessFn = useServerFn(getQualityAccess);
  const access = useQuery({ queryKey: ["quality-access"], queryFn: () => accessFn() });
  const canWrite = access.data?.canWritePlans ?? false;

  const listFn = useServerFn(listDossiers);
  const key = ["dossiers", activeProject] as const;
  const dossiers = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<DossierRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const itpsFn = useServerFn(listItps);
  const itps = useQuery({
    queryKey: ["itps", activeProject],
    queryFn: () => itpsFn({ data: { projectId: activeProject } }) as Promise<Array<{ id: string }>>,
    enabled: Boolean(activeProject),
  });
  const fatSatFn = useServerFn(listFatSat);
  const fatSat = useQuery({
    queryKey: ["fat-sat", activeProject],
    queryFn: () =>
      fatSatFn({ data: { projectId: activeProject } }) as Promise<{
        fat: Array<{ id: string }>;
        sat: Array<{ id: string }>;
      }>,
    enabled: Boolean(activeProject),
  });

  const createFn = useServerFn(createDossier);
  const create = useMutation({
    mutationFn: () => createFn({ data: { projectId: activeProject, title: title.trim() } }),
    onSuccess: () => {
      toast.success("Dossier created");
      setTitle("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sectionsFn = useServerFn(setDossierSections);
  const compile = useMutation({
    mutationFn: (id: string) => {
      const sections: DossierSection[] = [];
      const itpIds = (itps.data ?? []).map((r) => r.id);
      const fatIds = (fatSat.data?.fat ?? []).map((r) => r.id);
      const satIds = (fatSat.data?.sat ?? []).map((r) => r.id);
      if (itpIds.length)
        sections.push({
          key: "itp",
          label: "Inspection & test plans",
          entity_type: "itp",
          entity_ids: itpIds,
        });
      if (fatIds.length)
        sections.push({
          key: "fat",
          label: "Factory acceptance tests",
          entity_type: "fat",
          entity_ids: fatIds,
        });
      if (satIds.length)
        sections.push({
          key: "sat",
          label: "Site acceptance tests",
          entity_type: "sat",
          entity_ids: satIds,
        });
      return sectionsFn({ data: { id, sections } });
    },
    onSuccess: () => {
      toast.success("Sections compiled");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const issueFn = useServerFn(issueDossier);
  const issue = useMutation({
    mutationFn: (id: string) => issueFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Dossier issued");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissioning dossiers"
        description="Compile quality records into a turnover-ready dossier and issue it."
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
            <CardTitle className="text-base">New dossier</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="dossier-title">Title</Label>
              <Input
                id="dossier-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Block A — MV system turnover"
              />
            </div>
            <Button
              onClick={() => create.mutate()}
              disabled={!activeProject || !title.trim() || create.isPending}
            >
              <Plus className="mr-1 size-4" /> Create
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dossiers</CardTitle>
        </CardHeader>
        <CardContent>
          <PanelState
            isLoading={dossiers.isLoading}
            isError={dossiers.isError}
            onRetry={() => void dossiers.refetch()}
            isEmpty={(dossiers.data?.length ?? 0) === 0}
            emptyIcon={FolderCheck}
            emptyTitle="No dossiers yet"
            emptyDescription="Create a dossier once inspection and test records exist."
          >
            <ul className="divide-y divide-border">
              {(dossiers.data ?? []).map((row) => {
                const sections = row.sections ?? [];
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="font-medium text-foreground">{row.dossier_number}</span>
                    <span className="min-w-0 flex-1 text-muted-foreground">{row.title}</span>
                    <Badge variant="outline">
                      {sections.length} sections · {dossierItemCount(sections)} records
                    </Badge>
                    <Badge variant={row.status === "issued" ? "default" : "secondary"}>
                      {row.status}
                    </Badge>
                    {canWrite && row.status !== "issued" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => compile.mutate(row.id)}
                          disabled={compile.isPending}
                        >
                          Compile sections
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => issue.mutate(row.id)}
                          disabled={issue.isPending || sections.length === 0}
                        >
                          Issue
                        </Button>
                      </div>
                    ) : null}
                    {row.issued_at ? (
                      <span className="text-xs text-muted-foreground">
                        Issued {row.issued_at.slice(0, 10)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </PanelState>
        </CardContent>
      </Card>
    </div>
  );
}
