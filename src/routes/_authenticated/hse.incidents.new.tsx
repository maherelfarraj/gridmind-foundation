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
import { useI18n } from "@/lib/i18n/locale-provider";
import { errorCodeOf, translateError } from "@/lib/i18n/error-keys";

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
  const { t } = useI18n();
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
      toast.success(t("fieldMod.hse.incident.incidentLogged", { number: row.incident_number }));
      await qc.invalidateQueries({ queryKey: ["hse"] });
      navigate({ to: "/hse/incidents/$id", params: { id: row.id } });
    },
    onError: (e) => toast.error(translateError(t, errorCodeOf(e), errorMessage(e))),
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
        title={t("fieldMod.hse.incident.title")}
        description={t("fieldMod.hse.incident.description")}
      />

      <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
        <Info size={16} className="mt-0.5 text-primary" aria-hidden />
        <div>
          <div className="font-medium text-foreground">{t("fieldMod.hse.incident.banner")}</div>
          <div className="text-xs text-muted-foreground">
            {t("fieldMod.hse.incident.bannerHint")}
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("fieldMod.hse.incident.basics")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label>{t("fieldMod.hse.incident.project")}</Label>
              <Select
                value={form.watch("projectId")}
                onValueChange={(v) => form.setValue("projectId", v, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("fieldMod.hse.incident.selectProject")} />
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
              <Label>{t("fieldMod.hse.incident.type")}</Label>
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
              <Label>{t("fieldMod.hse.incident.severity")}</Label>
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
              <Label htmlFor="occurredAt">{t("fieldMod.hse.incident.occurredAt")}</Label>
              <Input
                id="occurredAt"
                type="datetime-local"
                dir="ltr"
                value={localOccurred}
                onChange={(e) => setLocalOccurred(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="location">{t("fieldMod.hse.incident.location")}</Label>
              <Input
                id="location"
                {...form.register("location")}
                placeholder={t("fieldMod.hse.incident.locationPlaceholder")}
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label htmlFor="description">{t("fieldMod.hse.incident.descriptionField")}</Label>
              <Textarea
                id="description"
                rows={4}
                {...form.register("description")}
                placeholder={t("fieldMod.hse.incident.descriptionPlaceholder")}
              />
              {form.formState.errors.description ? (
                <span className="text-xs text-destructive">
                  {form.formState.errors.description.message as string}
                </span>
              ) : null}
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label htmlFor="persons">{t("fieldMod.hse.incident.personsInvolved")}</Label>
              <Textarea
                id="persons"
                rows={2}
                {...form.register("personsInvolved")}
                placeholder={t("fieldMod.hse.incident.personsPlaceholder")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("fieldMod.hse.incident.oshaClassification")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">
                  {t("fieldMod.hse.incident.oshaRecordable")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("fieldMod.hse.incident.oshaRecordableHint")}
                </div>
              </div>
              <Switch
                checked={form.watch("oshaRecordable")}
                onCheckedChange={(v) => form.setValue("oshaRecordable", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-sm font-medium">
                {t("fieldMod.hse.incident.medicalTreatment")}
              </div>
              <Switch
                checked={form.watch("medicalTreatment")}
                onCheckedChange={(v) => form.setValue("medicalTreatment", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="text-sm font-medium">{t("fieldMod.hse.incident.restrictedDuty")}</div>
              <Switch
                checked={form.watch("restrictedDuty")}
                onCheckedChange={(v) => form.setValue("restrictedDuty", v)}
              />
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-border p-3">
              <Label htmlFor="daysAway" className="text-sm font-medium">
                {t("fieldMod.hse.incident.daysAway")}
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
            <CardTitle className="text-base">
              {t("fieldMod.hse.incident.correctiveActions")}
            </CardTitle>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => actions.append({ action: "", owner: "", due_date: null })}
            >
              <Plus size={14} aria-hidden /> {t("fieldMod.hse.incident.addAction")}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {actions.fields.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={t("fieldMod.hse.incident.noActions")}
                compact
              />
            ) : null}
            {actions.fields.map((f, i) => (
              <div
                key={f.id}
                className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-[2fr_1fr_1fr_auto]"
              >
                <Input
                  {...form.register(`correctiveActions.${i}.action` as const)}
                  placeholder={t("fieldMod.hse.incident.actionPlaceholder")}
                />
                <Input
                  {...form.register(`correctiveActions.${i}.owner` as const)}
                  placeholder={t("fieldMod.hse.incident.ownerPlaceholder")}
                />
                <Input type="date" {...form.register(`correctiveActions.${i}.due_date` as const)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => actions.remove(i)}
                  aria-label={t("fieldMod.hse.incident.removeAction")}
                >
                  <X size={16} aria-hidden />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {form.formState.errors.correctiveActions ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle size={14} aria-hidden /> {t("fieldMod.hse.incident.checkActions")}
          </div>
        ) : null}

        <div className="sticky bottom-0 flex gap-2 rounded-md border border-border bg-background/95 p-3 backdrop-blur">
          <Button type="button" variant="ghost" onClick={() => navigate({ to: "/hse/incidents" })}>
            {t("fieldMod.common.cancel")}
          </Button>
          <Button type="submit" disabled={createMut.isPending} className="ms-auto">
            {createMut.isPending
              ? t("fieldMod.common.saving")
              : t("fieldMod.hse.incident.logIncident")}
          </Button>
        </div>
      </form>
    </div>
  );
}
