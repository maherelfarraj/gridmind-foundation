// P-088 — HSE new incident form.
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ClipboardList, Info, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage, hseProjectsQueryOptions } from "@/lib/hse-query";
import { createIncident } from "@/lib/hse.functions";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  incidentInput,
  type IncidentInput,
} from "@/lib/hse.rules";

export const Route = createFileRoute("/_authenticated/hse/incidents/new")({
  head: () => ({
    meta: [
      { title: "Log HSE incident — GridMind EPC" },
      {
        name: "description",
        content: "Report an HSE incident within 24 hours of occurrence.",
      },
      { property: "og:title", content: "Log HSE incident" },
      {
        property: "og:description",
        content: "24-hour logging rule for site safety.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewIncidentPage,
});

function isoLocalToUtc(v: string): string {
  if (!v) return v;
  const d = new Date(v);
  return d.toISOString();
}

function NewIncidentPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projectsQuery = useQuery(hseProjectsQueryOptions());
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const [localOccurred, setLocalOccurred] = useState(nowLocal);

  const form = useForm<IncidentInput>({
    resolver: zodResolver(incidentInput) as any,
    defaultValues: {
      projectId: "",
      incidentType: "near_miss",
      severity: "minor",
      occurredAt: new Date(nowLocal).toISOString(),
      location: "",
      description: "",
      personsInvolved: "",
      daysAwayFromWork: 0,
      restrictedDuty: false,
      medicalTreatment: false,
      oshaRecordable: false,
      correctiveActions: [],
    },
  });

  const actions = useFieldArray({ control: form.control, name: "correctiveActions" });

  const createMut = useMutation({
    mutationFn: (payload: IncidentInput) => createIncident({ data: payload as any }),
    onSuccess: async (row) => {
      toast.success(`Incident ${row.incident_number} logged`);
      await qc.invalidateQueries({ queryKey: ["hse"] });
      navigate({ to: "/hse/incidents/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onSubmit = form.handleSubmit((values) => {
    createMut.mutate({
      ...values,
      occurredAt: isoLocalToUtc(localOccurred),
    });
  });

  return (
    <div className="page-shell">
      <PageHeader
        title="Log incident"
        description="Report an HSE incident within 24 hours of occurrence."
      />

      <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
        <Info size={16} className="mt-0.5 text-primary" aria-hidden />
        <div>
          <div className="font-medium text-foreground">
            Incidents must be logged within 24 hours of occurrence.
          </div>
          <div className="text-xs text-muted-foreground">
            Late logs are flagged and reported in the HSE dashboard.
          </div>
        </div>
      </div>

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
                onValueChange={(v) => form.setValue("projectId", v, { shouldValidate: true })}
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
              <Label>Type</Label>
              <Select
                value={form.watch("incidentType")}
                onValueChange={(v) =>
                  form.setValue("incidentType", v as any, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {INCIDENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Severity</Label>
              <Select
                value={form.watch("severity")}
                onValueChange={(v) => form.setValue("severity", v as any, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="occurredAt">Occurred at</Label>
              <Input
                id="occurredAt"
                type="datetime-local"
                value={localOccurred}
                onChange={(e) => setLocalOccurred(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                {...form.register("location")}
                placeholder="Substation A / Row 12"
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                {...form.register("description")}
                placeholder="What happened?"
              />
              {form.formState.errors.description ? (
                <span className="text-xs text-destructive">
                  {form.formState.errors.description.message as string}
                </span>
              ) : null}
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label htmlFor="persons">Persons involved</Label>
              <Textarea
                id="persons"
                rows={2}
                {...form.register("personsInvolved")}
                placeholder="Names or roles (optional)"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">OSHA classification</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">OSHA recordable</div>
                <div className="text-xs text-muted-foreground">Counts toward TRIR</div>
              </div>
              <Switch
                checked={form.watch("oshaRecordable")}
                onCheckedChange={(v) => form.setValue("oshaRecordable", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-sm font-medium">Medical treatment</div>
              <Switch
                checked={form.watch("medicalTreatment")}
                onCheckedChange={(v) => form.setValue("medicalTreatment", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-sm font-medium">Restricted duty</div>
              <Switch
                checked={form.watch("restrictedDuty")}
                onCheckedChange={(v) => form.setValue("restrictedDuty", v)}
              />
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <Label htmlFor="daysAway" className="text-sm font-medium">
                Days away from work
              </Label>
              <Input
                id="daysAway"
                type="number"
                min={0}
                {...form.register("daysAwayFromWork", { valueAsNumber: true })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Corrective actions</CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.append({ action: "", owner: "", due_date: null })}
            >
              <Plus size={14} aria-hidden /> Add
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {actions.fields.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No corrective actions yet" compact />
            ) : null}
            {actions.fields.map((f, i) => (
              <div
                key={f.id}
                className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[2fr_1fr_1fr_auto]"
              >
                <Input
                  {...form.register(`correctiveActions.${i}.action` as const)}
                  placeholder="Action"
                />
                <Input
                  {...form.register(`correctiveActions.${i}.owner` as const)}
                  placeholder="Owner"
                />
                <Input type="date" {...form.register(`correctiveActions.${i}.due_date` as const)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => actions.remove(i)}
                  aria-label="Remove"
                >
                  <X size={16} aria-hidden />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {form.formState.errors.correctiveActions ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle size={14} aria-hidden /> Please check corrective actions.
          </div>
        ) : null}

        <div className="sticky bottom-0 flex gap-2 rounded-md border border-border bg-background/95 p-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={() => navigate({ to: "/hse/incidents" })}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMut.isPending} className="ml-auto">
            {createMut.isPending ? "Saving…" : "Log incident"}
          </Button>
        </div>
      </form>
    </div>
  );
}
