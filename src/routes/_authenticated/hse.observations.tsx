// P-185 — Safety observation quick-capture (unsafe acts vs conditions) with photo.
import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Eye, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { listControlsProjects } from "@/lib/controls.functions";
import { errorMessage } from "@/lib/dpr-query";
import {
  createSafetyObservation,
  getHseStoragePrefix,
  listSafetyObservations,
  updateSafetyObservation,
} from "@/lib/hse-ext.functions";
import { OBS_SEVERITIES, SAFETY_OBS_TYPES, hseLabel } from "@/lib/hse-ext.rules";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/hse/observations")({
  head: () => ({
    meta: [
      { title: "Safety observations — GridMind EPC" },
      {
        name: "description",
        content: "Quick-capture safety observations from site: unsafe acts, unsafe conditions and safe acts.",
      },
      { property: "og:title", content: "Safety observations — GridMind EPC" },
      {
        property: "og:description",
        content: "Anyone on site can report; supervisors action and close them out.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ObservationsPage,
});

type ObsRow = {
  id: string;
  obs_number: string;
  obs_type: string;
  description: string;
  location: string | null;
  severity: string;
  status: string;
  photo_path: string | null;
  created_at: string;
};

function ObservationsPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [obsType, setObsType] = useState<(typeof SAFETY_OBS_TYPES)[number]>("unsafe_condition");
  const [severity, setSeverity] = useState<(typeof OBS_SEVERITIES)[number]>("low");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const projectsFn = useServerFn(listControlsProjects);
  const projects = useQuery({ queryKey: ["controls-projects"], queryFn: () => projectsFn() });
  const activeProject = projectId || (projects.data?.[0]?.id ?? "");

  const prefixFn = useServerFn(getHseStoragePrefix);
  const prefix = useQuery({ queryKey: ["hse-storage-prefix"], queryFn: () => prefixFn() });

  const listFn = useServerFn(listSafetyObservations);
  const key = ["hse", "observations", activeProject] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { projectId: activeProject } }) as Promise<ObsRow[]>,
    enabled: Boolean(activeProject),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const createFn = useServerFn(createSafetyObservation);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          projectId: activeProject,
          obsType,
          description: description.trim(),
          location: location.trim() || null,
          severity,
          photoPath,
        },
      }),
    onSuccess: () => {
      toast.success("Observation logged");
      setDescription("");
      setLocation("");
      setPhotoPath(null);
      if (fileRef.current) fileRef.current.value = "";
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const updateFn = useServerFn(updateSafetyObservation);
  const close = useMutation({
    mutationFn: (id: string) => updateFn({ data: { id, status: "closed" as const } }),
    onSuccess: () => {
      toast.success("Observation closed");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function onPickPhoto(file: File | undefined) {
    const companyId = prefix.data?.companyId;
    if (!file || !companyId) return;
    setUploading(true);
    try {
      const path = `${companyId}/hse/observations/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
      if (error) throw error;
      setPhotoPath(path);
      toast.success("Photo attached");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = list.data ?? [];
    if (!term) return all;
    return all.filter((r) =>
      [r.obs_number, r.description, r.location ?? ""].some((v) => v.toLowerCase().includes(term)),
    );
  }, [list.data, search]);

  const unsafe = rows.filter((r) => r.obs_type !== "safe_act");
  const safe = rows.filter((r) => r.obs_type === "safe_act");

  return (
    <div className="page-shell">
      <PageHeader
        title="Safety observations"
        description="Capture what you see, on the spot. Unsafe acts and conditions get actioned and closed."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Quick capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={obsType} onValueChange={(v) => setObsType(v as typeof obsType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAFETY_OBS_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {hseLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBS_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {hseLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs-loc">Location</Label>
              <Input id="obs-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-desc">What did you see?</Label>
            <Textarea
              id="obs-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPickPhoto(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={14} aria-hidden /> {photoPath ? "Photo attached" : "Add photo"}
            </Button>
            <Button
              size="sm"
              disabled={!activeProject || !description.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={14} aria-hidden /> Log observation
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
        <span>Unsafe acts / conditions: {unsafe.length}</span>
        <span>Safe acts recognised: {safe.length}</span>
      </div>

      <HseRegister
        title="Observations"
        icon={Eye}
        projects={projects.data ?? []}
        projectId={activeProject}
        onProjectChange={setProjectId}
        search={search}
        onSearchChange={setSearch}
        actions={
          <CsvButton
            filename="safety-observations.csv"
            headers={["Number", "Type", "Severity", "Location", "Status", "Description"]}
            rows={rows.map((r) => [
              r.obs_number,
              r.obs_type,
              r.severity,
              r.location ?? "",
              r.status,
              r.description,
            ])}
          />
        }
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle="No observations"
        emptyDescription="Log the first observation for this project."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.obs_number}</TableCell>
                <TableCell>
                  <Badge variant={r.obs_type === "safe_act" ? "outline" : "secondary"}>
                    {hseLabel(r.obs_type)}
                  </Badge>
                </TableCell>
                <TableCell>{hseLabel(r.severity)}</TableCell>
                <TableCell className="text-muted-foreground">{r.location ?? "—"}</TableCell>
                <TableCell className="max-w-md truncate">{r.description}</TableCell>
                <TableCell>{hseLabel(r.status)}</TableCell>
                <TableCell className="text-right">
                  {r.status !== "closed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={close.isPending}
                      onClick={() => close.mutate(r.id)}
                    >
                      Close
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HseRegister>
    </div>
  );
}
