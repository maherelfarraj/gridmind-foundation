// P-088 — HSE training records.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Plus, Search, Shield, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TrainingExpiryBadge } from "@/components/hse/training-expiry-badge";
import {
  errorMessage,
  hseProjectsQueryOptions,
  trainingListQueryOptions,
} from "@/lib/hse-query";
import {
  signTrainingCertificate,
  upsertTrainingRecord,
} from "@/lib/hse.functions";
import type { TrainingInput } from "@/lib/hse.rules";
import { supabase } from "@/integrations/supabase/client";
import { toCsv, downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/_authenticated/hse/training")({
  head: () => ({
    meta: [
      { title: "HSE training — GridMind EPC" },
      {
        name: "description",
        content: "Site training records and certificate expiries.",
      },
      { property: "og:title", content: "HSE training" },
      { property: "og:description", content: "Certificates and refreshers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TrainingPage,
});

interface Draft {
  personName: string;
  course: string;
  provider: string;
  completedOn: string;
  expiresOn: string;
  projectId: string;
  certificatePath: string | null;
  fileToUpload: File | null;
}
function emptyDraft(): Draft {
  return {
    personName: "",
    course: "",
    provider: "",
    completedOn: new Date().toISOString().slice(0, 10),
    expiresOn: "",
    projectId: "",
    certificatePath: null,
    fileToUpload: null,
  };
}

function TrainingPage() {
  const projectsQuery = useQuery(hseProjectsQueryOptions());
  const [projectId, setProjectId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState(false);
  const qc = useQueryClient();

  const filters = useMemo(
    () => ({ projectId: projectId || null, search: search || null }),
    [projectId, search],
  );
  const listQuery = useQuery(trainingListQueryOptions(filters));
  const rows = listQuery.data ?? [];

  const saveMut = useMutation({
    mutationFn: (payload: TrainingInput) =>
      upsertTrainingRecord({ data: payload as any }),
    onSuccess: async () => {
      toast.success("Training record saved");
      setOpen(false);
      setDraft(emptyDraft());
      await qc.invalidateQueries({ queryKey: ["hse"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const uploadAndSave = async () => {
    if (!draft.personName || !draft.course || !draft.completedOn) {
      toast.error("Person, course, and completion date are required");
      return;
    }
    let certificatePath = draft.certificatePath;
    if (draft.fileToUpload) {
      try {
        setUploading(true);
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .maybeSingle();
        const companyId = (profile as any)?.company_id as string | undefined;
        if (!companyId) throw new Error("no_company");
        const safeName = draft.fileToUpload.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${companyId}/hse/training/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("documents")
          .upload(path, draft.fileToUpload, {
            upsert: false,
            contentType: draft.fileToUpload.type || undefined,
          });
        if (error) throw error;
        certificatePath = path;
      } catch (e) {
        toast.error("Upload failed: " + errorMessage(e));
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }
    saveMut.mutate({
      personName: draft.personName,
      course: draft.course,
      provider: draft.provider || null,
      completedOn: draft.completedOn,
      expiresOn: draft.expiresOn || null,
      projectId: draft.projectId || null,
      certificatePath,
    });
  };

  const openCert = async (path: string) => {
    const { url } = await signTrainingCertificate({ data: { path } as any });
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Could not sign URL");
  };

  const exportCsv = () => {
    const csv = toCsv(
      rows.map((r) => ({
        person: r.person_name,
        course: r.course,
        provider: r.provider ?? "",
        completed_on: r.completed_on,
        expires_on: r.expires_on ?? "",
        project: r.project_name ?? "",
      })),
    );
    downloadCsv("hse-training.csv", csv);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Shield size={14} aria-hidden /> HSE
        </div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Training
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDraft(emptyDraft());
                setOpen(true);
              }}
            >
              <Plus size={14} aria-hidden /> Add record
            </Button>
          </div>
        </div>
      </header>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All projects</SelectItem>
                {(projectsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Person, course, provider"
                className="pl-8"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {listQuery.isError ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {errorMessage(listQuery.error)}
          </CardContent>
        </Card>
      ) : null}

      {listQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <GraduationCap size={32} className="text-muted-foreground" aria-hidden />
            <div className="text-sm text-muted-foreground">
              No training records yet.
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Person</th>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-left">Completed</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-foreground">{r.person_name}</td>
                  <td className="px-3 py-2">{r.course}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.provider ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{r.completed_on}</td>
                  <td className="px-3 py-2 tabular-nums">
                    <div className="flex items-center gap-2">
                      <span>{r.expires_on ?? "—"}</span>
                      <TrainingExpiryBadge expiresOn={r.expires_on} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {r.certificate_path ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openCert(r.certificate_path!)}
                      >
                        View
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add training record</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>Person</Label>
              <Input
                value={draft.personName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, personName: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Course</Label>
              <Input
                value={draft.course}
                onChange={(e) => setDraft((d) => ({ ...d, course: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Provider</Label>
              <Input
                value={draft.provider}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, provider: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Completed on</Label>
              <Input
                type="date"
                value={draft.completedOn}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, completedOn: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Expires on</Label>
              <Input
                type="date"
                value={draft.expiresOn}
                onChange={(e) => setDraft((d) => ({ ...d, expiresOn: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>Project (optional)</Label>
              <Select
                value={draft.projectId}
                onValueChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(projectsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>Certificate</Label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-accent">
                <Upload size={14} aria-hidden />
                {draft.fileToUpload
                  ? draft.fileToUpload.name
                  : "Choose PDF or image"}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,image/*"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      fileToUpload: e.target.files?.[0] ?? null,
                    }))
                  }
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={uploadAndSave}
              disabled={saveMut.isPending || uploading}
            >
              {uploading ? "Uploading…" : saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
