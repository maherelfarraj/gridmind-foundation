// P-089 — Create QA/QC inspection.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ClipboardCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentList } from "@/components/qaqc/attachment-list";
import { createInspection } from "@/lib/qaqc.functions";
import {
  errorMessage,
  qaqcInspectorsQueryOptions,
  qaqcProjectsQueryOptions,
} from "@/lib/qaqc-query";
import {
  inspectionInput,
  QAQC_DISCIPLINES,
  QAQC_DISCIPLINE_LABELS,
  QAQC_RESULTS,
  type InspectionInput,
  type QaqcAttachment,
} from "@/lib/qaqc.rules";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/qaqc/inspections/new")({
  head: () => ({
    meta: [
      { title: "New QA/QC inspection — GridMind EPC" },
      { name: "description", content: "Log a new quality-control inspection." },
      { property: "og:title", content: "New QA/QC inspection" },
      {
        property: "og:description",
        content: "Record ITP result, rework, and attachments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewInspectionPage,
});

function NewInspectionPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projectsQuery = useQuery(qaqcProjectsQueryOptions());
  const inspectorsQuery = useQuery(qaqcInspectorsQueryOptions());
  const [attachments, setAttachments] = useState<QaqcAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const form = useForm<InspectionInput>({
    resolver: zodResolver(inspectionInput) as any,
    defaultValues: {
      projectId: "",
      discipline: "civil",
      area: "",
      itpReference: "",
      wbsItemId: null,
      inspectionDate: new Date().toISOString().slice(0, 10),
      inspectorId: null,
      result: "pending",
      reworkRequired: false,
      reworkNotes: "",
      attachments: [],
    },
  });

  const createMut = useMutation({
    mutationFn: (payload: InspectionInput) =>
      createInspection({ data: payload as any }),
    onSuccess: async (row) => {
      toast.success(`Inspection ${row.inspection_number} created`);
      await qc.invalidateQueries({ queryKey: ["qaqc"] });
      navigate({ to: "/qaqc/inspections/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);
      const projectId = form.getValues("projectId");
      if (!projectId) {
        toast.error("Select a project first");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .maybeSingle();
      const companyId = (profile as any)?.company_id as string | undefined;
      if (!companyId) throw new Error("no_company");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${companyId}/qaqc/${projectId}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from("documents")
        .upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
      if (error) throw error;
      const next: QaqcAttachment = { file_path: path, label: file.name };
      const nextList = [...attachments, next];
      setAttachments(nextList);
      form.setValue("attachments", nextList);
    } catch (e) {
      toast.error("Upload failed: " + errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (i: number) => {
    const nextList = attachments.filter((_, idx) => idx !== i);
    setAttachments(nextList);
    form.setValue("attachments", nextList);
  };

  const onSubmit = form.handleSubmit((values) => {
    createMut.mutate({ ...values, attachments });
  });

  const reworkRequired = form.watch("reworkRequired");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-24">
      <header className="flex flex-col gap-2">
        <Link
          to="/qaqc/inspections"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={12} /> Back to inspections
        </Link>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <ClipboardCheck size={14} aria-hidden /> QA/QC
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          New inspection
        </h1>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>Project</Label>
              <Select
                value={form.watch("projectId")}
                onValueChange={(v) =>
                  form.setValue("projectId", v, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.projectId ? (
                <span className="text-xs text-destructive">
                  {form.formState.errors.projectId.message as string}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label>Discipline</Label>
              <Select
                value={form.watch("discipline")}
                onValueChange={(v) =>
                  form.setValue("discipline", v as any, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QAQC_DISCIPLINES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {QAQC_DISCIPLINE_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="area">Area</Label>
              <Input id="area" {...form.register("area")} placeholder="Block A / Row 12" />
              {form.formState.errors.area ? (
                <span className="text-xs text-destructive">
                  {form.formState.errors.area.message as string}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="itp">ITP reference</Label>
              <Input
                id="itp"
                {...form.register("itpReference")}
                placeholder="e.g. ITP-CIV-004 §3.2"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="date">Inspection date</Label>
              <Input id="date" type="date" {...form.register("inspectionDate")} />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>Inspector</Label>
              <Select
                value={form.watch("inspectorId") ?? ""}
                onValueChange={(v) =>
                  form.setValue("inspectorId", v || null, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {(inspectorsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.email ?? p.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>Result</Label>
              <Select
                value={form.watch("result")}
                onValueChange={(v) =>
                  form.setValue("result", v as any, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QAQC_RESULTS.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">Rework required</div>
                <div className="text-xs text-muted-foreground">
                  Requires notes below
                </div>
              </div>
              <Switch
                checked={reworkRequired}
                onCheckedChange={(v) =>
                  form.setValue("reworkRequired", v, { shouldValidate: true })
                }
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label htmlFor="reworkNotes">
                Rework notes{reworkRequired ? " *" : ""}
              </Label>
              <Textarea
                id="reworkNotes"
                rows={3}
                {...form.register("reworkNotes")}
                placeholder={
                  reworkRequired
                    ? "Describe defects and required rework"
                    : "Optional notes"
                }
              />
              {form.formState.errors.reworkNotes ? (
                <span className="text-xs text-destructive">
                  {form.formState.errors.reworkNotes.message as string}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attachments</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <AttachmentList
              attachments={attachments}
              onRemove={removeAttachment}
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-accent">
              <Upload size={14} aria-hidden />
              {uploading ? "Uploading…" : "Add file (PDF or image)"}
              <input
                type="file"
                className="sr-only"
                accept=".pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 flex gap-2 rounded-md border border-border bg-background/95 p-3 backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate({ to: "/qaqc/inspections" })}
          >
            <X size={14} aria-hidden /> Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMut.isPending}
            className="ml-auto"
          >
            {createMut.isPending ? "Saving…" : "Log inspection"}
          </Button>
        </div>
      </form>
    </div>
  );
}
